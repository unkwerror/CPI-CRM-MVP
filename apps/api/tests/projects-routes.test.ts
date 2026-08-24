import { Permissions, Roles, hasPermission, permissionsForRoles } from '@cpi-crm/domain';
import Fastify from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { HttpProblem } from '../src/lib/problem.js';
import { registerProjectRoutes } from '../src/modules/projects/routes.js';
import type { AuthUser } from '../src/types.js';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const RULE_SET_ID = '00000000-0000-4000-8000-000000000011';
const EVENT_ID = '00000000-0000-4000-8000-000000000020';
const PROJECT_ID = '00000000-0000-4000-8000-000000000030';
const FIRST_PERSON_ID = '00000000-0000-4000-8000-000000000040';
const SECOND_PERSON_ID = '00000000-0000-4000-8000-000000000041';
const PARTICIPATION_ID = '00000000-0000-4000-8000-000000000050';
const USER_ID = '00000000-0000-4000-8000-000000000001';

async function projectTestApp(pool: Pick<Pool, 'query' | 'connect'>) {
  const app = Fastify({ logger: false });
  const roles = [Roles.COMMUNITY_MANAGER];
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
      return reply.code(error.status).send({ status: error.status, title: error.title });
    }
    throw error;
  });
  await registerProjectRoutes(app);
  return app;
}

describe('project event links', () => {
  it('adds only missing project members when one is already in the event', async () => {
    const clientQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('SELECT id FROM events')) return { rows: [{ id: EVENT_ID }] };
      if (sql.includes('SELECT id FROM projects')) return { rows: [{ id: PROJECT_ID }] };
      if (
        sql.includes('SELECT id FROM event_project_participations') &&
        sql.includes('archived_at IS NULL')
      ) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE event_project_participations')) return { rows: [] };
      if (sql.includes('INSERT INTO event_project_participations')) {
        return { rows: [{ id: PARTICIPATION_ID }] };
      }
      if (sql.includes('FROM project_memberships membership')) {
        return { rows: [{ person_id: FIRST_PERSON_ID }, { person_id: SECOND_PERSON_ID }] };
      }
      if (sql.includes('WITH requested(person_id)')) {
        expect(parameters).toEqual([EVENT_ID, [FIRST_PERSON_ID, SECOND_PERSON_ID]]);
        expect(sql).toContain('COALESCE(observed.merged_into_person_id, observed.id)');
        expect(sql).toContain('NOT EXISTS');
        expect(sql).toContain('ON CONFLICT (person_id, event_id)');
        // База сообщает только об одной вставке: второй участник уже был в мероприятии.
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO audit_log')) return { rows: [{ id: 'audit' }] };
      throw new Error(`Unexpected client SQL: ${sql}`);
    });
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM organization_settings os')) {
        return {
          rows: [
            {
              id: ORGANIZATION_ID,
              rule_set_id: RULE_SET_ID,
              active_window_hours: 720,
              inactive_after_hours: 2160,
              artifact_baseline_at: null,
              timezone: 'Asia/Novosibirsk',
            },
          ],
        };
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    });
    const release = vi.fn();
    const pool = {
      query: poolQuery,
      connect: vi.fn(async () => ({ query: clientQuery, release }) as unknown as PoolClient),
    } as unknown as Pick<Pool, 'query' | 'connect'>;
    const app = await projectTestApp(pool);

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/events/${EVENT_ID}/projects`,
        payload: { projectId: PROJECT_ID },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: PARTICIPATION_ID,
        projectId: PROJECT_ID,
        projectMemberCount: 2,
        participantsAdded: 1,
      });
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});
