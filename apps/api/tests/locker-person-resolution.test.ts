import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationContext } from '../src/lib/organization.js';
import { resolveLockerPerson } from '../src/modules/integrations/locker-routes.js';

const organization: OrganizationContext = {
  id: '22222222-2222-4222-8222-222222222222',
  ruleSetId: '33333333-3333-4333-8333-333333333333',
} as OrganizationContext;

const archivedPersonId = '44444444-4444-4444-8444-444444444444';

const baseUser = {
  lockerUserId: '55555555-5555-4555-8555-555555555555',
  telegramUserId: '803284122',
  telegramUsername: 'pavel',
  fullName: 'Глазырин Павел Андреевич',
};

/**
 * Порядок запросов в резолвере зависит от того, разобралось ли ФИО, поэтому
 * заглушка отвечает по содержимому SQL, а не по номеру вызова.
 */
function mockClient(overrides: { archivedRows?: unknown[]; tombstoneRows?: unknown[] } = {}) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    calls.push(sql);
    if (sql.includes('person.archived_at IS NOT NULL')) {
      return { rows: overrides.archivedRows ?? [] };
    }
    if (sql.includes('person_deletion_tombstones')) {
      return { rows: overrides.tombstoneRows ?? [] };
    }
    if (sql.includes('INSERT INTO persons')) return { rows: [{ id: archivedPersonId }] };
    if (sql.includes('INSERT INTO audit_log')) return { rows: [{ id: 'audit' }] };
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, query, calls };
}

describe('resolving a Locker participant', () => {
  it('creates a visible provisional card for an unrecognised incomplete profile', async () => {
    const { client, query } = mockClient();
    const result = await resolveLockerPerson(
      client,
      organization,
      { ...baseUser, fullName: 'Павел', profileIncomplete: true },
      'req-1',
    );

    expect(result).toEqual({ personId: archivedPersonId, resolution: 'CREATED' });
    const createCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO persons'),
    );
    expect(createCall?.[1]).toEqual([
      organization.id,
      'Павел',
      'павел',
      null,
      null,
      null,
      organization.ruleSetId,
      true,
    ]);
  });

  it('does not create a participant when several cards share the Telegram id', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("contact.type = 'TELEGRAM'") && sql.includes('messenger_stable_id = $2')) {
        return { rows: [{ person_id: 'a' }, { person_id: 'b' }] };
      }
      return { rows: [] };
    });
    await expect(
      resolveLockerPerson({ query } as unknown as PoolClient, organization, baseUser, 'req-2'),
    ).rejects.toMatchObject({ reasonCode: 'PERSON_AMBIGUOUS' });
  });

  it('brings back a card hidden by the full-name hygiene instead of duplicating it', async () => {
    const { client, query, calls } = mockClient({
      archivedRows: [{ id: archivedPersonId, canonical_full_name: 'Павел' }],
    });

    const result = await resolveLockerPerson(client, organization, baseUser, 'req-3');

    expect(result).toMatchObject({ personId: archivedPersonId, resolution: 'RESTORED' });
    const restoring = calls.find(
      (sql) => sql.includes('UPDATE persons') && sql.includes('archived_at = NULL'),
    );
    expect(restoring).toContain('canonical_full_name = $2');
    expect(
      calls.some((sql) => sql.includes('UPDATE event_participations SET archived_at = NULL')),
    ).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO persons'))).toBe(false);

    const restoreCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('archived_at = NULL, updated_at = now()'),
    );
    expect(restoreCall).toBeDefined();
  });

  it('does not resurrect a participant deleted on request', async () => {
    const { client, calls } = mockClient({ tombstoneRows: [{ deleted_at: new Date() }] });

    await expect(
      resolveLockerPerson(client, organization, baseUser, 'req-5'),
    ).rejects.toMatchObject({ reasonCode: 'DELETED_IDENTITY' });
    expect(calls.some((sql) => sql.includes('INSERT INTO persons'))).toBe(false);
  });

  it('restores a hidden card as provisional while the Locker profile is incomplete', async () => {
    const { client, query } = mockClient({
      archivedRows: [{ id: archivedPersonId, canonical_full_name: 'Павел' }],
    });
    const result = await resolveLockerPerson(
      client,
      organization,
      { ...baseUser, fullName: 'Павел', profileIncomplete: true },
      'req-4',
    );

    expect(result).toEqual({ personId: archivedPersonId, resolution: 'RESTORED' });
    const restoreCall = query.mock.calls.find(
      ([sql]) =>
        String(sql).includes('UPDATE persons') && String(sql).includes('archived_at = NULL'),
    );
    expect(restoreCall?.[1]?.at(-1)).toBe(true);
  });
});
