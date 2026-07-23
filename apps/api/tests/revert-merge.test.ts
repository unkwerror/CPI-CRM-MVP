import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ recalculatePersonLifecycle: vi.fn() }));

vi.mock('../src/modules/artifacts/lifecycle-service.js', () => lifecycle);

import {
  isAutomaticDeduplicationOperation,
  revertMergeOperation,
} from '../src/modules/operations/revert-merge.js';

const OPERATION_ID = '00000000-0000-4000-8000-000000000010';
const MASTER_ID = '00000000-0000-4000-8000-000000000001';
const LOSER_A_ID = '00000000-0000-4000-8000-000000000002';
const LOSER_B_ID = '00000000-0000-4000-8000-000000000003';
const USER_ID = '00000000-0000-4000-8000-000000000020';
const CANDIDATE_A_ID = '00000000-0000-4000-8000-000000000030';
const CANDIDATE_B_ID = '00000000-0000-4000-8000-000000000031';

describe('revert merge operation', () => {
  beforeEach(() => lifecycle.recalculatePersonLifecycle.mockReset());

  it('recognizes the versioned automatic deduplication marker', () => {
    expect(
      isAutomaticDeduplicationOperation(
        'AUTO_DEDUPE_V1: автоматическое объединение совместимых карточек',
      ),
    ).toBe(true);
    expect(isAutomaticDeduplicationOperation('Ручное объединение')).toBe(false);
  });

  it('atomically restores every person and excludes auto-merged candidates', async () => {
    const exclusions: unknown[][] = [];
    let candidateUpdate: unknown[] | undefined;
    let operationItemsReverted = false;
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('SELECT master_person_id')) {
        return {
          rows: [
            {
              master_person_id: MASTER_ID,
              duplicate_candidate_id: null,
              status: 'APPLIED',
              reason: 'AUTO_DEDUPE_V1: автоматическое объединение совместимых карточек',
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT source_person_id')) {
        return {
          rows: [
            { source_person_id: LOSER_A_ID, before: { mergedIntoPersonId: null } },
            {
              source_person_id: LOSER_B_ID,
              before: { mergedIntoPersonId: LOSER_A_ID },
            },
          ],
        };
      }
      if (sql.includes('FROM persons') && sql.includes('FOR UPDATE')) {
        expect(parameters?.[0]).toEqual([MASTER_ID, LOSER_A_ID, LOSER_B_ID]);
        return {
          rows: [
            { id: MASTER_ID, merged_into_person_id: null },
            { id: LOSER_A_ID, merged_into_person_id: MASTER_ID },
            { id: LOSER_B_ID, merged_into_person_id: MASTER_ID },
          ],
        };
      }
      if (sql.includes('FROM merge_operations') && sql.includes("status = 'APPLIED'")) {
        return { rows: [{ id: OPERATION_ID }] };
      }
      if (sql.includes('SELECT restored_task.id')) return { rows: [] };
      if (sql.includes('JOIN duplicate_candidates dc')) {
        return {
          rows: [
            {
              id: CANDIDATE_A_ID,
              person_a_id: MASTER_ID,
              person_b_id: LOSER_A_ID,
              evidence_fingerprint: 'a'.repeat(64),
              status: 'MERGED',
            },
            {
              id: CANDIDATE_B_ID,
              person_a_id: LOSER_A_ID,
              person_b_id: LOSER_B_ID,
              evidence_fingerprint: 'b'.repeat(64),
              status: 'MERGED',
            },
          ],
        };
      }
      if (sql.includes('UPDATE persons')) {
        expect(JSON.parse(String(parameters?.[0]))).toEqual([
          { person_id: LOSER_A_ID, merged_into_person_id: null },
          { person_id: LOSER_B_ID, merged_into_person_id: LOSER_A_ID },
        ]);
        return { rows: [{ id: LOSER_A_ID }, { id: LOSER_B_ID }] };
      }
      if (sql.includes('UPDATE tasks')) return { rows: [] };
      if (sql.includes('UPDATE duplicate_candidates')) {
        candidateUpdate = parameters;
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO not_duplicate_pairs')) {
        exclusions.push(parameters ?? []);
        return { rows: [] };
      }
      if (sql.includes('UPDATE merge_operations')) return { rows: [] };
      if (sql.includes('UPDATE merge_operation_items')) {
        operationItemsReverted = true;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in automatic revert test: ${sql}`);
    });

    const result = await revertMergeOperation({ query } as unknown as PoolClient, {
      operationId: OPERATION_ID,
      userId: USER_ID,
      reason: 'Карточки всё же разные',
    });

    expect(result).toEqual({
      id: OPERATION_ID,
      status: 'REVERTED',
      masterPersonId: MASTER_ID,
      restoredPersonIds: [LOSER_A_ID, LOSER_B_ID],
      alreadyReverted: false,
    });
    expect(candidateUpdate?.[0]).toEqual([CANDIDATE_A_ID, CANDIDATE_B_ID]);
    expect(String(candidateUpdate?.[2])).toContain('Отмена автоматического объединения');
    expect(exclusions).toHaveLength(2);
    expect(exclusions.map((parameters) => parameters.slice(0, 3))).toEqual([
      [MASTER_ID, LOSER_A_ID, 'a'.repeat(64)],
      [LOSER_A_ID, LOSER_B_ID, 'b'.repeat(64)],
    ]);
    expect(operationItemsReverted).toBe(true);
    expect(lifecycle.recalculatePersonLifecycle.mock.calls.map((call) => call[1])).toEqual([
      MASTER_ID,
      LOSER_A_ID,
      LOSER_B_ID,
    ]);
  });

  it('preserves the legacy behavior by reopening the single manual candidate', async () => {
    let reopenedCandidate: unknown[] | undefined;
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('SELECT master_person_id')) {
        return {
          rows: [
            {
              master_person_id: MASTER_ID,
              duplicate_candidate_id: CANDIDATE_A_ID,
              status: 'APPLIED',
              reason: 'Ручное объединение',
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT source_person_id')) {
        return {
          rows: [{ source_person_id: LOSER_A_ID, before: { mergedIntoPersonId: null } }],
        };
      }
      if (sql.includes('FROM persons') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { id: MASTER_ID, merged_into_person_id: null },
            { id: LOSER_A_ID, merged_into_person_id: MASTER_ID },
          ],
        };
      }
      if (sql.includes('FROM merge_operations') && sql.includes("status = 'APPLIED'")) {
        return { rows: [{ id: OPERATION_ID }] };
      }
      if (sql.includes('SELECT restored_task.id')) return { rows: [] };
      if (sql.includes('UPDATE persons')) return { rows: [{ id: LOSER_A_ID }] };
      if (sql.includes('UPDATE tasks')) return { rows: [] };
      if (sql.includes('UPDATE duplicate_candidates')) {
        reopenedCandidate = parameters;
        return { rows: [] };
      }
      if (sql.includes('UPDATE merge_operations')) return { rows: [] };
      if (sql.includes('UPDATE merge_operation_items')) return { rows: [] };
      throw new Error(`Unexpected SQL in legacy revert test: ${sql}`);
    });

    await revertMergeOperation({ query } as unknown as PoolClient, {
      operationId: OPERATION_ID,
      userId: USER_ID,
      reason: 'Отмена вручную',
    });

    expect(reopenedCandidate).toEqual([CANDIDATE_A_ID]);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO not_duplicate_pairs')),
    ).toBe(false);
  });

  it('rejects a revert when a newer next step would be overwritten', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT master_person_id')) {
        return {
          rows: [
            {
              master_person_id: MASTER_ID,
              duplicate_candidate_id: CANDIDATE_A_ID,
              status: 'APPLIED',
              reason: 'Ручное объединение',
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT source_person_id')) {
        return {
          rows: [{ source_person_id: LOSER_A_ID, before: { mergedIntoPersonId: null } }],
        };
      }
      if (sql.includes('FROM persons') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { id: MASTER_ID, merged_into_person_id: null },
            { id: LOSER_A_ID, merged_into_person_id: MASTER_ID },
          ],
        };
      }
      if (sql.includes('FROM merge_operations') && sql.includes("status = 'APPLIED'")) {
        return { rows: [{ id: OPERATION_ID }] };
      }
      if (sql.includes('SELECT restored_task.id')) {
        return { rows: [{ restored_task_id: 'old-task', current_task_id: 'new-task' }] };
      }
      throw new Error(`Unexpected SQL in task dependency test: ${sql}`);
    });

    await expect(
      revertMergeOperation({ query } as unknown as PoolClient, {
        operationId: OPERATION_ID,
        userId: USER_ID,
        reason: 'Нельзя потерять новую задачу',
      }),
    ).rejects.toMatchObject({ status: 409, title: 'MERGE_DEPENDENCY_CONFLICT' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE persons'))).toBe(false);
  });

  it('keeps repeated revert idempotent', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          master_person_id: MASTER_ID,
          duplicate_candidate_id: null,
          status: 'REVERTED',
          reason: 'AUTO_DEDUPE_V1: already reverted',
        },
      ],
    }));

    const result = await revertMergeOperation({ query } as unknown as PoolClient, {
      operationId: OPERATION_ID,
      userId: USER_ID,
      reason: 'Повтор',
    });

    expect(result.alreadyReverted).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lifecycle.recalculatePersonLifecycle).not.toHaveBeenCalled();
  });
});
