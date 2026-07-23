import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  planActivityTransitions,
  recalculatePersonLifecycle,
  recalculateVersionAuthors,
} from '../src/lifecycle.js';

const LAST_ARTIFACT_AT = new Date('2026-01-01T00:00:00.000Z');
const ACTIVE_BOUNDARY = '2026-01-11T12:00:00.000Z';
const INACTIVE_BOUNDARY = '2026-01-22T00:00:00.000Z';
const DETECTED_AT = new Date('2026-02-01T00:00:00.000Z');
const CANONICAL_PERSON_ID = '00000000-0000-4000-8000-000000000001';
const MERGED_PERSON_ID = '00000000-0000-4000-8000-000000000002';

describe('planActivityTransitions', () => {
  it('restores both missed ACTIVE → MEDIUM → INACTIVE boundaries', () => {
    const transitions = planActivityTransitions({
      fromState: 'ACTIVE',
      toState: 'INACTIVE',
      calculatedAt: DETECTED_AT,
      lastArtifactAt: LAST_ARTIFACT_AT,
      activeWindowHours: 252,
      inactiveAfterHours: 504,
      recoverElapsedBoundaries: true,
    });

    expect(
      transitions.map((transition) => ({
        edge: `${transition.fromState}->${transition.toState}`,
        effectiveAt: transition.effectiveAt.toISOString(),
        recoveredBoundary: transition.recoveredBoundary,
      })),
    ).toEqual([
      {
        edge: 'ACTIVE->MEDIUM',
        effectiveAt: ACTIVE_BOUNDARY,
        recoveredBoundary: true,
      },
      {
        edge: 'MEDIUM->INACTIVE',
        effectiveAt: INACTIVE_BOUNDARY,
        recoveredBoundary: true,
      },
    ]);
  });

  it('restores the single boundary appropriate to the cached status', () => {
    const toMedium = planActivityTransitions({
      fromState: 'ACTIVE',
      toState: 'MEDIUM',
      calculatedAt: new Date('2026-01-15T00:00:00.000Z'),
      lastArtifactAt: LAST_ARTIFACT_AT,
      activeWindowHours: 252,
      inactiveAfterHours: 504,
      recoverElapsedBoundaries: true,
    });
    const toInactive = planActivityTransitions({
      fromState: 'MEDIUM',
      toState: 'INACTIVE',
      calculatedAt: DETECTED_AT,
      lastArtifactAt: LAST_ARTIFACT_AT,
      activeWindowHours: 252,
      inactiveAfterHours: 504,
      recoverElapsedBoundaries: true,
    });

    expect(toMedium.map((item) => item.effectiveAt.toISOString())).toEqual([ACTIVE_BOUNDARY]);
    expect(toInactive.map((item) => item.effectiveAt.toISOString())).toEqual([INACTIVE_BOUNDARY]);
  });

  it('keeps non-window changes as one transition at detection time', () => {
    const transitions = planActivityTransitions({
      fromState: 'ACTIVE',
      toState: 'INACTIVE',
      calculatedAt: DETECTED_AT,
      lastArtifactAt: LAST_ARTIFACT_AT,
      activeWindowHours: 252,
      inactiveAfterHours: 504,
      recoverElapsedBoundaries: false,
    });

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      fromState: 'ACTIVE',
      toState: 'INACTIVE',
      recoveredBoundary: false,
    });
    expect(transitions[0]!.effectiveAt.toISOString()).toBe(DETECTED_AT.toISOString());
  });
});

describe('recalculatePersonLifecycle reconciliation', () => {
  it('writes missed boundaries once and remains idempotent on rerun', async () => {
    let cachedActivity: 'UNKNOWN' | 'ACTIVE' | 'MEDIUM' | 'INACTIVE' = 'ACTIVE';
    let nextBoundary: Date | null = new Date(ACTIVE_BOUNDARY);
    let appliedRuleSetId: string | null = 'rule-set-1';
    const history: Array<{
      key: string;
      fromState: string;
      toState: string;
      effectiveAt: string;
      metadata: Record<string, unknown>;
    }> = [];
    const outbox: unknown[] = [];

    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      const values = parameters ?? [];
      if (sql.includes('FROM persons p') && sql.includes('FOR UPDATE OF p')) {
        return {
          rows: [
            {
              id: CANONICAL_PERSON_ID,
              lifecycle_data_state: 'COMPLETE',
              activation_state: 'ACTIVATED',
              activity_status: cachedActivity,
              next_status_transition_at: nextBoundary,
              applied_lifecycle_rule_set_id: appliedRuleSetId,
              rule_set_id: 'rule-set-1',
              rule_version: 1,
              active_window_hours: 252,
              inactive_after_hours: 504,
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes('FROM artifact_version_contributors avc') &&
        sql.includes('JOIN artifact_versions av')
      ) {
        return {
          rows: [
            {
              qualifies_for_activation: true,
              qualifies_for_activity: true,
              submitted_at: LAST_ARTIFACT_AT,
              recorded_at: LAST_ARTIFACT_AT,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE persons')) {
        cachedActivity = values[2] as typeof cachedActivity;
        nextBoundary = (values[6] as Date | null) ?? null;
        appliedRuleSetId = values[7] as string;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO lifecycle_status_history')) {
        const effectiveAt = values[7] as Date;
        const key = [
          values[0],
          values[1],
          values[2],
          values[3],
          values[5],
          values[6] ?? 'null',
          effectiveAt.toISOString(),
        ].join('|');
        if (history.some((item) => item.key === key)) return { rows: [], rowCount: 0 };
        history.push({
          key,
          fromState: String(values[2]),
          toState: String(values[3]),
          effectiveAt: effectiveAt.toISOString(),
          metadata: JSON.parse(String(values[8])) as Record<string, unknown>,
        });
        return { rows: [{ id: `history-${history.length}` }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outbox_events')) {
        outbox.push(JSON.parse(String(values[1])));
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in lifecycle test: ${sql}`);
    });
    const client = { query } as unknown as PoolClient;

    const first = await recalculatePersonLifecycle(
      client,
      CANONICAL_PERSON_ID,
      'RECONCILIATION',
      null,
      DETECTED_AT,
    );
    const second = await recalculatePersonLifecycle(
      client,
      CANONICAL_PERSON_ID,
      'RECONCILIATION',
      null,
      DETECTED_AT,
    );

    expect(first).toEqual({ found: true, changed: true });
    expect(second).toEqual({ found: true, changed: false });
    expect(cachedActivity).toBe('INACTIVE');
    expect(
      history.map(({ fromState, toState, effectiveAt }) => ({ fromState, toState, effectiveAt })),
    ).toEqual([
      { fromState: 'ACTIVE', toState: 'MEDIUM', effectiveAt: ACTIVE_BOUNDARY },
      { fromState: 'MEDIUM', toState: 'INACTIVE', effectiveAt: INACTIVE_BOUNDARY },
    ]);
    expect(history.every((item) => item.metadata.recoveredMissedBoundary === true)).toBe(true);
    expect(outbox).toHaveLength(2);

    // Even if an external repair makes the cache stale again, the exact history
    // identity guard prevents duplicate transitions and duplicate outbox events.
    cachedActivity = 'ACTIVE';
    nextBoundary = new Date(ACTIVE_BOUNDARY);
    const repaired = await recalculatePersonLifecycle(
      client,
      CANONICAL_PERSON_ID,
      'RECONCILIATION',
      null,
      DETECTED_AT,
    );
    expect(repaired).toEqual({ found: true, changed: true });
    expect(history).toHaveLength(2);
    expect(outbox).toHaveLength(2);
  });

  it('canonicalizes a merged input and reads evidence from the whole cluster', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('WITH requested_person AS')) {
        expect(parameters).toEqual([MERGED_PERSON_ID]);
        return {
          rows: [
            {
              id: CANONICAL_PERSON_ID,
              lifecycle_data_state: 'COMPLETE',
              activation_state: 'ACTIVATED',
              activity_status: 'ACTIVE',
              next_status_transition_at: null,
              applied_lifecycle_rule_set_id: 'rule-set-1',
              rule_set_id: 'rule-set-1',
              rule_version: 1,
              active_window_hours: 252,
              inactive_after_hours: 504,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('JOIN persons contributor')) {
        expect(sql).toContain('contributor.merged_into_person_id = $1');
        expect(parameters).toEqual([CANONICAL_PERSON_ID]);
        return {
          rows: [
            {
              qualifies_for_activation: true,
              qualifies_for_activity: true,
              submitted_at: DETECTED_AT,
              recorded_at: DETECTED_AT,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE persons')) {
        expect(parameters?.[0]).toBe(CANONICAL_PERSON_ID);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in canonical lifecycle test: ${sql}`);
    });

    const result = await recalculatePersonLifecycle(
      { query } as unknown as PoolClient,
      MERGED_PERSON_ID,
      'RECONCILIATION',
      null,
      DETECTED_AT,
    );

    expect(result).toEqual({ found: true, changed: false });
  });

  it('deduplicates version authors by canonical person before recalculation', async () => {
    const canonicalSecond = '00000000-0000-4000-8000-000000000003';
    const profileInputs: unknown[] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id)')) {
        expect(sql).toContain('JOIN persons person');
        return {
          rows: [{ person_id: CANONICAL_PERSON_ID }, { person_id: canonicalSecond }],
          rowCount: 2,
        };
      }
      if (sql.includes('WITH requested_person AS')) {
        profileInputs.push(parameters?.[0]);
        return {
          rows: [
            {
              id: parameters?.[0],
              lifecycle_data_state: 'COMPLETE',
              activation_state: 'NOT_ACTIVATED',
              activity_status: 'UNKNOWN',
              next_status_transition_at: null,
              applied_lifecycle_rule_set_id: 'rule-set-1',
              rule_set_id: 'rule-set-1',
              rule_version: 1,
              active_window_hours: 252,
              inactive_after_hours: 504,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('JOIN persons contributor')) return { rows: [], rowCount: 0 };
      if (sql.includes('UPDATE persons')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL in author canonicalization test: ${sql}`);
    });

    const count = await recalculateVersionAuthors(
      { query } as unknown as PoolClient,
      '00000000-0000-4000-8000-000000000010',
      'RECONCILIATION',
      DETECTED_AT,
    );

    expect(count).toBe(2);
    expect(profileInputs).toEqual([CANONICAL_PERSON_ID, canonicalSecond]);
  });
});
