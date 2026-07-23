import { createHash } from 'node:crypto';

import { Permissions, Roles, hasPermission, permissionsForRoles, type Role } from '@cpi-crm/domain';
import Fastify from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { HttpProblem } from '../src/lib/problem.js';
import { registerCatalogRoutes } from '../src/modules/catalogs/routes.js';
import type { AuthUser } from '../src/types.js';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const RULE_SET_ID = '00000000-0000-4000-8000-000000000011';
const EVENT_ID = '00000000-0000-4000-8000-000000000020';
const FIRST_PERSON_ID = '00000000-0000-4000-8000-000000000030';
const SECOND_PERSON_ID = '00000000-0000-4000-8000-000000000031';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = 'event-request-123';

const organizationRow = {
  id: ORGANIZATION_ID,
  rule_set_id: RULE_SET_ID,
  active_window_hours: 720,
  inactive_after_hours: 2160,
  artifact_baseline_at: null,
  timezone: 'Asia/Novosibirsk',
};

const validPayload = {
  name: 'Demo day',
  status: 'PLANNED',
  participantIds: [] as string[],
};

async function catalogTestApp(
  pool: Pick<Pool, 'query' | 'connect'>,
  roles: Role[] = [Roles.COMMUNITY_MANAGER],
) {
  const app = Fastify({ logger: false });
  const authUser: AuthUser = {
    sub: 'route-test-user',
    userId: USER_ID,
    name: 'Route test user',
    roles,
    permissions: [...permissionsForRoles(roles)],
  };
  app.decorateRequest('authUser', null);
  app.decorate('pool', pool as Pool);
  app.decorate(
    'requirePermission',
    (permission: (typeof Permissions)[keyof typeof Permissions]) => async (request) => {
      request.authUser = authUser;
      if (!hasPermission(roles, permission)) throw new HttpProblem(403, 'Доступ запрещён');
    },
  );
  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof HttpProblem) {
      return reply
        .code(error.status)
        .send({ status: error.status, title: error.title, detail: error.detail });
    }
    if ('validation' in error && error.validation) {
      return reply.code(400).send({ status: 400, title: 'Ошибка валидации' });
    }
    throw error;
  });
  await registerCatalogRoutes(app);
  return app;
}

function eventRequest(payload: Record<string, unknown> = validPayload) {
  return {
    method: 'POST' as const,
    url: '/events',
    headers: { 'idempotency-key': IDEMPOTENCY_KEY },
    payload,
  };
}

describe('event creation route', () => {
  it('atomically creates an event, locked live participations, audit, and idempotent response', async () => {
    const calls: string[] = [];
    const clientQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        calls.push(sql);
        return { rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        calls.push('advisory-lock');
        expect(parameters).toEqual([`cpi-event:${ORGANIZATION_ID}:demo day`]);
        return { rows: [{}] };
      }
      if (sql.includes('FROM events')) {
        calls.push('duplicate-check');
        expect(parameters).toEqual([ORGANIZATION_ID, 'demo day']);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO events')) {
        calls.push('event-insert');
        expect(parameters).toEqual([
          ORGANIZATION_ID,
          null,
          'Demo day',
          'demo day',
          null,
          'ACTIVE',
          new Date('2026-08-10T04:00:00.000Z'),
          new Date('2026-08-10T08:00:00.000Z'),
          USER_ID,
        ]);
        return { rows: [{ id: EVENT_ID }] };
      }
      if (sql.includes('WITH requested(person_id)')) {
        calls.push('participations-insert');
        expect(sql).toContain('FOR UPDATE OF person');
        expect(sql).toContain("SELECT locked.id, $2, 'LIVE'");
        expect(parameters).toEqual([
          [FIRST_PERSON_ID, SECOND_PERSON_ID],
          EVENT_ID,
          ORGANIZATION_ID,
        ]);
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes('INSERT INTO audit_log')) {
        calls.push('audit-insert');
        expect(parameters?.slice(0, 6)).toEqual([
          USER_ID,
          'route-test-user',
          expect.any(String),
          'events.created',
          'event',
          EVENT_ID,
        ]);
        expect(JSON.parse(String(parameters?.[7]))).toEqual({
          name: 'Demo day',
          normalizedName: 'demo day',
          status: 'ACTIVE',
          startsAt: '2026-08-10T04:00:00.000Z',
          endsAt: '2026-08-10T08:00:00.000Z',
          programId: null,
          participantIds: [FIRST_PERSON_ID, SECOND_PERSON_ID],
          participantCount: 2,
          ownerUserId: USER_ID,
          dataOrigin: 'LIVE',
        });
        return { rows: [{ id: '00000000-0000-4000-8000-000000000099' }] };
      }
      if (sql.includes('UPDATE idempotency_records')) {
        calls.push('idempotency-record');
        expect(parameters?.[3]).toBe(201);
        expect(JSON.parse(String(parameters?.[4]))).toEqual({ id: EVENT_ID });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const release = vi.fn();
    const poolQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        expect(parameters?.slice(0, 3)).toEqual(['route-test-user', '/events', IDEMPOTENCY_KEY]);
        return { rows: [{ id: 'idempotency-record' }] };
      }
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      throw new Error(`Unexpected pool SQL: ${sql}`);
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn(async () => ({ query: clientQuery, release }) as unknown as PoolClient),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await catalogTestApp(pool);

    try {
      const response = await app.inject(
        eventRequest({
          name: '  Demo   day  ',
          status: 'ACTIVE',
          startsAt: '2026-08-10T04:00:00.000Z',
          endsAt: '2026-08-10T08:00:00.000Z',
          participantIds: [FIRST_PERSON_ID, SECOND_PERSON_ID],
        }),
      );

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ id: EVENT_ID });
      expect(calls).toEqual([
        'BEGIN',
        'advisory-lock',
        'duplicate-check',
        'event-insert',
        'participations-insert',
        'audit-insert',
        'idempotency-record',
        'COMMIT',
      ]);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('rolls back the event and partial INSERT SELECT when any participant is unavailable', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM events')) return { rows: [] };
      if (sql.includes('INSERT INTO events')) return { rows: [{ id: EVENT_ID }] };
      if (sql.includes('WITH requested(person_id)')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const release = vi.fn();
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        return { rows: [{ id: 'idempotency-record' }] };
      }
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('DELETE FROM idempotency_records')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected pool SQL: ${sql}`);
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn(async () => ({ query: clientQuery, release }) as unknown as PoolClient),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await catalogTestApp(pool);

    try {
      const response = await app.inject(
        eventRequest({
          name: 'Demo day',
          status: 'PLANNED',
          participantIds: [FIRST_PERSON_ID, SECOND_PERSON_ID],
        }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        status: 400,
        title: 'Некоторые участники не найдены',
      });
      expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
        'BEGIN',
        expect.stringContaining('pg_advisory_xact_lock'),
        expect.stringContaining('FROM events'),
        expect.stringContaining('INSERT INTO events'),
        expect.stringContaining('WITH requested(person_id)'),
        'ROLLBACK',
      ]);
      expect(
        poolQuery.mock.calls.some(([sql]) => sql.includes('DELETE FROM idempotency_records')),
      ).toBe(true);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('serializes normalized names and returns 409 before inserting a duplicate', async () => {
    const clientQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) {
        expect(parameters).toEqual([`cpi-event:${ORGANIZATION_ID}:demo day`]);
        return { rows: [{}] };
      }
      if (sql.includes('FROM events')) return { rows: [{ exists: 1 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        return { rows: [{ id: 'idempotency-record' }] };
      }
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('DELETE FROM idempotency_records')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected pool SQL: ${sql}`);
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn(
        async () => ({ query: clientQuery, release: vi.fn() }) as unknown as PoolClient,
      ),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await catalogTestApp(pool);

    try {
      const response = await app.inject(
        eventRequest({ name: ' Demo   DAY ', status: 'PLANNED', participantIds: [] }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        status: 409,
        title: 'Мероприятие с таким названием уже существует',
      });
      expect(clientQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO events'))).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });

  it('replays a completed 201 without reading organization data or starting a transaction', async () => {
    const payload = { name: 'Demo day', status: 'PLANNED', participantIds: [] };
    const payloadHash = createHash('sha256')
      .update('{"name":"Demo day","participantIds":[],"status":"PLANNED"}')
      .digest('hex');
    const poolQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            payload_hash: payloadHash,
            response_status: 201,
            response_body: { id: EVENT_ID },
          },
        ],
      });
    const pool = {
      query: poolQuery,
      connect: vi.fn(),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await catalogTestApp(pool);

    try {
      const response = await app.inject(eventRequest(payload));

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ id: EVENT_ID });
      expect(poolQuery).toHaveBeenCalledTimes(2);
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('requires a valid Idempotency-Key without database work', async () => {
    const pool = {
      query: vi.fn(),
      connect: vi.fn(),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await catalogTestApp(pool);

    try {
      const response = await app.inject({ method: 'POST', url: '/events', payload: validPayload });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ status: 400, title: 'Требуется Idempotency-Key' });
      expect(pool.query).not.toHaveBeenCalled();
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([Roles.METHODOLOGIST, Roles.DATA_STEWARD])(
    'denies event creation to %s before database work',
    async (role) => {
      const pool = {
        query: vi.fn(),
        connect: vi.fn(),
      } as unknown as Pick<Pool, 'query' | 'connect'>;
      const app = await catalogTestApp(pool, [role]);

      try {
        const response = await app.inject(eventRequest());

        expect(response.statusCode).toBe(403);
        expect(pool.query).not.toHaveBeenCalled();
        expect(pool.connect).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it.each([
    {
      title: 'a whitespace-only name',
      payload: { name: '   ', status: 'PLANNED', participantIds: [] },
    },
    {
      title: 'a one-character normalized name',
      payload: { name: ' Я ', status: 'PLANNED', participantIds: [] },
    },
    {
      title: 'control characters in the name',
      payload: { name: 'Demo\nday', status: 'PLANNED', participantIds: [] },
    },
    {
      title: 'endsAt without startsAt',
      payload: {
        name: 'Demo day',
        status: 'PLANNED',
        endsAt: '2026-08-10T08:00:00.000Z',
        participantIds: [],
      },
    },
    {
      title: 'an inverted period',
      payload: {
        name: 'Demo day',
        status: 'PLANNED',
        startsAt: '2026-08-10T08:00:00.000Z',
        endsAt: '2026-08-10T04:00:00.000Z',
        participantIds: [],
      },
    },
    {
      title: 'an unsupported status',
      payload: { name: 'Demo day', status: 'BROKEN', participantIds: [] },
    },
    {
      title: 'duplicate participants',
      payload: {
        name: 'Demo day',
        status: 'PLANNED',
        participantIds: [FIRST_PERSON_ID, FIRST_PERSON_ID],
      },
    },
    {
      title: 'an additional property',
      payload: { name: 'Demo day', status: 'PLANNED', participantIds: [], unexpected: true },
    },
  ])('rejects $title without database work', async ({ payload }) => {
    const pool = {
      query: vi.fn(),
      connect: vi.fn(),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await catalogTestApp(pool);

    try {
      const response = await app.inject(eventRequest(payload));

      expect(response.statusCode).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
