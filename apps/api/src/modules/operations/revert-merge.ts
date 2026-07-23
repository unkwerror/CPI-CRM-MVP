import type { PoolClient } from 'pg';

import { HttpProblem } from '../../lib/problem.js';
import { recalculatePersonLifecycle } from '../artifacts/lifecycle-service.js';

interface MergeOperationRow {
  master_person_id: string;
  duplicate_candidate_id: string | null;
  status: 'APPLIED' | 'REVERTED' | 'PARTIALLY_REVERTED';
  reason: string;
}

interface CandidateRow {
  id: string;
  person_a_id: string;
  person_b_id: string;
  evidence_fingerprint: string;
  status: 'OPEN' | 'MERGED' | 'NOT_DUPLICATE' | 'DISMISSED';
}

interface PersonMergeItemRow {
  source_person_id: string;
  before: { mergedIntoPersonId?: string | null } | null;
}

export interface RevertMergeOperationInput {
  readonly operationId: string;
  readonly userId: string;
  readonly reason: string;
}

export interface RevertMergeOperationResult {
  readonly id: string;
  readonly status: 'REVERTED';
  readonly masterPersonId: string;
  readonly restoredPersonIds: readonly string[];
  readonly alreadyReverted: boolean;
}

export function isAutomaticDeduplicationOperation(reason: string): boolean {
  return reason.startsWith('AUTO_DEDUPE');
}

/**
 * Reverts one whole merge operation. An automatic operation may contain many
 * person and duplicate-candidate items, so all state is restored atomically.
 * Must run inside a transaction.
 */
export async function revertMergeOperation(
  client: PoolClient,
  input: RevertMergeOperationInput,
): Promise<RevertMergeOperationResult> {
  const operation = await client.query<MergeOperationRow>(
    `SELECT master_person_id, duplicate_candidate_id, status, reason
       FROM merge_operations
      WHERE id = $1
      FOR UPDATE`,
    [input.operationId],
  );
  const row = operation.rows[0];
  if (!row) throw new HttpProblem(404, 'Операция объединения не найдена');
  if (row.status === 'REVERTED') {
    return {
      id: input.operationId,
      status: 'REVERTED',
      masterPersonId: row.master_person_id,
      restoredPersonIds: [],
      alreadyReverted: true,
    };
  }
  if (row.status !== 'APPLIED') {
    throw new HttpProblem(409, 'Операция отменена только частично');
  }

  const personItems = await client.query<PersonMergeItemRow>(
    `SELECT DISTINCT source_person_id, before
       FROM merge_operation_items
      WHERE merge_operation_id = $1
        AND entity_type = 'person'
        AND action = 'REASSIGNED'
        AND source_person_id IS NOT NULL
        AND reverted_at IS NULL
      ORDER BY source_person_id`,
    [input.operationId],
  );
  const restorationPlan = personItems.rows.map((item) => ({
    personId: item.source_person_id,
    mergedIntoPersonId: item.before?.mergedIntoPersonId ?? null,
  }));
  const restoredPersonIds = restorationPlan.map((item) => item.personId);
  if (restoredPersonIds.length === 0) {
    throw new HttpProblem(409, 'В операции нет карточек для восстановления');
  }

  const clusterIds = [row.master_person_id, ...restoredPersonIds];
  const lockedPeople = await client.query<{ id: string; merged_into_person_id: string | null }>(
    `SELECT id, merged_into_person_id
       FROM persons
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [clusterIds],
  );
  if (lockedPeople.rows.length !== clusterIds.length) {
    throw new HttpProblem(409, 'MERGE_DEPENDENCY_CONFLICT', 'Состав merge-кластера изменился.');
  }
  const master = lockedPeople.rows.find((person) => person.id === row.master_person_id);
  const invalidLoser = lockedPeople.rows.some(
    (person) =>
      person.id !== row.master_person_id && person.merged_into_person_id !== row.master_person_id,
  );
  if (!master || master.merged_into_person_id !== null || invalidLoser) {
    throw new HttpProblem(409, 'MERGE_DEPENDENCY_CONFLICT', 'Состав merge-кластера изменился.');
  }

  const latest = await client.query<{ id: string }>(
    `SELECT id
       FROM merge_operations
      WHERE master_person_id = $1 AND status = 'APPLIED'
      ORDER BY applied_at DESC, id DESC
      LIMIT 1`,
    [row.master_person_id],
  );
  if (latest.rows[0]?.id !== input.operationId) {
    throw new HttpProblem(
      409,
      'MERGE_DEPENDENCY_CONFLICT',
      'Можно отменить только последнюю операцию кластера.',
    );
  }

  const taskConflicts = await client.query<{ restored_task_id: string; current_task_id: string }>(
    `SELECT restored_task.id AS restored_task_id, current_task.id AS current_task_id
       FROM merge_operation_items item
       JOIN tasks restored_task ON restored_task.id = item.entity_id
       JOIN tasks current_task
         ON current_task.person_id = restored_task.person_id
        AND current_task.id <> restored_task.id
        AND current_task.status = 'OPEN'
        AND current_task.is_next_step
        AND current_task.archived_at IS NULL
      WHERE item.merge_operation_id = $1
        AND item.entity_type = 'task'
        AND item.field_name = 'is_next_step'
        AND item.reverted_at IS NULL
        AND restored_task.status = 'OPEN'
        AND restored_task.archived_at IS NULL
      FOR UPDATE OF restored_task, current_task`,
    [input.operationId],
  );
  if (taskConflicts.rows.length > 0) {
    throw new HttpProblem(
      409,
      'MERGE_DEPENDENCY_CONFLICT',
      'После объединения был назначен новый следующий шаг. Сначала снимите этот признак с новой задачи.',
    );
  }

  const automatic = isAutomaticDeduplicationOperation(row.reason);
  let automaticCandidates: CandidateRow[] = [];
  if (automatic) {
    const candidates = await client.query<CandidateRow>(
      `SELECT dc.id, dc.person_a_id, dc.person_b_id, dc.evidence_fingerprint, dc.status
         FROM merge_operation_items item
         JOIN duplicate_candidates dc ON dc.id = item.entity_id
        WHERE item.merge_operation_id = $1
          AND item.entity_type = 'duplicate_candidate'
          AND item.field_name = 'status'
          AND item.reverted_at IS NULL
        ORDER BY dc.id
        FOR UPDATE OF dc`,
      [input.operationId],
    );
    automaticCandidates = candidates.rows;
    if (automaticCandidates.some((candidate) => candidate.status !== 'MERGED')) {
      throw new HttpProblem(
        409,
        'MERGE_DEPENDENCY_CONFLICT',
        'Статус одного из кандидатов на дубль изменился.',
      );
    }
  }

  const restored = await client.query<{ id: string }>(
    `WITH restoration AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb)
           AS change(person_id uuid, merged_into_person_id uuid)
     )
     UPDATE persons person
        SET merged_into_person_id = restoration.merged_into_person_id,
            updated_at = now(), version = person.version + 1
       FROM restoration
      WHERE person.id = restoration.person_id
        AND person.merged_into_person_id = $2
      RETURNING person.id`,
    [
      JSON.stringify(
        restorationPlan.map((item) => ({
          person_id: item.personId,
          merged_into_person_id: item.mergedIntoPersonId,
        })),
      ),
      row.master_person_id,
    ],
  );
  if (restored.rows.length !== restoredPersonIds.length) {
    throw new HttpProblem(409, 'MERGE_DEPENDENCY_CONFLICT', 'Состав merge-кластера изменился.');
  }

  await client.query(
    `UPDATE tasks
        SET is_next_step = true, updated_at = now()
      WHERE id IN (
              SELECT entity_id
                FROM merge_operation_items
               WHERE merge_operation_id = $1
                 AND entity_type = 'task'
                 AND field_name = 'is_next_step'
                 AND reverted_at IS NULL
            )
        AND status = 'OPEN' AND archived_at IS NULL`,
    [input.operationId],
  );

  if (automaticCandidates.length > 0) {
    const candidateIds = automaticCandidates.map((candidate) => candidate.id);
    await client.query(
      `UPDATE duplicate_candidates
          SET status = 'NOT_DUPLICATE', decided_at = now(), decided_by_user_id = $2,
              decision_reason = $3, updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [candidateIds, input.userId, `Отмена автоматического объединения: ${input.reason}`],
    );
    for (const candidate of automaticCandidates) {
      await client.query(
        `INSERT INTO not_duplicate_pairs
           (person_a_id, person_b_id, evidence_fingerprint, reason, decided_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (person_a_id, person_b_id, evidence_fingerprint)
         DO UPDATE SET reason = EXCLUDED.reason,
                       decided_by_user_id = EXCLUDED.decided_by_user_id,
                       decided_at = now(), superseded_at = NULL, updated_at = now()`,
        [
          candidate.person_a_id,
          candidate.person_b_id,
          candidate.evidence_fingerprint,
          `Отмена автоматического объединения: ${input.reason}`,
          input.userId,
        ],
      );
    }
  } else if (!automatic && row.duplicate_candidate_id) {
    await client.query(
      `UPDATE duplicate_candidates
          SET status = 'OPEN', decided_at = NULL, decided_by_user_id = NULL,
              decision_reason = NULL, updated_at = now()
        WHERE id = $1`,
      [row.duplicate_candidate_id],
    );
  }

  await client.query(
    `UPDATE merge_operations
        SET status = 'REVERTED', reverted_at = now(), reverted_by_user_id = $2,
            revert_reason = $3, updated_at = now()
      WHERE id = $1`,
    [input.operationId, input.userId, input.reason],
  );
  await client.query(
    `UPDATE merge_operation_items
        SET reverted_at = now(), updated_at = now()
      WHERE merge_operation_id = $1`,
    [input.operationId],
  );

  await recalculatePersonLifecycle(client, row.master_person_id, 'RECONCILIATION');
  for (const personId of restoredPersonIds) {
    await recalculatePersonLifecycle(client, personId, 'RECONCILIATION');
  }

  return {
    id: input.operationId,
    status: 'REVERTED',
    masterPersonId: row.master_person_id,
    restoredPersonIds,
    alreadyReverted: false,
  };
}
