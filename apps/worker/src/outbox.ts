import type { Pool, PoolClient } from 'pg';

export interface OutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  /** Attempt number after this claim (starts at one). */
  readonly attempts: number;
}

export interface OutboxProcessorOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;
export type TerminalFailureHandler = (event: OutboxEvent, error: Error) => Promise<void>;

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export class OutboxProcessor {
  public constructor(
    private readonly pool: Pool,
    private readonly options: OutboxProcessorOptions,
    private readonly handler: OutboxHandler,
    private readonly onTerminalFailure?: TerminalFailureHandler,
  ) {}

  public async processOnce(): Promise<number> {
    const events = await claimEvents(this.pool, this.options);
    const results = await Promise.allSettled(events.map((event) => this.processEvent(event)));
    const infrastructureFailures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (infrastructureFailures.length > 0) {
      throw new AggregateError(infrastructureFailures, 'Failed to persist outbox delivery state');
    }
    return events.length;
  }

  private async processEvent(event: OutboxEvent): Promise<void> {
    try {
      await this.handler(event);
      await markPublished(this.pool, event.id, this.options.workerId);
    } catch (cause) {
      const error = asError(cause);
      const terminal = event.attempts >= this.options.maxAttempts;
      const stillOwned = await markFailed(this.pool, event, this.options, terminal, error.message);
      if (terminal && stillOwned && this.onTerminalFailure) {
        try {
          await this.onTerminalFailure(event, error);
        } catch (terminalCause) {
          console.error('Failed to apply terminal outbox handling', {
            eventId: event.id,
            error: errorText(terminalCause),
          });
        }
      }
      console.error('Outbox event failed', {
        eventId: event.id,
        eventType: event.eventType,
        attempts: event.attempts,
        terminal,
        error: error.message,
      });
    }
  }
}

export function computeRetryDelayMs(attempt: number, baseMs: number, maximumMs: number): number {
  const exponent = Math.max(0, Math.min(30, attempt - 1));
  return Math.min(maximumMs, baseMs * 2 ** exponent);
}

async function claimEvents(pool: Pool, options: OutboxProcessorOptions): Promise<OutboxEvent[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id
           FROM outbox_events
          WHERE available_at <= now()
            AND (
              (status = 'PENDING' AND attempts < $3)
              OR
              (status = 'PROCESSING' AND locked_at < now() - ($4 * interval '1 millisecond'))
            )
          ORDER BY available_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE outbox_events event
          SET status = 'PROCESSING',
              locked_at = now(),
              locked_by = $1,
              attempts = event.attempts + 1,
              last_error = null,
              updated_at = now()
         FROM candidates
        WHERE event.id = candidates.id
      RETURNING event.id, event.event_type, event.aggregate_type, event.aggregate_id,
                event.payload, event.attempts`,
      [options.workerId, options.batchSize, options.maxAttempts, options.leaseMs],
    );
    await client.query('COMMIT');
    return result.rows.map(mapRow);
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function markPublished(pool: Pool, eventId: string, workerId: string): Promise<void> {
  await pool.query(
    `UPDATE outbox_events
        SET status = 'PUBLISHED', published_at = now(), locked_at = null,
            locked_by = null, last_error = null, updated_at = now()
      WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
    [eventId, workerId],
  );
}

async function markFailed(
  pool: Pool,
  event: OutboxEvent,
  options: OutboxProcessorOptions,
  terminal: boolean,
  message: string,
): Promise<boolean> {
  const delay = computeRetryDelayMs(event.attempts, options.retryBaseMs, options.retryMaxMs);
  const result = await pool.query(
    `UPDATE outbox_events
        SET status = $3::outbox_status,
            available_at = CASE WHEN $3 = 'PENDING' THEN now() + ($4 * interval '1 millisecond') ELSE available_at END,
            locked_at = null, locked_by = null, last_error = $5, updated_at = now()
      WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
    [event.id, options.workerId, terminal ? 'FAILED' : 'PENDING', delay, message.slice(0, 4_000)],
  );
  return (result.rowCount ?? 0) > 0;
}

function mapRow(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    attempts: row.attempts,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure; dropping the checked-out client resets it.
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(errorText(value));
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
