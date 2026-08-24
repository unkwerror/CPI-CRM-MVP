import { Permissions, Roles, hasPermission, permissionsForRoles } from '@cpi-crm/domain';
import Fastify from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { ApiConfig } from '../src/config.js';
import { HttpProblem } from '../src/lib/problem.js';
import { registerProjectApplicationRoutes } from '../src/modules/projects/application-routes.js';
import type { AuthUser } from '../src/types.js';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const APPLICATION_ID = '00000000-0000-4000-8000-000000000020';
const PERSON_ID = '00000000-0000-4000-8000-000000000030';
const PROJECT_ID = '00000000-0000-4000-8000-000000000040';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const organizationRow = {
  id: ORGANIZATION_ID,
  rule_set_id: '00000000-0000-4000-8000-000000000011',
  active_window_hours: 720,
  inactive_after_hours: 2160,
  artifact_baseline_at: null,
  timezone: 'Asia/Novosibirsk',
};

async function applicationTestApp(pool: Pick<Pool, 'query' | 'connect'>) {
  const app = Fastify({ logger: false });
  const roles = [Roles.ADMIN];
  const authUser: AuthUser = {
    sub: 'admin-test-user',
    userId: USER_ID,
    name: 'Admin',
    roles,
    permissions: [...permissionsForRoles(roles)],
  };
  app.decorateRequest('authUser', null);
  app.decorate('pool', pool as Pool);
  app.decorate('config', {
    locker: { integrationToken: 'x'.repeat(32) },
  } as ApiConfig);
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
  await registerProjectApplicationRoutes(app);
  return app;
}

describe('project applications', () => {
  it('creates an IDEA project and makes the applicant its initiator when an admin approves', async () => {
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      throw new Error(`Unexpected pool SQL: ${sql}`);
    });
    const clientQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('FROM project_applications application') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: APPLICATION_ID,
              organization_id: ORGANIZATION_ID,
              application_type: 'CREATE',
              status: 'PENDING',
              applicant_person_id: PERSON_ID,
              applicant_name: 'Иванов Иван Иванович',
              proposed_name: 'Новый проект',
              proposed_description: 'Описание',
              owner_user_id: null,
              lead_person_id: null,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO projects')) {
        expect(sql).toContain("'IDEA'");
        expect(sql).toContain('visible_in_bot');
        expect(parameters).toEqual([
          ORGANIZATION_ID,
          'Новый проект',
          'новый проект',
          'Описание',
          USER_ID,
          PERSON_ID,
        ]);
        return { rows: [{ id: PROJECT_ID }] };
      }
      if (sql.includes('INSERT INTO project_memberships')) {
        expect(sql).toContain("'Инициатор'");
        expect(parameters).toEqual([PROJECT_ID, PERSON_ID]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE project_applications')) {
        return {
          rows: [
            {
              id: APPLICATION_ID,
              application_type: 'CREATE',
              status: 'APPROVED',
              project_id: null,
              created_project_id: PROJECT_ID,
              reviewed_at: new Date('2026-08-24T12:00:00Z'),
              review_comment: null,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO audit_log')) return { rows: [{ id: 'audit' }] };
      throw new Error(`Unexpected client SQL: ${sql}`);
    });
    const release = vi.fn();
    const app = await applicationTestApp({
      query: poolQuery,
      connect: vi.fn(
        async () => ({ query: clientQuery, release }) as unknown as PoolClient,
      ),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/project-applications/${APPLICATION_ID}/decision`,
        payload: { decision: 'APPROVED' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'APPROVED',
        created_project_id: PROJECT_ID,
      });
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});
