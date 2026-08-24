import { Permissions, Roles, hasPermission, permissionsForRoles, type Role } from '@cpi-crm/domain';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { HttpProblem } from '../src/lib/problem.js';
import { registerOperationRoutes } from '../src/modules/operations/routes.js';
import type { AuthUser } from '../src/types.js';

const PERSON_ID = '00000000-0000-4000-8000-000000000010';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000020';
const DUPLICATE_ID = '00000000-0000-4000-8000-000000000030';

async function operationTestApp(query: ReturnType<typeof vi.fn>, roles: Role[]) {
  const app = Fastify({ logger: false });
  const authUser: AuthUser = {
    sub: 'duplicate-route-test',
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'Duplicate route test',
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
  await registerOperationRoutes(app);
  return app;
}

describe('participant duplicate suggestions', () => {
  it('returns a detailed bot/CRM comparison for a two-token name overlap', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      expect(parameters).toEqual([PERSON_ID]);
      expect(sql).toContain('name_match.token_overlap >= 2');
      expect(sql).toContain("identity.source_namespace IN ('locker.user', 'locker.telegram')");
      expect(sql).toContain('count(DISTINCT membership.project_id)');
      return {
        rows: [
          {
            id: CANDIDATE_ID,
            canonical_full_name: 'Куракин Антон Юрьевич',
            primary_contact: '+7 913 000-00-00',
            organization_name: 'ЦПИ',
            faculty: 'ИТ',
            profile_needs_review: false,
            archived: false,
            from_bot: false,
            artifact_count: '3',
            event_count: '2',
            project_count: '1',
            created_at: new Date('2026-08-01T04:00:00.000Z'),
            open_candidate_id: DUPLICATE_ID,
            open_candidate_reasons: ['Совпали фамилия и имя с профилем Telegram'],
            confidence_basis_points: 8600,
            exact_name: false,
            prefix_name: true,
            token_overlap: 2,
            exact_contact: false,
          },
        ],
      };
    });
    const app = await operationTestApp(query, [Roles.DATA_STEWARD]);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/people/${PERSON_ID}/duplicate-suggestions`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            id: CANDIDATE_ID,
            canonicalFullName: 'Куракин Антон Юрьевич',
            primaryContact: '+7 913 000-00-00',
            organization: 'ЦПИ',
            faculty: 'ИТ',
            fromBot: false,
            profileNeedsReview: false,
            archived: false,
            artifactCount: 3,
            eventCount: 2,
            projectCount: 1,
            createdAt: '2026-08-01T04:00:00.000Z',
            openCandidateId: DUPLICATE_ID,
            confidence: 0.86,
            reasons: ['Совпали фамилия и имя с профилем Telegram', 'Совпали фамилия и имя'],
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('keeps merge suggestions restricted to duplicate resolvers', async () => {
    const query = vi.fn();
    const app = await operationTestApp(query, [Roles.COMMUNITY_MANAGER]);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/people/${PERSON_ID}/duplicate-suggestions`,
      });
      expect(response.statusCode).toBe(403);
      expect(query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
