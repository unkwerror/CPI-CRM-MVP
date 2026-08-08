import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationContext } from '../src/lib/organization.js';
import {
  LockerReviewRequired,
  resolveLockerPerson,
} from '../src/modules/integrations/locker-routes.js';

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
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('person.archived_at IS NOT NULL')) {
      return { rows: overrides.archivedRows ?? [] };
    }
    if (sql.includes('person_deletion_tombstones')) {
      return { rows: overrides.tombstoneRows ?? [] };
    }
    if (sql.includes('INSERT INTO audit_log')) return { rows: [{ id: 'audit' }] };
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, query, calls };
}

describe('resolving a Locker participant', () => {
  it('sends an unrecognised participant without a full name to manual review', async () => {
    const { client } = mockClient();
    await expect(
      resolveLockerPerson(client, organization, { ...baseUser, fullName: 'Павел' }, 'req-1'),
    ).rejects.toBeInstanceOf(LockerReviewRequired);
    await expect(
      resolveLockerPerson(client, organization, { ...baseUser, fullName: 'Павел' }, 'req-1'),
    ).rejects.toMatchObject({ reasonCode: 'FIO_REQUIRED' });
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

  it('keeps a hidden card hidden while the Locker profile has no full name', async () => {
    const { client } = mockClient({
      archivedRows: [{ id: archivedPersonId, canonical_full_name: 'Павел' }],
    });
    await expect(
      resolveLockerPerson(client, organization, { ...baseUser, fullName: 'Павел' }, 'req-4'),
    ).rejects.toMatchObject({ reasonCode: 'FIO_REQUIRED' });
  });
});
