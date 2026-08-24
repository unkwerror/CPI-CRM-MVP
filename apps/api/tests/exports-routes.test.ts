import rateLimit from '@fastify/rate-limit';
import { Permissions, Roles, hasPermission, permissionsForRoles, type Role } from '@cpi-crm/domain';
import { readEventAttendanceWorkbook } from '@cpi-crm/importer';
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
  app.decorate('config', {
    storage: {
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKey: 'test',
      secretKey: 'test-secret',
      bucket: 'cpi-artifacts',
      prefix: 'crm/',
      publicBase: '',
    },
  } as never);
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

/** Имена записей читаются из центрального каталога ZIP — он всегда в конце файла. */
function readZipEntryNames(zip: Buffer): string[] {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = zip.lastIndexOf(signature);
  expect(endOffset).toBeGreaterThanOrEqual(0);
  const total = zip.readUInt16LE(endOffset + 10);
  let cursor = zip.readUInt32LE(endOffset + 16);
  const names: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    names.push(zip.toString('utf8', cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

describe('participant export route', () => {
  it('exports an event XLSX with separate FIO columns and attendance', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('SELECT id, name FROM events')) {
        expect(parameters).toEqual([EVENT_ID, ORGANIZATION_ID]);
        return { rows: [{ id: EVENT_ID, name: 'Demo day' }] };
      }
      if (sql.includes('WITH canonical_participants AS')) {
        return {
          rows: [
            {
              last_name: 'Иванов',
              first_name: 'Иван',
              patronymic: 'Иванович',
              canonical_full_name: 'Иванов Иван Иванович',
              email: null,
              phone: null,
              telegram: '@ivanov',
              telegram_user_id: '12345',
              attended: true,
              decisions: ['ACCEPTED'],
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO audit_log')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const app = await exportTestApp(query, [Roles.DATA_STEWARD]);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/exports/events/${EVENT_ID}/participants.xlsx`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const workbook = await readEventAttendanceWorkbook(response.rawPayload);
      expect(workbook.people[0]).toMatchObject({
        lastName: 'Иванов',
        firstName: 'Иван',
        patronymic: 'Иванович',
      });
    } finally {
      await app.close();
    }
  });

  it('fails closed without exports.bulk and does not access source data', async () => {
    const query = vi.fn();
    const app = await exportTestApp(query, [Roles.COMMUNITY_MANAGER]);

    try {
      const response = await app.inject({ method: 'GET', url: '/exports/participants.xlsx' });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ status: 403, title: 'Доступ запрещён' });
      expect(query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('exports canonical participants using artifact/profile filters as XLSX', async () => {
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
        true,
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
            profile_needs_review: true,
            from_bot: true,
            artifact_count: '1',
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
      `/exports/participants.xlsx?q=%20Alpha%20&hasArtifacts=true` +
      `&profileNeedsReview=true&eventId=${EVENT_ID}&awaitingReview=true`;

    try {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="cpi-participants-event-${EVENT_ID}.xlsx"`,
      );
      expect([...response.rawPayload.subarray(0, 2)]).toEqual([0x50, 0x4b]);

      expect(exportSql).toContain('p.merged_into_person_id IS NULL');
      expect(exportSql).toContain('p.normalized_full_name = $3');
      expect(exportSql).toContain('contact.normalized_value = ANY($4::text[])');
      expect(exportSql).toContain('p.profile_needs_review = $5');
      expect(exportSql).toContain('participation.event_id = $6');
      expect(exportSql).toContain('member.id = p.id OR member.merged_into_person_id = p.id');
      expect(exportSql).toContain("version.status = 'SUBMITTED'");
      expect(exportParameters).toEqual([
        ORGANIZATION_ID,
        'Alpha',
        'alpha',
        ['alpha'],
        true,
        EVENT_ID,
      ]);

      expect(auditParameters.slice(0, 2)).toEqual([USER_ID, 'route-test-user']);
      expect(JSON.parse(String(auditParameters[3]))).toEqual({
        filters: {
          q: ' Alpha ',
          hasArtifacts: true,
          profileNeedsReview: true,
          eventId: EVENT_ID,
          awaitingReview: true,
        },
        rows: 1,
        format: 'XLSX',
      });
    } finally {
      await app.close();
    }
  });

  it('packs the event workbook, manifest and unavailable files into the ZIP', async () => {
    const participantId = '00000000-0000-4000-8000-000000000031';
    let auditPayload: Record<string, unknown> = {};
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM organization_settings os')) return { rows: [organizationRow] };
      if (sql.includes('SELECT id, name FROM events')) {
        return { rows: [{ id: EVENT_ID, name: 'Регистрация ООО' }] };
      }
      if (sql.includes('WITH canonical_participants AS')) {
        return {
          rows: [
            {
              person_id: participantId,
              last_name: 'Глазырин',
              first_name: 'Павел',
              patronymic: 'Андреевич',
              canonical_full_name: 'Глазырин Павел Андреевич',
              email: null,
              phone: null,
              telegram: null,
              telegram_user_id: null,
              attended: true,
              decisions: ['ACCEPTED'],
            },
          ],
        };
      }
      if (sql.includes('WITH event_participants AS')) {
        expect(parameters).toEqual([EVENT_ID]);
        return {
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000040',
              title: 'Артефакт по открытию ООО',
              type_name: 'Документ',
              status: 'SUBMITTED',
              latest_version_id: '00000000-0000-4000-8000-000000000041',
              version_number: 1,
              latest_version_status: 'SUBMITTED',
              submitted_at: new Date('2026-08-04T09:00:00.000Z'),
              score: 8,
              decision: 'ACCEPTED',
              reviewed_at: null,
              reviewer_name: null,
              authors: [
                { id: participantId, name: 'Глазырин Павел Андреевич', isParticipant: true },
              ],
              files: [
                {
                  id: '00000000-0000-4000-8000-000000000042',
                  fileName: 'ООО.docx',
                  sizeBytes: 1024,
                  status: 'QUARANTINED',
                  storageProvider: 'LOCKER',
                },
              ],
              external_urls: null,
              has_locker: true,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO audit_log')) {
        auditPayload = JSON.parse(String((parameters ?? [])[4]));
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const app = await exportTestApp(query, [Roles.DATA_STEWARD]);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/exports/events/${EVENT_ID}/package.zip`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/zip');
      const entries = readZipEntryNames(response.rawPayload);
      expect(entries).toContain('Участники.xlsx');
      expect(entries).toContain('manifest.json');
      // Файл в карантине не качается, но обязан попасть в manifest со скипами.
      expect(entries.some((name) => name.startsWith('artifacts/'))).toBe(false);
      expect(auditPayload).toMatchObject({ participants: 1, artifacts: 1, files: 0, skipped: 1 });
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
        const response = await app.inject({ method: 'GET', url: '/exports/participants.xlsx' });
        expect(response.statusCode).toBe(200);
      }

      const blocked = await app.inject({ method: 'GET', url: '/exports/participants.xlsx' });
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
