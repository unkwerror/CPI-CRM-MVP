import rateLimit from '@fastify/rate-limit';
import { Permissions, Roles, hasPermission, permissionsForRoles, type Role } from '@cpi-crm/domain';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { HttpProblem } from '../src/lib/problem.js';
import { registerExportRoutes } from '../src/modules/exports/routes.js';
import type { AuthUser } from '../src/types.js';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const RULE_SET_ID = '00000000-0000-4000-8000-000000000011';
const EVENT_ID = '00000000-0000-4000-8000-000000000020';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const organizationRow = {
  id: ORGANIZATION_ID,
  rule_set_id: RULE_SET_ID,
  active_window_hours: 720,
  inactive_after_hours: 2160,
  artifact_baseline_at: null,
  timezone: 'Asia/Novosibirsk',
};

async function exportTestApp(query: ReturnType<typeof vi.fn>, roles: Role[]) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { global: false });
  const authUser: AuthUser = {
    sub: 'route-test-user',
    userId: USER_ID,
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
  await registerExportRoutes(app);
  return app;
}

describe('participant export route', () => {
  it('fails closed without exports.bulk and does not access source data', async () => {
    const query = vi.fn();
    const app = await exportTestApp(query, [Roles.COMMUNITY_MANAGER]);

    try {
      const response = await app.inject({ method: 'GET', url: '/exports/participants.csv' });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ status: 403, title: 'Доступ запрещён' });
      expect(query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('exports canonical participants using every supplied filter and safe CSV cells', async () => {
    let exportSql = '';
    let exportParameters: unknown[] = [];
    let auditParameters: unknown[] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('SELECT count(*)::text AS total')) {
        exportSql = sql;
        exportParameters = parameters ?? [];
        return { rows: [{ total: '1' }] };
      }
      if (sql.includes('INSERT INTO audit_log')) {
        auditParameters = parameters ?? [];
        return { rows: [] };
      }
      expect(sql).toContain('WITH export_people AS MATERIALIZED');
      expect(parameters).toEqual([
        ORGANIZATION_ID,
        'Alpha',
        'alpha',
        ['alpha'],
        'ACTIVE',
        'ACTIVATED',
        EVENT_ID,
        25,
        0,
      ]);
      return {
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000030',
            canonical_full_name: '=2+3',
            contacts: ' +cmd | телефон "рабочий"',
            affiliations: 'Организация "А"\nФакультет',
            activation_state: 'ACTIVATED',
            activity_status: 'ACTIVE',
            last_artifact_at: new Date('2026-07-20T10:30:00.000Z'),
            events: '@SUM(A1:A2)',
            artifacts: '-1',
            comments: 'Обычный комментарий',
            source_rows: [
              {
                sheet: 'Лист 1',
                row: 7,
                fields: [{ header: 'Параметр', address: 'D7', value: 'значение' }],
              },
            ],
          },
        ],
      };
    });
    const app = await exportTestApp(query, [Roles.DATA_STEWARD]);
    const url =
      `/exports/participants.csv?q=%20Alpha%20&activityStatus=ACTIVE` +
      `&activationState=ACTIVATED&eventId=${EVENT_ID}&awaitingReview=true`;

    try {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="cpi-participants-event-${EVENT_ID}.csv"`,
      );
      expect([...response.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(response.body.startsWith('\uFEFF"ID";"ФИО";')).toBe(true);
      expect(response.body).toContain('"\'=2+3"');
      expect(response.body).toContain('"\' +cmd | телефон ""рабочий"""');
      expect(response.body).toContain('"Организация ""А""\nФакультет"');
      expect(response.body).toContain('"\'@SUM(A1:A2)"');
      expect(response.body).toContain('"\'-1"');
      expect(response.body).toContain('"Лист 1"');

      expect(exportSql).toContain('p.merged_into_person_id IS NULL');
      expect(exportSql).toContain('p.normalized_full_name = $3');
      expect(exportSql).toContain('contact.normalized_value = ANY($4::text[])');
      expect(exportSql).toContain('participation.event_id = $7');
      expect(exportSql).toContain('member.id = p.id OR member.merged_into_person_id = p.id');
      expect(exportSql).toContain("version.status = 'SUBMITTED'");
      expect(exportParameters).toEqual([
        ORGANIZATION_ID,
        'Alpha',
        'alpha',
        ['alpha'],
        'ACTIVE',
        'ACTIVATED',
        EVENT_ID,
      ]);

      expect(auditParameters.slice(0, 2)).toEqual([USER_ID, 'route-test-user']);
      expect(JSON.parse(String(auditParameters[3]))).toEqual({
        filters: {
          q: ' Alpha ',
          activityStatus: 'ACTIVE',
          activationState: 'ACTIVATED',
          eventId: EVENT_ID,
          awaitingReview: true,
        },
        rows: 1,
        streaming: true,
      });
    } finally {
      await app.close();
    }
  });

  it('rate-limits repeated heavy exports per authenticated user', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('SELECT count(*)::text AS total')) return { rows: [{ total: '0' }] };
      if (sql.includes('INSERT INTO audit_log')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const app = await exportTestApp(query, [Roles.DATA_STEWARD]);

    try {
      for (let requestNumber = 0; requestNumber < 4; requestNumber += 1) {
        const response = await app.inject({ method: 'GET', url: '/exports/participants.csv' });
        expect(response.statusCode).toBe(200);
      }

      const blocked = await app.inject({ method: 'GET', url: '/exports/participants.csv' });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(blocked.json()).toMatchObject({
        status: 429,
        title: 'Слишком много тяжёлых операций',
      });
      expect(query).toHaveBeenCalledTimes(12);
    } finally {
      await app.close();
    }
  });
});
