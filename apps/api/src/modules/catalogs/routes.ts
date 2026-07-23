import { CreateEventBody } from '@cpi-crm/contracts';
import { Permissions, normalizeFullName, normalizeUnicode } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { beginIdempotentRequest } from '../../lib/idempotency.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const resourceBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 500 }),
  status: Type.Optional(Type.String({ maxLength: 100 })),
  startsAt: Type.Optional(Type.String({ format: 'date-time' })),
  endsAt: Type.Optional(Type.String({ format: 'date-time' })),
  programId: Type.Optional(Type.String({ format: 'uuid' })),
  description: Type.Optional(Type.String({ maxLength: 10_000 })),
});

const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;
const eventBodyFields = new Set([
  'name',
  'status',
  'startsAt',
  'endsAt',
  'programId',
  'participantIds',
]);

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  for (const resource of ['programs', 'events', 'projects'] as const) {
    if (resource !== 'events') {
      app.get(
        `/${resource}`,
        { preHandler: app.requirePermission(Permissions.PEOPLE_READ), schema: { tags: ['Связи'] } },
        async () => {
          const organization = await getOrganizationContext(app.pool);
          const result = await app.pool.query(
            `SELECT id, name, status, starts_at, ends_at, version
               FROM ${resource}
              WHERE organization_id = $1 AND archived_at IS NULL
              ORDER BY starts_at DESC NULLS LAST, name
              LIMIT 200`,
            [organization.id],
          );
          return { items: result.rows };
        },
      );
    }

    app.post(
      `/${resource}`,
      {
        ...(resource === 'events' ? { preValidation: rejectUnexpectedEventProperties } : {}),
        preHandler: app.requirePermission(
          resource === 'events' ? Permissions.EVENTS_WRITE : Permissions.PEOPLE_WRITE,
        ),
        schema: { tags: ['Связи'], body: resource === 'events' ? CreateEventBody : resourceBody },
      },
      async (request, reply) => {
        const body = request.body as {
          name: string;
          status?: string;
          startsAt?: string;
          endsAt?: string;
          programId?: string;
          description?: string;
          participantIds?: string[];
        };
        const unicodeName = normalizeUnicode(body.name);
        if (resource === 'events' && controlCharacters.test(unicodeName)) {
          throw new HttpProblem(400, 'Название содержит недопустимые управляющие символы');
        }
        const name = unicodeName.replace(/\s+/gu, ' ').trim();
        if (!name) throw new HttpProblem(400, 'Название не может быть пустым');
        if (resource === 'events' && [...name].length < 2) {
          throw new HttpProblem(400, 'Название должно содержать минимум 2 символа');
        }
        const startsAt = body.startsAt ? new Date(body.startsAt) : null;
        const endsAt = body.endsAt ? new Date(body.endsAt) : null;
        if (
          (startsAt && Number.isNaN(startsAt.getTime())) ||
          (endsAt && Number.isNaN(endsAt.getTime()))
        ) {
          throw new HttpProblem(400, 'Некорректная дата мероприятия');
        }
        if (resource === 'events' && endsAt && !startsAt) {
          throw new HttpProblem(400, 'Дата окончания требует даты начала');
        }
        if (startsAt && endsAt && endsAt <= startsAt)
          throw new HttpProblem(400, 'Дата окончания должна быть позже начала');
        const normalizedName = normalizeFullName(name);
        const idempotency =
          resource === 'events'
            ? await beginIdempotentRequest(app.pool, {
                subject: request.authUser!.sub,
                route: '/events',
                key: headerValue(request.headers['idempotency-key']),
                payload: request.body,
              })
            : null;
        if (idempotency?.replay) {
          return reply.code(idempotency.status).send(idempotency.body);
        }

        try {
          const organization = await getOrganizationContext(app.pool);
          const created = await transaction(app.pool, async (client) => {
            const participantIds = resource === 'events' ? (body.participantIds ?? []) : [];
            if (resource === 'events') {
              await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
                `cpi-event:${organization.id}:${normalizedName}`,
              ]);
              const duplicate = await client.query(
                `SELECT 1
                   FROM events
                  WHERE organization_id = $1
                    AND normalized_name = $2
                    AND archived_at IS NULL
                  LIMIT 1`,
                [organization.id, normalizedName],
              );
              if (duplicate.rows[0]) {
                throw new HttpProblem(409, 'Мероприятие с таким названием уже существует');
              }
            }
            if ((resource === 'events' || resource === 'projects') && body.programId) {
              const program = await client.query(
                `SELECT 1 FROM programs
                  WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
                [body.programId, organization.id],
              );
              if (!program.rows[0]) {
                throw new HttpProblem(400, 'Программа организации не найдена');
              }
            }
            const columns =
              resource === 'projects'
                ? '(organization_id, program_id, name, normalized_name, description, status, starts_at, ends_at, owner_user_id)'
                : resource === 'events'
                  ? '(organization_id, program_id, name, normalized_name, status, starts_at, ends_at, owner_user_id)'
                  : '(organization_id, name, normalized_name, status, starts_at, ends_at, owner_user_id)';
            const values =
              resource === 'projects'
                ? '($1, $2, $3, $4, $5, $6, $7, $8, $9)'
                : resource === 'events'
                  ? '($1, $2, $3, $4, $6, $7, $8, $9)'
                  : '($1, $3, $4, $6, $7, $8, $9)';
            const result = await client.query<{ id: string }>(
              `INSERT INTO ${resource} ${columns} VALUES ${values} RETURNING id`,
              [
                organization.id,
                body.programId ?? null,
                name,
                normalizedName,
                body.description ?? null,
                body.status ?? (resource === 'events' ? 'PLANNED' : 'ACTIVE'),
                startsAt,
                endsAt,
                request.authUser!.userId,
              ],
            );
            if (resource === 'events' && participantIds.length > 0) {
              const insertedParticipations = await client.query(
                `WITH requested(person_id) AS (
                   SELECT unnest($1::uuid[])
                 ), locked_people AS MATERIALIZED (
                   SELECT person.id
                     FROM persons person
                     JOIN requested ON requested.person_id = person.id
                    WHERE person.organization_id = $3
                      AND person.archived_at IS NULL
                      AND person.merged_into_person_id IS NULL
                    ORDER BY person.id
                    FOR UPDATE OF person
                 )
                 INSERT INTO event_participations (person_id, event_id, data_origin)
                 SELECT locked.id, $2, 'LIVE' FROM locked_people locked`,
                [participantIds, result.rows[0]!.id, organization.id],
              );
              if (insertedParticipations.rowCount !== participantIds.length) {
                throw new HttpProblem(
                  400,
                  'Некоторые участники не найдены',
                  'Выберите существующих активных участников этой организации.',
                );
              }
            }
            await writeAudit(client, {
              actor: request.authUser!,
              requestId: request.id,
              action: `${resource}.created`,
              entityType: resource.slice(0, -1),
              entityId: result.rows[0]!.id,
              after: {
                name,
                normalizedName,
                status: body.status ?? (resource === 'events' ? 'PLANNED' : 'ACTIVE'),
                startsAt: startsAt?.toISOString() ?? null,
                endsAt: endsAt?.toISOString() ?? null,
                programId: body.programId ?? null,
                ...(resource === 'events'
                  ? {
                      participantIds,
                      participantCount: participantIds.length,
                      ownerUserId: request.authUser!.userId,
                      dataOrigin: 'LIVE',
                    }
                  : {}),
              },
            });
            const response = result.rows[0]!;
            if (idempotency) await idempotency.record(201, response, client);
            return response;
          });
          return reply.code(201).send(created);
        } catch (error) {
          if (idempotency) await idempotency.release().catch(() => undefined);
          throw error;
        }
      },
    );
  }

  app.get(
    '/settings/organization',
    { preHandler: app.requirePermission(Permissions.PEOPLE_READ), schema: { tags: ['Настройки'] } },
    async () => {
      const result = await app.pool.query(
        `SELECT o.id, o.name, os.artifact_baseline_at, os.timezone, os.version,
                lrs.id AS rule_set_id, lrs.rule_version, lrs.active_window_hours, lrs.inactive_after_hours
           FROM organization_settings os JOIN organizations o ON o.id = os.organization_id
           JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
          ORDER BY os.created_at LIMIT 1`,
      );
      if (!result.rows[0]) throw new HttpProblem(503, 'Настройки не созданы');
      return result.rows[0];
    },
  );

  app.get(
    '/settings/lifecycle-rules',
    { preHandler: app.requirePermission(Permissions.PEOPLE_READ), schema: { tags: ['Настройки'] } },
    async () => {
      const result = await app.pool.query(
        'SELECT id, rule_version, active_window_hours, inactive_after_hours, effective_from, effective_to, change_comment FROM lifecycle_rule_sets ORDER BY rule_version DESC',
      );
      return { items: result.rows };
    },
  );

  app.patch(
    '/settings/organization',
    {
      preHandler: app.requirePermission(Permissions.SETTINGS_MANAGE),
      schema: {
        tags: ['Настройки'],
        body: Type.Object({
          version: Type.Integer({ minimum: 1 }),
          timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          artifactBaselineAt: Type.Optional(Type.String({ format: 'date-time' })),
          reason: Type.String({ minLength: 3, maxLength: 2000 }),
        }),
      },
    },
    async (request) => {
      const body = request.body as {
        version: number;
        timezone?: string;
        artifactBaselineAt?: string;
        reason: string;
      };
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          'SELECT id, timezone, artifact_baseline_at, version FROM organization_settings ORDER BY created_at LIMIT 1 FOR UPDATE',
        );
        if (!current.rows[0]) throw new HttpProblem(404, 'Настройки не найдены');
        if (current.rows[0].version !== body.version)
          throw new HttpProblem(409, 'Настройки уже изменены');
        if (body.timezone) {
          try {
            new Intl.DateTimeFormat('ru-RU', { timeZone: body.timezone });
          } catch {
            throw new HttpProblem(400, 'Некорректная часовая зона');
          }
        }
        const updated = await client.query(
          `UPDATE organization_settings SET timezone = COALESCE($2, timezone), artifact_baseline_at = COALESCE($3, artifact_baseline_at), change_reason = $4, updated_by_user_id = $5, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version, timezone, artifact_baseline_at`,
          [
            current.rows[0].id,
            body.timezone ?? null,
            body.artifactBaselineAt ? new Date(body.artifactBaselineAt) : null,
            body.reason,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'organization_settings.updated',
          entityType: 'organization_settings',
          entityId: current.rows[0].id,
          before: current.rows[0],
          after: updated.rows[0],
          reason: body.reason,
        });
        return updated.rows[0];
      });
    },
  );

  app.get(
    '/audit',
    {
      preHandler: app.requirePermission(Permissions.AUDIT_READ),
      schema: {
        tags: ['Аудит'],
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
      },
    },
    async (request) => {
      const limit = (request.query as { limit?: number }).limit ?? 50;
      const result = await app.pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id, al.reason, al.occurred_at, u.display_name AS actor_name FROM audit_log al LEFT JOIN app_users u ON u.id = al.actor_user_id ORDER BY al.occurred_at DESC LIMIT $1`,
        [limit],
      );
      await app.pool.query(
        `INSERT INTO audit_log (actor_user_id, actor_subject, request_id, action, entity_type, reason) VALUES ($1, $2, $3, 'audit.read', 'audit_log', 'Просмотр журнала')`,
        [request.authUser!.userId, request.authUser!.sub, request.id],
      );
      return { items: result.rows };
    },
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function rejectUnexpectedEventProperties(request: FastifyRequest): Promise<void> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return;
  const unexpected = Object.keys(request.body).find((field) => !eventBodyFields.has(field));
  if (unexpected) {
    throw new HttpProblem(
      400,
      'Неизвестное поле мероприятия',
      `Поле «${unexpected}» не разрешено.`,
    );
  }
}
