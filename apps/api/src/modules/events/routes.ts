import { Permissions, hasPermission, normalizeFullName, normalizeUnicode } from '@cpi-crm/domain';
import { EventAttendanceImportError, importEventAttendanceWorkbook } from '@cpi-crm/importer';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { EVENT_ARTIFACTS_SQL, mapEventArtifactRow } from '../../lib/event-artifacts.js';
import {
  EVENT_DUPLICATE_SUGGESTIONS_SQL,
  mapEventDuplicateRow,
} from '../../lib/event-duplicates.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const LIVE_ACTIVITY_SQL = `CASE
  WHEN p.activation_state <> 'ACTIVATED' OR p.last_artifact_at IS NULL THEN 'UNKNOWN'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.active_window_hours) THEN 'ACTIVE'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.inactive_after_hours) THEN 'MEDIUM'
  ELSE 'INACTIVE'
END`;

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  const spreadsheetContentTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ];
  for (const contentType of spreadsheetContentTypes) {
    if (!app.hasContentTypeParser(contentType)) {
      app.addContentTypeParser(
        contentType,
        { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
        (_request, body, done) => done(null, body),
      );
    }
  }
  app.get(
    '/events',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Реестр мероприятий',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 500 })),
          status: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          period: Type.Optional(
            Type.Union([
              Type.Literal('UPCOMING'),
              Type.Literal('PAST'),
              Type.Literal('DATED'),
              Type.Literal('UNDATED'),
            ]),
          ),
          participants: Type.Optional(Type.Union([Type.Literal('WITH'), Type.Literal('WITHOUT')])),
          artifacts: Type.Optional(Type.Union([Type.Literal('WITH'), Type.Literal('WITHOUT')])),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as {
        q?: string;
        status?: string;
        period?: 'UPCOMING' | 'PAST' | 'DATED' | 'UNDATED';
        participants?: 'WITH' | 'WITHOUT';
        artifacts?: 'WITH' | 'WITHOUT';
        limit?: number;
        offset?: number;
      };
      const organization = await getOrganizationContext(app.pool);
      const values: unknown[] = [organization.id];
      const filters = ['true'];
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        filters.push(`name ILIKE $${values.length}`);
      }
      if (query.status?.trim()) {
        values.push(query.status.trim());
        filters.push(`status = $${values.length}`);
      }
      if (query.period === 'UPCOMING') filters.push(`COALESCE(ends_at, starts_at) >= now()`);
      if (query.period === 'PAST') filters.push(`COALESCE(ends_at, starts_at) < now()`);
      if (query.period === 'DATED') filters.push(`(starts_at IS NOT NULL OR ends_at IS NOT NULL)`);
      if (query.period === 'UNDATED') filters.push(`starts_at IS NULL AND ends_at IS NULL`);
      if (query.participants === 'WITH') filters.push(`participant_count > 0`);
      if (query.participants === 'WITHOUT') filters.push(`participant_count = 0`);
      if (query.artifacts === 'WITH') filters.push(`artifact_count > 0`);
      if (query.artifacts === 'WITHOUT') filters.push(`artifact_count = 0`);

      values.push(query.limit ?? 100);
      const limitParameter = values.length;
      values.push(query.offset ?? 0);
      const offsetParameter = values.length;
      const result = await app.pool.query(
        `WITH event_registry AS (
         SELECT e.id, e.name, e.normalized_name, e.status, e.starts_at, e.ends_at, e.version,
                count(DISTINCT COALESCE(participant.merged_into_person_id, participant.id))
                  FILTER (WHERE participant.id IS NOT NULL AND participant.archived_at IS NULL)
                  AS participant_count,
                count(DISTINCT artifact.id)
                  FILTER (WHERE artifact.status <> 'VOIDED') AS artifact_count
           FROM events e
           LEFT JOIN event_participations participation
             ON participation.event_id = e.id AND participation.archived_at IS NULL
           LEFT JOIN persons participant ON participant.id = participation.person_id
           LEFT JOIN artifacts artifact ON artifact.event_id = e.id AND artifact.archived_at IS NULL
          WHERE e.organization_id = $1 AND e.archived_at IS NULL
          GROUP BY e.id
        ), filtered_events AS (
          SELECT * FROM event_registry WHERE ${filters.join(' AND ')}
        ), paged_events AS (
          SELECT * FROM filtered_events
           ORDER BY starts_at DESC NULLS LAST, normalized_name, id
           LIMIT $${limitParameter} OFFSET $${offsetParameter}
        )
        SELECT page.id, page.name, page.status, page.starts_at, page.ends_at, page.version,
               page.participant_count::text AS participant_count,
               page.artifact_count::text AS artifact_count,
               totals.total_count::text AS total_count
          FROM (SELECT count(*) AS total_count FROM filtered_events) totals
          LEFT JOIN paged_events page ON true
         ORDER BY page.starts_at DESC NULLS LAST, page.normalized_name, page.id`,
        values,
      );
      return {
        items: result.rows
          .filter((row) => row.id)
          .map((row) => ({
            id: row.id,
            name: row.name,
            status: row.status,
            startsAt: row.starts_at?.toISOString() ?? null,
            endsAt: row.ends_at?.toISOString() ?? null,
            version: Number(row.version),
            participantCount: Number(row.participant_count),
            artifactCount: Number(row.artifact_count),
          })),
        total: Number(result.rows[0]?.total_count ?? 0),
      };
    },
  );

  app.post(
    '/events/:id/participants/import-xlsx',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Мероприятия'],
        summary: 'Привязать существующих участников по таблице посещений',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const eventId = (request.params as { id: string }).id;
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        throw new HttpProblem(400, 'XLSX-файл не передан');
      }
      const organization = await getOrganizationContext(app.pool);
      try {
        return await importEventAttendanceWorkbook(app.pool, {
          organizationId: organization.id,
          eventId,
          actorUserId: request.authUser!.userId,
          actorSubject: request.authUser!.sub,
          requestId: request.id,
          workbookBytes: request.body,
        });
      } catch (error) {
        if (error instanceof EventAttendanceImportError) {
          throw new HttpProblem(
            error.kind === 'EVENT_NOT_FOUND' ? 404 : 400,
            error.message,
            error.detail,
          );
        }
        throw error;
      }
    },
  );

  /**
   * Добавить участника в мероприятие вручную.
   *
   * Таблица посещений закрывает массовый случай, но не единичный: человек пришёл
   * без регистрации, его забыли в списке, или карточку завели уже после
   * мероприятия. Раньше такую запись можно было получить только новой выгрузкой
   * из XLSX, поэтому её просто не добавляли.
   *
   * Участие привязывается к главной карточке кластера: иначе после слияния
   * запись потерялась бы в проигравшей карточке.
   */
  app.post(
    '/events/:id/participants',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Добавить участника в мероприятие',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            personId: Type.String({ format: 'uuid' }),
            decision: Type.Optional(
              Type.Union([
                Type.Literal('UNKNOWN'),
                Type.Literal('PENDING'),
                Type.Literal('ACCEPTED'),
                Type.Literal('REJECTED'),
                Type.Literal('WAITLISTED'),
              ]),
            ),
            attendance: Type.Optional(
              Type.Union([
                Type.Literal('UNKNOWN'),
                Type.Literal('ATTENDED'),
                Type.Literal('NO_SHOW'),
                Type.Literal('PARTIAL'),
              ]),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const eventId = (request.params as { id: string }).id;
      const body = request.body as {
        personId: string;
        decision?: 'UNKNOWN' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WAITLISTED';
        attendance?: 'UNKNOWN' | 'ATTENDED' | 'NO_SHOW' | 'PARTIAL';
      };
      const decision = body.decision ?? 'UNKNOWN';
      const attendance = body.attendance ?? 'UNKNOWN';
      const organization = await getOrganizationContext(app.pool);

      const created = await transaction(app.pool, async (client) => {
        const event = await client.query<{ id: string; starts_at: Date | null }>(
          `SELECT id, starts_at FROM events
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
          [eventId, organization.id],
        );
        if (!event.rows[0]) throw new HttpProblem(404, 'Мероприятие не найдено');

        const person = await client.query<{ person_id: string; canonical_full_name: string }>(
          `SELECT canonical.id AS person_id, canonical.canonical_full_name
             FROM persons requested
             JOIN persons canonical
               ON canonical.id = COALESCE(requested.merged_into_person_id, requested.id)
            WHERE requested.id = $1 AND requested.organization_id = $2
              AND canonical.archived_at IS NULL
            FOR UPDATE OF canonical`,
          [body.personId, organization.id],
        );
        if (!person.rows[0]) throw new HttpProblem(404, 'Участник не найден');
        const personId = person.rows[0].person_id;

        const existing = await client.query<{ id: string }>(
          `SELECT participation.id
             FROM event_participations participation
            WHERE participation.event_id = $1
              AND participation.archived_at IS NULL
              AND participation.person_id IN (
                    SELECT id FROM persons WHERE id = $2 OR merged_into_person_id = $2
                  )
            LIMIT 1`,
          [eventId, personId],
        );
        if (existing.rows[0]) throw new HttpProblem(409, 'Участник уже есть в этом мероприятии');

        // Снятого участника возвращаем той же записью: к ней привязаны ссылки на
        // строки источников, и новая строка их потеряла бы.
        const restored = await client.query<{ id: string }>(
          `UPDATE event_participations
              SET archived_at = NULL,
                  decision = $3::participation_decision,
                  attendance = $4::attendance_status,
                  decision_at = CASE WHEN $3::text = 'UNKNOWN' THEN NULL ELSE now() END,
                  attended_at = CASE WHEN $4::text = 'UNKNOWN' THEN NULL
                                     ELSE COALESCE($5::timestamptz, now()) END,
                  updated_at = now(), version = version + 1
            WHERE id = (
              SELECT id FROM event_participations
               WHERE event_id = $1 AND person_id = $2 AND archived_at IS NOT NULL
               ORDER BY archived_at DESC
               LIMIT 1
            )
            RETURNING id`,
          [eventId, personId, decision, attendance, event.rows[0].starts_at],
        );

        const participation =
          restored.rows[0] ??
          (
            await client.query<{ id: string }>(
              `INSERT INTO event_participations
                 (person_id, event_id, registered_at, decision, decision_at,
                  attendance, attended_at, data_origin)
               VALUES ($2, $1, now(),
                       $3::participation_decision,
                       CASE WHEN $3::text = 'UNKNOWN' THEN NULL ELSE now() END,
                       $4::attendance_status,
                       CASE WHEN $4::text = 'UNKNOWN' THEN NULL
                            ELSE COALESCE($5::timestamptz, now()) END,
                       'LIVE')
               RETURNING id`,
              [eventId, personId, decision, attendance, event.rows[0].starts_at],
            )
          ).rows[0]!;

        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'event.participant_added',
          entityType: 'event_participation',
          entityId: participation.id,
          after: { eventId, personId, decision, attendance, restored: restored.rows[0] !== undefined },
        });

        return {
          id: participation.id,
          personId,
          canonicalFullName: person.rows[0].canonical_full_name,
          decision,
          attendance,
        };
      });

      return reply.code(201).send(created);
    },
  );

  /**
   * Снять участника с мероприятия.
   *
   * Запись архивируется, а не удаляется: ошибочное добавление нужно уметь
   * откатить, а история участия — часть данных о человеке.
   */
  app.delete(
    '/events/:id/participants/:personId',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Снять участника с мероприятия',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          personId: Type.String({ format: 'uuid' }),
        }),
      },
    },
    async (request, reply) => {
      const { id: eventId, personId } = request.params as { id: string; personId: string };
      const organization = await getOrganizationContext(app.pool);

      await transaction(app.pool, async (client) => {
        const event = await client.query(
          `SELECT 1 FROM events
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
          [eventId, organization.id],
        );
        if (!event.rows[0]) throw new HttpProblem(404, 'Мероприятие не найдено');

        const person = await client.query<{ person_id: string }>(
          `SELECT COALESCE(merged_into_person_id, id) AS person_id
             FROM persons WHERE id = $1 AND organization_id = $2`,
          [personId, organization.id],
        );
        if (!person.rows[0]) throw new HttpProblem(404, 'Участник не найден');
        const canonicalId = person.rows[0].person_id;

        // Артефакт, сданный на этом мероприятии, — доказательство участия сильнее
        // любого списка, поэтому такую запись снять нельзя.
        const artifacts = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM artifacts artifact
             JOIN artifact_versions version ON version.artifact_id = artifact.id
             JOIN artifact_version_contributors contributor
               ON contributor.artifact_version_id = version.id
            WHERE artifact.event_id = $1
              AND artifact.archived_at IS NULL
              AND artifact.status <> 'VOIDED'
              AND contributor.person_id IN (
                    SELECT id FROM persons WHERE id = $2 OR merged_into_person_id = $2
                  )`,
          [eventId, canonicalId],
        );
        if (Number(artifacts.rows[0]?.count ?? 0) > 0)
          throw new HttpProblem(
            409,
            'У участника есть артефакт этого мероприятия',
            'Сначала перенесите или аннулируйте артефакт — иначе он останется без участника.',
          );

        const archived = await client.query(
          `UPDATE event_participations
              SET archived_at = now(), updated_at = now(), version = version + 1
            WHERE event_id = $1 AND archived_at IS NULL
              AND person_id IN (
                    SELECT id FROM persons WHERE id = $2 OR merged_into_person_id = $2
                  )`,
          [eventId, canonicalId],
        );
        if (archived.rowCount === 0) throw new HttpProblem(404, 'Запись участия не найдена');

        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'event.participant_removed',
          entityType: 'event',
          entityId: eventId,
          before: { personId: canonicalId, participations: archived.rowCount },
        });
      });

      return reply.code(204).send();
    },
  );

  app.patch(
    '/events/:id',
    {
      preHandler: app.requirePermission(Permissions.EVENTS_WRITE),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Изменить мероприятие',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            version: Type.Integer({ minimum: 1 }),
            name: Type.Optional(Type.String({ minLength: 2, maxLength: 500 })),
            status: Type.Optional(
              Type.Union([
                Type.Literal('PLANNED'),
                Type.Literal('ACTIVE'),
                Type.Literal('COMPLETED'),
                Type.Literal('CANCELLED'),
              ]),
            ),
            startsAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
            endsAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const eventId = (request.params as { id: string }).id;
      const body = request.body as {
        version: number;
        name?: string;
        status?: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
        startsAt?: string | null;
        endsAt?: string | null;
      };
      const organization = await getOrganizationContext(app.pool);

      return transaction(app.pool, async (client) => {
        const current = await client.query<{
          id: string;
          name: string;
          normalized_name: string;
          status: string;
          starts_at: Date | null;
          ends_at: Date | null;
          version: number;
        }>(
          `SELECT id, name, normalized_name, status, starts_at, ends_at, version
             FROM events
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
            FOR UPDATE`,
          [eventId, organization.id],
        );
        const event = current.rows[0];
        if (!event) throw new HttpProblem(404, 'Мероприятие не найдено');
        if (event.version !== body.version)
          throw new HttpProblem(409, 'Мероприятие уже изменено другим пользователем');

        const name = body.name
          ? normalizeUnicode(body.name).replace(/\s+/gu, ' ').trim()
          : event.name;
        if (!name) throw new HttpProblem(400, 'Название не может быть пустым');
        const normalizedName = normalizeFullName(name);
        if (normalizedName !== event.normalized_name) {
          const duplicate = await client.query(
            `SELECT 1 FROM events
              WHERE organization_id = $1 AND normalized_name = $2 AND id <> $3
                AND archived_at IS NULL
              LIMIT 1`,
            [organization.id, normalizedName, eventId],
          );
          if (duplicate.rows[0])
            throw new HttpProblem(409, 'Мероприятие с таким названием уже существует');
        }

        const startsAt =
          body.startsAt === undefined
            ? event.starts_at
            : body.startsAt === null
              ? null
              : new Date(body.startsAt);
        const endsAt =
          body.endsAt === undefined
            ? event.ends_at
            : body.endsAt === null
              ? null
              : new Date(body.endsAt);
        if (endsAt && !startsAt) throw new HttpProblem(400, 'Дата окончания требует даты начала');
        if (startsAt && endsAt && endsAt <= startsAt)
          throw new HttpProblem(400, 'Дата окончания должна быть позже начала');

        const updated = await client.query<{
          id: string;
          name: string;
          status: string;
          starts_at: Date | null;
          ends_at: Date | null;
          version: number;
        }>(
          `UPDATE events
              SET name = $2, normalized_name = $3, status = $4,
                  starts_at = $5, ends_at = $6,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, name, status, starts_at, ends_at, version`,
          [eventId, name, normalizedName, body.status ?? event.status, startsAt, endsAt],
        );

        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'event.updated',
          entityType: 'event',
          entityId: eventId,
          before: {
            name: event.name,
            status: event.status,
            startsAt: event.starts_at?.toISOString() ?? null,
            endsAt: event.ends_at?.toISOString() ?? null,
          },
          after: {
            name,
            status: body.status ?? event.status,
            startsAt: startsAt?.toISOString() ?? null,
            endsAt: endsAt?.toISOString() ?? null,
          },
        });

        const row = updated.rows[0]!;
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          startsAt: row.starts_at?.toISOString() ?? null,
          endsAt: row.ends_at?.toISOString() ?? null,
          version: row.version,
        };
      });
    },
  );

  app.get(
    '/events/:id/artifacts',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_READ),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Артефакты мероприятия с авторами и файлами',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const eventId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const event = await app.pool.query(
        'SELECT id FROM events WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL',
        [eventId, organization.id],
      );
      if (!event.rows[0]) throw new HttpProblem(404, 'Мероприятие не найдено');

      const [artifacts, participants] = await Promise.all([
        app.pool.query(EVENT_ARTIFACTS_SQL, [eventId]),
        app.pool.query<{ id: string; canonical_full_name: string }>(
          `SELECT DISTINCT p.id, p.canonical_full_name
             FROM event_participations participation
             JOIN persons observed ON observed.id = participation.person_id
             JOIN persons p ON p.id = COALESCE(observed.merged_into_person_id, observed.id)
            WHERE participation.event_id = $1
              AND participation.archived_at IS NULL
              AND p.archived_at IS NULL
            ORDER BY p.canonical_full_name`,
          [eventId],
        ),
      ]);

      return {
        items: artifacts.rows.map(mapEventArtifactRow),
        participants: participants.rows.map((row) => ({
          id: row.id,
          canonicalFullName: row.canonical_full_name,
        })),
      };
    },
  );

  app.get(
    '/events/:id/duplicate-suggestions',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Возможные дубли участников мероприятия',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const eventId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const event = await app.pool.query(
        'SELECT id FROM events WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL',
        [eventId, organization.id],
      );
      if (!event.rows[0]) throw new HttpProblem(404, 'Мероприятие не найдено');
      const result = await app.pool.query(EVENT_DUPLICATE_SUGGESTIONS_SQL, [eventId]);
      return { items: result.rows.map(mapEventDuplicateRow) };
    },
  );

  app.get(
    '/events/:id',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Мероприятия'],
        summary: 'Мероприятие и его участники',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const eventId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const eventResult = await app.pool.query(
        `SELECT id, name, status, starts_at, ends_at, version
           FROM events
          WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
        [eventId, organization.id],
      );
      const event = eventResult.rows[0];
      if (!event) throw new HttpProblem(404, 'Мероприятие не найдено');

      const canReadContacts = hasPermission(request.authUser!.roles, Permissions.CONTACTS_READ);
      const contactJoin = canReadContacts
        ? `LEFT JOIN LATERAL (
             SELECT contact.raw_value AS primary_contact
               FROM contact_points contact
              WHERE contact.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = p.id OR member.merged_into_person_id = p.id
                    )
                AND contact.archived_at IS NULL
              ORDER BY (contact.type = 'TELEGRAM' AND contact.messenger_stable_id IS NOT NULL) DESC,
                       (contact.type = 'TELEGRAM') DESC,
                       contact.is_primary DESC, contact.created_at, contact.id
              LIMIT 1
           ) primary_contact ON true`
        : 'LEFT JOIN LATERAL (SELECT NULL::text AS primary_contact) primary_contact ON true';

      const participants = await app.pool.query(
        `WITH canonical_participants AS (
           SELECT DISTINCT COALESCE(observed.merged_into_person_id, observed.id) AS person_id
             FROM event_participations participation
             JOIN persons observed ON observed.id = participation.person_id
            WHERE participation.event_id = $1
              AND participation.archived_at IS NULL
              AND observed.archived_at IS NULL
         )
         SELECT p.id, p.canonical_full_name, p.activation_state,
                ${LIVE_ACTIVITY_SQL} AS activity_status,
                p.last_artifact_at, primary_contact.primary_contact,
                participation_data.participation_count,
                participation_data.decisions,
                participation_data.attendances,
                COALESCE(provenance.comments, '[]'::jsonb) AS comments,
                COALESCE(provenance.source_count, 0)::text AS source_count,
                COALESCE(event_artifacts.artifact_count, 0)::text AS artifact_count,
                COALESCE(event_artifacts.items, '[]'::jsonb) AS artifacts
           FROM canonical_participants canonical
           JOIN persons p ON p.id = canonical.person_id
           JOIN organization_settings settings ON settings.organization_id = p.organization_id
           JOIN lifecycle_rule_sets lrs ON lrs.id = settings.current_lifecycle_rule_set_id
           ${contactJoin}
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT participation.id)::text AS participation_count,
                    array_agg(DISTINCT participation.decision::text
                              ORDER BY participation.decision::text) AS decisions,
                    array_agg(DISTINCT participation.attendance::text
                              ORDER BY participation.attendance::text) AS attendances
               FROM event_participations participation
               JOIN persons observed ON observed.id = participation.person_id
              WHERE participation.event_id = $1
                AND participation.archived_at IS NULL
                AND COALESCE(observed.merged_into_person_id, observed.id) = p.id
           ) participation_data ON true
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT source.id) AS source_count,
                    jsonb_agg(DISTINCT btrim(COALESCE(
                      NULLIF(cell->>'displayText', ''),
                      CASE WHEN jsonb_typeof(cell->'value') = 'string'
                           THEN cell->>'value' ELSE NULL END
                    ))) FILTER (WHERE cell IS NOT NULL) AS comments
               FROM event_participations participation
               JOIN persons observed ON observed.id = participation.person_id
               JOIN source_entity_links link
                 ON upper(link.entity_type) = 'EVENT_PARTICIPATION'
                AND link.entity_id = participation.id
                AND link.detached_at IS NULL
               JOIN source_records source ON source.id = link.source_record_id
               LEFT JOIN LATERAL jsonb_array_elements(source.raw_json->'cells') cell
                 ON COALESCE(cell->>'normalizedHeader', '') = 'комментарий'
                AND btrim(COALESCE(
                      NULLIF(cell->>'displayText', ''),
                      CASE WHEN jsonb_typeof(cell->'value') = 'string'
                           THEN cell->>'value' ELSE '' END
                    )) <> ''
                AND char_length(btrim(COALESCE(
                      NULLIF(cell->>'displayText', ''),
                      CASE WHEN jsonb_typeof(cell->'value') = 'string'
                           THEN cell->>'value' ELSE '' END
                    ))) <= 10000
                AND lower(btrim(COALESCE(NULLIF(cell->>'displayText', ''), cell->>'value', ''))) !~ '^(нет|не указано|отсутствует|none|null|n/?a|test|тест|[-—.]+)$'
                AND btrim(COALESCE(NULLIF(cell->>'displayText', ''), cell->>'value', '')) ~ '[[:alnum:]А-Яа-яЁё]'
              WHERE participation.event_id = $1
                AND participation.archived_at IS NULL
                AND COALESCE(observed.merged_into_person_id, observed.id) = p.id
           ) provenance ON true
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT artifact.id) AS artifact_count,
                    jsonb_agg(DISTINCT jsonb_build_object(
                      'id', artifact.id,
                      'title', artifact.title,
                      'typeName', artifact_type.name,
                      'latestVersionId', latest.id,
                      'latestVersionStatus', latest.status,
                      'submittedAt', latest.submitted_at
                    )) AS items
               FROM artifacts artifact
               JOIN artifact_types artifact_type ON artifact_type.id = artifact.type_id
               LEFT JOIN LATERAL (
                 SELECT version.id, version.status, version.submitted_at
                   FROM artifact_versions version
                  WHERE version.artifact_id = artifact.id AND version.status <> 'VOIDED'
                  ORDER BY version.version_number DESC
                  LIMIT 1
               ) latest ON true
              WHERE artifact.event_id = $1
                AND artifact.status <> 'VOIDED'
                AND artifact.archived_at IS NULL
                AND EXISTS (
                  SELECT 1
                    FROM artifact_versions version
                    JOIN artifact_version_contributors contributor
                      ON contributor.artifact_version_id = version.id
                    JOIN persons observed_author ON observed_author.id = contributor.person_id
                   WHERE version.artifact_id = artifact.id
                     AND version.status <> 'VOIDED'
                     AND contributor.contribution_role = 'AUTHOR'
                     AND COALESCE(observed_author.merged_into_person_id, observed_author.id) = p.id
                )
           ) event_artifacts ON true
          WHERE p.organization_id = $2 AND p.archived_at IS NULL
          ORDER BY p.normalized_full_name, p.id`,
        [eventId, organization.id],
      );

      return {
        id: event.id,
        name: event.name,
        status: event.status,
        startsAt: event.starts_at?.toISOString() ?? null,
        endsAt: event.ends_at?.toISOString() ?? null,
        version: Number(event.version),
        participants: participants.rows.map((row) => ({
          id: row.id,
          canonicalFullName: row.canonical_full_name,
          primaryContact: row.primary_contact,
          activationState: row.activation_state,
          activityStatus: row.activity_status,
          lastArtifactAt: row.last_artifact_at?.toISOString() ?? null,
          participationCount: Number(row.participation_count),
          decisions: row.decisions ?? [],
          attendances: row.attendances ?? [],
          comments: row.comments ?? [],
          sourceCount: Number(row.source_count),
          artifactCount: Number(row.artifact_count),
          artifacts: row.artifacts ?? [],
        })),
      };
    },
  );
}
