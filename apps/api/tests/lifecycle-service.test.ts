import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { recalculatePersonLifecycle } from '../src/modules/artifacts/lifecycle-service.js';

const CANONICAL_PERSON_ID = '00000000-0000-4000-8000-000000000001';
const MERGED_PERSON_ID = '00000000-0000-4000-8000-000000000002';

describe('API lifecycle recalculation', () => {
  it('writes lifecycle state to the canonical person for a merged input', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('WITH requested_person AS')) {
        expect(parameters).toEqual([MERGED_PERSON_ID]);
        return {
          rows: [
            {
              id: CANONICAL_PERSON_ID,
              lifecycle_data_state: 'COMPLETE',
              activation_state: 'NOT_ACTIVATED',
              activity_status: 'UNKNOWN',
              rule_set_id: '00000000-0000-4000-8000-000000000010',
              rule_version: 1,
              active_window_hours: 252,
              inactive_after_hours: 504,
            },
          ],
        };
      }
      if (sql.includes('FROM artifact_version_contributors avc')) {
        expect(sql).toContain('merged_into_person_id = $1');
        expect(parameters).toEqual([CANONICAL_PERSON_ID]);
        return { rows: [] };
      }
      if (sql.includes('UPDATE persons SET')) {
        expect(parameters?.[0]).toBe(CANONICAL_PERSON_ID);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in API lifecycle test: ${sql}`);
    });

    await recalculatePersonLifecycle(
      { query } as unknown as PoolClient,
      MERGED_PERSON_ID,
      'RECONCILIATION',
    );

    expect(query).toHaveBeenCalledTimes(3);
  });
});
