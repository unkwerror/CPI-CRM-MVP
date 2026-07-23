import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

import { reevaluateArtifactVersion } from './artifact-countability.js';
import type { WorkerConfig } from './config.js';
import { inTransaction } from './db.js';
import { FileScanner } from './file-scanner.js';
import { recalculateVersionAuthors } from './lifecycle.js';
import { OutboxProcessor, type OutboxEvent } from './outbox.js';
import { runDueLifecycleTransitions, runNightlyReconciliation } from './reconciliation.js';

export class WorkerRuntime {
  readonly #pool: Pool;
  readonly #scanner: FileScanner;
  readonly #outbox: OutboxProcessor;
  readonly #abort = new AbortController();
  readonly #tasks = new Set<Promise<unknown>>();
  #dueTimer?: NodeJS.Timeout;
  #reconciliationTimer?: NodeJS.Timeout;
  #activePoll: Promise<number> | undefined;
  #stopped = false;

  public constructor(private readonly config: WorkerConfig) {
    this.#pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
    const s3 = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.storage.accessKey,
        secretAccessKey: config.storage.secretKey,
      },
    });
    this.#scanner = new FileScanner(this.#pool, s3, {
      quarantineBucket: config.storage.quarantineBucket,
      privateBucket: config.storage.privateBucket,
      clamAv: config.clamAv,
    });
    this.#outbox = new OutboxProcessor(
      this.#pool,
      {
        workerId: config.workerId,
        batchSize: config.outboxBatchSize,
        leaseMs: config.leaseMs,
        maxAttempts: config.maxAttempts,
        retryBaseMs: config.retryBaseMs,
        retryMaxMs: config.retryMaxMs,
      },
      (event) => this.dispatch(event),
      async (event, error) => {
        if (event.eventType === 'file_scan_requested') {
          await this.#scanner.quarantineAfterTerminalFailure(event.aggregateId, error);
        }
      },
    );
  }

  public async run(): Promise<void> {
    await this.#pool.query('SELECT 1');
    console.info('CPI CRM worker started', { workerId: this.config.workerId });

    this.track(this.runDue());
    this.track(this.runReconciliation());
    this.#dueTimer = setInterval(() => this.track(this.runDue()), this.config.dueIntervalMs);
    this.#reconciliationTimer = setInterval(
      () => this.track(this.runReconciliation()),
      this.config.reconciliationIntervalMs,
    );

    while (!this.#abort.signal.aborted) {
      let claimed = 0;
      try {
        const poll = this.#outbox.processOnce();
        this.#activePoll = poll;
        claimed = await poll;
      } catch (error) {
        console.error('Outbox polling failed', { error: errorMessage(error) });
      } finally {
        this.#activePoll = undefined;
      }
      if (claimed < this.config.outboxBatchSize) {
        await abortableDelay(this.config.pollIntervalMs, this.#abort.signal);
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abort.abort();
    if (this.#dueTimer) clearInterval(this.#dueTimer);
    if (this.#reconciliationTimer) clearInterval(this.#reconciliationTimer);
    if (this.#activePoll) await Promise.allSettled([this.#activePoll]);
    await Promise.allSettled([...this.#tasks]);
    await this.#pool.end();
    console.info('CPI CRM worker stopped', { workerId: this.config.workerId });
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    switch (event.eventType) {
      case 'file_scan_requested':
        await this.#scanner.process(event.aggregateId);
        return;
      case 'artifact_version_submitted_pending_scan':
        await inTransaction(this.#pool, (client) =>
          reevaluateArtifactVersion(client, event.aggregateId).then(() => undefined),
        );
        return;
      case 'artifact_version_became_countable':
        await inTransaction(this.#pool, (client) =>
          recalculateVersionAuthors(client, event.aggregateId, 'ARTIFACT_BECAME_COUNTABLE').then(
            () => undefined,
          ),
        );
        return;
      case 'person_lifecycle_changed':
        // Durable domain notification reached the local delivery boundary. A later
        // Redis/BullMQ or integration publisher can replace this sink without
        // changing the source-of-truth and lease semantics.
        return;
      default:
        throw new Error(`Unsupported outbox event type: ${event.eventType}`);
    }
  }

  private async runDue(): Promise<void> {
    try {
      const transitions = await runDueLifecycleTransitions(
        this.#pool,
        this.config.reconciliationBatchSize,
      );
      console.info('Due lifecycle pass completed', { transitions });
    } catch (error) {
      console.error('Due lifecycle pass failed', { error: errorMessage(error) });
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      const result = await runNightlyReconciliation(
        this.#pool,
        this.config.reconciliationBatchSize,
      );
      console.info('Lifecycle reconciliation completed', result);
    } catch (error) {
      console.error('Lifecycle reconciliation failed', { error: errorMessage(error) });
    }
  }

  private track(task: Promise<unknown>): void {
    this.#tasks.add(task);
    void task.finally(() => this.#tasks.delete(task));
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
