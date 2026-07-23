import type { Pool } from 'pg';

import { reevaluateArtifactVersion } from './artifact-countability.js';
import { inTransaction } from './db.js';
import { recalculatePersonLifecycle } from './lifecycle.js';

const DUE_LOCK = 'cpi-crm-worker:due-lifecycle';
const RECONCILIATION_LOCK = 'cpi-crm-worker:nightly-reconciliation';

interface DuePersonRow {
  id: string;
  next_status_transition_at: Date;
}

interface IdRow {
  id: string;
}

export interface ReconciliationResult {
  readonly acquired: boolean;
  readonly recoveredFileEvents: number;
  readonly artifactVersions: number;
  readonly persons: number;
}

export async function runDueLifecycleTransitions(pool: Pool, batchSize: number): Promise<number> {
  return withAdvisoryLock(pool, DUE_LOCK, async () => {
    const detectedAt = new Date();
    let transitioned = 0;
    let cursorAt: Date | null = null;
    let cursorId: string | null = null;

    for (;;) {
      const rows: DuePersonRow[] = (
        await pool.query<DuePersonRow>(
          `SELECT id, next_status_transition_at
           FROM persons
          WHERE archived_at IS NULL AND merged_into_person_id IS NULL
            AND next_status_transition_at < $1
            AND (
              $2::timestamptz IS NULL
              OR (next_status_transition_at, id) > ($2::timestamptz, $3::uuid)
            )
          ORDER BY next_status_transition_at, id
          LIMIT $4`,
          [detectedAt, cursorAt, cursorId, batchSize],
        )
      ).rows;
      if (rows.length === 0) break;

      for (const row of rows) {
        const recalculated = await inTransaction(pool, (client) =>
          recalculatePersonLifecycle(client, row.id, 'TIME_WINDOW_ELAPSED', null, detectedAt),
        );
        if (recalculated.changed) transitioned += 1;
      }
      const last: DuePersonRow = rows.at(-1)!;
      cursorAt = last.next_status_transition_at;
      cursorId = last.id;
    }
    return transitioned;
  }).then((result) => result ?? 0);
}

export async function runNightlyReconciliation(
  pool: Pool,
  batchSize: number,
): Promise<ReconciliationResult> {
  const result = await withAdvisoryLock(pool, RECONCILIATION_LOCK, async () => {
    const recoveredFileEvents = await recoverMissingFileScanEvents(pool);
    const artifactVersions = await reconcileArtifactVersions(pool, batchSize);
    const persons = await reconcilePersons(pool, batchSize);
    return { acquired: true, recoveredFileEvents, artifactVersions, persons };
  });
  return result ?? { acquired: false, recoveredFileEvents: 0, artifactVersions: 0, persons: 0 };
}

async function recoverMissingFileScanEvents(pool: Pool): Promise<number> {
  const result = await pool.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     SELECT 'file_scan_requested', 'file_object', file.id,
            jsonb_build_object('fileObjectId', file.id, 'recovered', true)
       FROM file_objects file
      WHERE file.status = 'SCANNING'
        AND NOT EXISTS (
          SELECT 1
            FROM outbox_events event
           WHERE event.event_type = 'file_scan_requested'
             AND event.aggregate_id = file.id
             AND event.status IN ('PENDING', 'PROCESSING')
        )`,
  );
  return result.rowCount ?? 0;
}

async function reconcileArtifactVersions(pool: Pool, batchSize: number): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows: IdRow[] = (
      await pool.query<IdRow>(
        `SELECT id
         FROM artifact_versions
        WHERE status = 'SUBMITTED' AND ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id
        LIMIT $2`,
        [cursor, batchSize],
      )
    ).rows;
    if (rows.length === 0) break;
    for (const row of rows) {
      await inTransaction(pool, (client) =>
        reevaluateArtifactVersion(client, row.id).then(() => undefined),
      );
      count += 1;
    }
    cursor = rows.at(-1)!.id;
  }
  return count;
}

async function reconcilePersons(pool: Pool, batchSize: number): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  const detectedAt = new Date();
  for (;;) {
    const rows: IdRow[] = (
      await pool.query<IdRow>(
        `SELECT id
         FROM persons
        WHERE archived_at IS NULL AND merged_into_person_id IS NULL
          AND ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id
        LIMIT $2`,
        [cursor, batchSize],
      )
    ).rows;
    if (rows.length === 0) break;
    for (const row of rows) {
      await inTransaction(pool, (client) =>
        recalculatePersonLifecycle(client, row.id, 'RECONCILIATION', null, detectedAt).then(
          () => undefined,
        ),
      );
      count += 1;
    }
    cursor = rows.at(-1)!.id;
  }
  return count;
}

async function withAdvisoryLock<T>(
  pool: Pool,
  key: string,
  callback: () => Promise<T>,
): Promise<T | null> {
  const lockClient = await pool.connect();
  let acquired = false;
  try {
    const result = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [key],
    );
    acquired = result.rows[0]?.acquired ?? false;
    if (!acquired) return null;
    return await callback();
  } finally {
    if (acquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      } catch {
        // Closing the session below also releases the advisory lock.
      }
    }
    lockClient.release();
  }
}
