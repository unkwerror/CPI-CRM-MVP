import { Permissions, Roles, hasPermission, permissionsForRoles, type Role } from '@cpi-crm/domain';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { HttpProblem } from '../src/lib/problem.js';
import { registerEventRoutes } from '../src/modules/events/routes.js';
import type { AuthUser } from '../src/types.js';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const RULE_SET_ID = '00000000-0000-4000-8000-000000000011';
const EVENT_ID = '00000000-0000-4000-8000-000000000020';
const PERSON_ID = '00000000-0000-4000-8000-000000000030';

const organizationRow = {
  id: ORGANIZATION_ID,
  rule_set_id: RULE_SET_ID,
  active_window_hours: 720,
  inactive_after_hours: 2160,
  artifact_baseline_at: null,
  timezone: 'Asia/Novosibirsk',
};

async function eventTestApp(
  query: ReturnType<typeof vi.fn>,
  roles: Role[] = [Roles.METHODOLOGIST],
) {
  const app = Fastify({ logger: false });
  const authUser: AuthUser = {
    sub: 'route-test-user',
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'Route test user',
    roles,
    permissions: [...permissionsForRoles(roles)],
  };
  app.decorateRequest('authUser', null);
  app.decorate('pool', { query } as unknown as Pool);
  app.decorate(
    'requirePermission',
    (permission: (typeof Permissions)[keyof typeof Permissions]) => async (request) => {
      request.authUser = authUser;
      if (!hasPermission(roles, permission)) throw new HttpProblem(403, 'Доступ запрещён');
    },
  );
  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof HttpProblem) {
      return reply.code(error.status).send({ status: error.status, title: error.title });
    }
    throw error;
  });
  await registerEventRoutes(app);
  return app;
}

describe('event routes', () => {
  it('applies search and limit while counting canonical participants', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      expect(sql).toContain(
        'count(DISTINCT COALESCE(participant.merged_into_person_id, participant.id))',
      );
      expect(sql).toContain('name ILIKE $2');
      expect(sql).toContain('LIMIT $3 OFFSET $4');
      expect(parameters).toEqual([ORGANIZATION_ID, '%Demo day%', 25, 0]);
      return {
        rows: [
          {
            id: EVENT_ID,
            name: 'Demo day',
            status: 'COMPLETED',
            starts_at: new Date('2026-05-15T03:00:00.000Z'),
            ends_at: null,
            participant_count: '2',
            artifact_count: '3',
            total_count: '1',
          },
        ],
      };
    });
    const app = await eventTestApp(query);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/events?q=%20Demo%20day%20&limit=25',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            id: EVENT_ID,
            name: 'Demo day',
            status: 'COMPLETED',
            startsAt: '2026-05-15T03:00:00.000Z',
            endsAt: null,
            participantCount: 2,
            artifactCount: 3,
          },
        ],
        total: 1,
      });
    } finally {
      await app.close();
    }
  });

  it('combines event facets and preserves the filtered total on an empty page', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      expect(sql).toContain('status = $2');
      expect(sql).toContain('COALESCE(ends_at, starts_at) < now()');
      expect(sql).toContain('participant_count > 0');
      expect(sql).toContain('artifact_count = 0');
      expect(sql).toContain('LEFT JOIN paged_events page ON true');
      expect(parameters).toEqual([ORGANIZATION_ID, 'COMPLETED', 20, 40]);
      return {
        rows: [
          {
            id: null,
            name: null,
            status: null,
            starts_at: null,
            ends_at: null,
            participant_count: null,
            artifact_count: null,
            total_count: '41',
          },
        ],
      };
    });
    const app = await eventTestApp(query);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/events?status=COMPLETED&period=PAST&participants=WITH&artifacts=WITHOUT&limit=20&offset=40',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [], total: 41 });
    } finally {
      await app.close();
    }
  });

  it('returns one canonical participant without contacts or raw source payloads to a reader', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('SELECT id, name, status, starts_at, ends_at')) {
        expect(parameters).toEqual([EVENT_ID, ORGANIZATION_ID]);
        return {
          rows: [
            {
              id: EVENT_ID,
              name: 'Demo day',
              status: 'COMPLETED',
              starts_at: new Date('2026-05-15T03:00:00.000Z'),
              ends_at: null,
            },
          ],
        };
      }
      expect(parameters).toEqual([EVENT_ID, ORGANIZATION_ID]);
      expect(sql).toContain(
        'SELECT DISTINCT COALESCE(observed.merged_into_person_id, observed.id) AS person_id',
      );
      expect(sql).toContain('LEFT JOIN LATERAL (SELECT NULL::text AS primary_contact)');
      return {
        rows: [
          {
            id: PERSON_ID,
            canonical_full_name: 'Иван Иванов',
            activation_state: 'ACTIVATED',
            activity_status: 'UNKNOWN',
            last_artifact_at: null,
            primary_contact: null,
            participation_count: '2',
            decisions: ['APPROVED'],
            attendances: ['ATTENDED'],
            comments: ['Комментарий из таблицы'],
            source_count: '2',
            artifact_count: '1',
            artifacts: [
              {
                id: '00000000-0000-4000-8000-000000000040',
                title: 'Презентация',
                typeName: 'Питч-дек',
                latestVersionId: '00000000-0000-4000-8000-000000000041',
                latestVersionStatus: 'SUBMITTED',
                submittedAt: null,
              },
            ],
            // A driver returning extra columns must not accidentally expose them.
            raw_json: { secret: 'must-not-leak' },
          },
        ],
      };
    });
    const app = await eventTestApp(query, [Roles.METHODOLOGIST]);

    try {
      const response = await app.inject({ method: 'GET', url: `/events/${EVENT_ID}` });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.participants).toHaveLength(1);
      expect(body.participants[0]).toMatchObject({
        id: PERSON_ID,
        canonicalFullName: 'Иван Иванов',
        primaryContact: null,
        participationCount: 2,
        comments: ['Комментарий из таблицы'],
        sourceCount: 2,
        artifactCount: 1,
      });
      expect(response.body).not.toContain('must-not-leak');
      expect(response.body).not.toContain('raw_json');
      expect(queries).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
});
