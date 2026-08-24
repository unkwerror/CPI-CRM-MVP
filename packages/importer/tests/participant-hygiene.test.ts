import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { inspectParticipantHygiene } from '../src/participant-hygiene.js';

describe('participant hygiene with Telegram provisional profiles', () => {
  it('keeps provisional profiles out of archive candidates and strict-FIO deduplication', async () => {
    const provisionalId = '11111111-1111-4111-8111-111111111111';
    const invalidLegacyId = '22222222-2222-4222-8222-222222222222';
    const validId = '33333333-3333-4333-8333-333333333333';
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('SELECT id, canonical_full_name, notes, profile_needs_review')) {
        return {
          rows: [
            {
              id: provisionalId,
              canonical_full_name: 'Павел',
              notes: null,
              profile_needs_review: true,
            },
            {
              id: invalidLegacyId,
              canonical_full_name: 'Неизвестный участник',
              notes: null,
              profile_needs_review: false,
            },
            {
              id: validId,
              canonical_full_name: 'Иванов Иван Иванович',
              notes: null,
              profile_needs_review: false,
            },
          ],
        };
      }
      if (sql.includes('WITH roots AS')) {
        expect(parameters?.[1]).toEqual([invalidLegacyId]);
        return { rows: [] };
      }
      if (sql.includes('FROM contact_points contact')) return { rows: [] };
      if (sql.includes('exact_groups AS')) {
        expect(sql).toContain('AND NOT profile_needs_review');
        return { rows: [{ exact_groups: '0', strong_pairs: '0' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await inspectParticipantHygiene(
      { query } as unknown as PoolClient,
      '00000000-0000-4000-8000-000000000010',
    );

    expect(result).toMatchObject({
      activeCanonicalPeople: 3,
      validFio: 1,
      provisionalProfiles: 1,
      invalidFio: 1,
      repairableFio: 0,
      archiveCandidates: 1,
    });
  });
});
