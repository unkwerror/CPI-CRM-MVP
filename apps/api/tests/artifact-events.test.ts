import { CreateArtifactBody } from '@cpi-crm/contracts';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  assertArtifactEventAvailable,
  assertArtifactEventHasAuthor,
} from '../src/modules/artifacts/routes.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const authorId = '33333333-3333-4333-8333-333333333333';

describe('artifact event links', () => {
  it('accepts a valid optional event identifier in the create contract', () => {
    expect(CreateArtifactBody.properties.eventId).toMatchObject({
      type: 'string',
      format: 'uuid',
    });
    expect(CreateArtifactBody.required).not.toContain('eventId');
  });

  it('checks that the selected event belongs to the current organization', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: eventId }] });
    await assertArtifactEventAvailable({ query } as unknown as PoolClient, eventId, organizationId);
    expect(String(query.mock.calls[0]?.[0])).toContain('organization_id = $2');
    expect(query.mock.calls[0]?.[1]).toEqual([eventId, organizationId]);
  });

  it('rejects an event outside the current organization', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      assertArtifactEventAvailable({ query } as unknown as PoolClient, eventId, organizationId),
    ).rejects.toMatchObject({ status: 400, title: 'Мероприятие недоступно' });
  });

  it('accepts an author whose canonical cluster participated in the event', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ exists: true }] });
    await assertArtifactEventHasAuthor({ query } as unknown as PoolClient, eventId, [authorId]);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'COALESCE(participant.merged_into_person_id, participant.id)',
    );
    expect(query.mock.calls[0]?.[1]).toEqual([eventId, [authorId]]);
  });

  it('rejects a linked event when none of the authors participated', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ exists: false }] });
    await expect(
      assertArtifactEventHasAuthor({ query } as unknown as PoolClient, eventId, [authorId]),
    ).rejects.toMatchObject({
      status: 400,
      title: 'Нет участника мероприятия среди авторов',
    });
  });
});
