import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Permissions, normalizeEmail, normalizeFullName, normalizePhone } from '@cpi-crm/domain';
import {
  createEventParticipantsWorkbook,
  createOperationalPeriodWorkbook,
  createProjectWorkbook,
  type EventParticipantWorkbookArtifact,
} from '@cpi-crm/importer';
import { Type } from '@sinclair/typebox';
import { ZipArchive } from 'archiver';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

import { EVENT_ARTIFACTS_SQL, mapEventArtifactRow } from '../../lib/event-artifacts.js';
import { createConcurrencyGuard, heavyOperationRateLimit } from '../../lib/heavy-operations.js';
import { requestLockerDownloadUrl } from '../../lib/locker.js';
import { getOrganizationContext } from '../../lib/organization.js';
import {
  loadOperationalPeriodReport,
  operationalReportSvg,
  resolvePeriod,
  type PeriodBounds,
} from '../../lib/period-report.js';
import { HttpProblem } from '../../lib/problem.js';

const EXPORT_BATCH_SIZE = 25;

/** Параллельная подготовка источников; сами файлы качаются по очереди. */
const ARTIFACT_LINK_CONCURRENCY = 4;

const PeriodQuery = Type.Object({
  weeks: Type.Optional(Type.Integer({ minimum: 1, maximum: 52 })),
  from: Type.Optional(Type.String({ format: 'date-time' })),
  to: Type.Optional(Type.String({ format: 'date-time' })),
});

interface EventParticipantExportRow {
  person_id: string;
  last_name: string | null;
  first_name: string | null;
  patronymic: string | null;
  canonical_full_name: string;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  telegram_user_id: string | null;
  attended: boolean | null;
  decisions: string[];
  result: string | null;
}

type PeriodQueryInput = { weeks?: number; from?: string; to?: string };

interface PeriodArtifactRow {
  version_id: string;
  artifact_id: string;
  submitted_at: Date;
  title: string;
  type_name: string;
  event_name: string | null;
  project_name: string | null;
  source: 'BOT' | 'CRM';
  score: number | null;
  decision: string | null;
  authors: string[];
  external_urls: string[];
  files: {
    id: string;
    fileName: string;
    status: string;
    storageProvider: 'CRM' | 'LOCKER';
  }[];
}

/** Ожидает $1 = eventId, $2 = organizationId. */
const EVENT_PARTICIPANTS_EXPORT_SQL = `
  WITH canonical_participants AS (
    SELECT DISTINCT COALESCE(member.merged_into_person_id, member.id) AS person_id
      FROM event_participations participation
      JOIN persons member ON member.id = participation.person_id
     WHERE participation.event_id = $1
       AND participation.archived_at IS NULL AND member.archived_at IS NULL
  )
  SELECT person.id AS person_id,
         person.last_name, person.first_name, person.patronymic,
         person.canonical_full_name,
         contacts.email, contacts.phone, contacts.telegram,
         contacts.telegram_user_id,
         CASE
           WHEN participation.attended THEN true
           WHEN participation.no_show THEN false
           ELSE NULL
         END AS attended,
         participation.decisions
         , participation.result
    FROM canonical_participants canonical
    JOIN persons person ON person.id = canonical.person_id
    LEFT JOIN LATERAL (
      SELECT
        (SELECT contact.raw_value FROM contact_points contact
          WHERE contact.person_id IN (
                  SELECT id FROM persons
                   WHERE id = person.id OR merged_into_person_id = person.id
                )
            AND contact.archived_at IS NULL AND contact.type = 'EMAIL'
          ORDER BY contact.is_primary DESC, contact.created_at, contact.id LIMIT 1) AS email,
        (SELECT contact.raw_value FROM contact_points contact
          WHERE contact.person_id IN (
                  SELECT id FROM persons
                   WHERE id = person.id OR merged_into_person_id = person.id
                )
            AND contact.archived_at IS NULL AND contact.type = 'PHONE'
          ORDER BY contact.is_primary DESC, contact.created_at, contact.id LIMIT 1) AS phone,
        (SELECT contact.raw_value FROM contact_points contact
          WHERE contact.person_id IN (
                  SELECT id FROM persons
                   WHERE id = person.id OR merged_into_person_id = person.id
                )
            AND contact.archived_at IS NULL AND contact.type = 'TELEGRAM'
          ORDER BY (contact.messenger_stable_id IS NOT NULL) DESC,
                   contact.is_primary DESC, contact.created_at, contact.id LIMIT 1) AS telegram,
        (SELECT contact.messenger_stable_id FROM contact_points contact
          WHERE contact.person_id IN (
                  SELECT id FROM persons
                   WHERE id = person.id OR merged_into_person_id = person.id
                )
            AND contact.archived_at IS NULL AND contact.type = 'TELEGRAM'
            AND contact.messenger_stable_id IS NOT NULL
          ORDER BY contact.is_primary DESC, contact.created_at, contact.id LIMIT 1)
            AS telegram_user_id
    ) contacts ON true
    LEFT JOIN LATERAL (
      SELECT bool_or(item.attendance = 'ATTENDED') AS attended,
             bool_or(item.attendance = 'NO_SHOW') AS no_show,
             array_agg(DISTINCT item.decision::text ORDER BY item.decision::text) AS decisions,
             string_agg(DISTINCT item.result, E'\n---\n' ORDER BY item.result)
               FILTER (WHERE item.result IS NOT NULL) AS result
        FROM event_participations item
       WHERE item.event_id = $1 AND item.archived_at IS NULL
         AND item.person_id IN (
           SELECT id FROM persons
            WHERE id = person.id OR merged_into_person_id = person.id
         )
    ) participation ON true
   WHERE person.organization_id = $2 AND person.archived_at IS NULL
   ORDER BY person.last_name, person.first_name, person.patronymic, person.id
`;

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  const guardExportConcurrency = createConcurrencyGuard({
    maxConcurrent: 2,
    title: 'Экспорт уже выполняется',
    detail: 'Дождитесь завершения одной из текущих выгрузок и повторите запрос.',
    retryAfterSeconds: 10,
  });

  app.get(
    '/exports/participants.csv',
    {
      config: { rateLimit: heavyOperationRateLimit(4, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'Экспорт всех или отфильтрованных участников',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 500 })),
          hasArtifacts: Type.Optional(Type.Boolean()),
          profileNeedsReview: Type.Optional(Type.Boolean()),
          eventId: Type.Optional(Type.String({ format: 'uuid' })),
          awaitingReview: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const query = request.query as {
        q?: string;
        hasArtifacts?: boolean;
        profileNeedsReview?: boolean;
        eventId?: string;
        awaitingReview?: boolean;
      };
      const organization = await getOrganizationContext(app.pool);
      const values: unknown[] = [organization.id];
      const clusterSql = `(SELECT member.id FROM persons member
                            WHERE member.id = p.id OR member.merged_into_person_id = p.id)`;
      const where = [
        'p.organization_id = $1',
        'p.archived_at IS NULL',
        'p.merged_into_person_id IS NULL',
      ];
      if (query.q?.trim()) {
        const raw = query.q.trim();
        const normalizedName = normalizeFullName(raw);
        const phone = normalizePhone(raw);
        const contactCandidates = [
          normalizeEmail(raw),
          phone?.e164,
          phone?.russianNationalDigits,
        ].filter((value): value is string => Boolean(value));
        values.push(raw, normalizedName, contactCandidates);
        const rawParameter = `$${values.length - 2}`;
        const nameParameter = `$${values.length - 1}`;
        const contactsParameter = `$${values.length}`;
        where.push(`(
          EXISTS (
            SELECT 1 FROM persons cluster_member
             WHERE (cluster_member.id = p.id OR cluster_member.merged_into_person_id = p.id)
               AND (cluster_member.id::text = ${rawParameter}
                 OR cluster_member.id::text LIKE ${rawParameter} || '%')
          )
          OR p.normalized_full_name = ${nameParameter}
          OR p.normalized_full_name LIKE ${nameParameter} || '%'
          OR similarity(p.normalized_full_name, ${nameParameter}) >= 0.32
          OR EXISTS (
            SELECT 1 FROM person_aliases alias
             WHERE alias.person_id IN ${clusterSql} AND alias.archived_at IS NULL
               AND (alias.normalized_value = ${nameParameter}
                 OR similarity(alias.normalized_value, ${nameParameter}) >= 0.32)
          )
          OR EXISTS (
            SELECT 1 FROM contact_points contact
             WHERE contact.person_id IN ${clusterSql} AND contact.archived_at IS NULL
               AND contact.normalized_value = ANY(${contactsParameter}::text[])
          )
          OR EXISTS (
            SELECT 1 FROM person_search_documents document
             WHERE document.person_id IN ${clusterSql}
               AND document.search_text ILIKE '%' || ${nameParameter} || '%'
          )
        )`);
      }
      if (query.hasArtifacts !== undefined) {
        const exists = `EXISTS (
          SELECT 1 FROM artifact_version_contributors contributor
          JOIN artifact_versions version ON version.id = contributor.artifact_version_id
          JOIN artifacts artifact ON artifact.id = version.artifact_id
         WHERE contributor.person_id IN ${clusterSql}
           AND contributor.contribution_role = 'AUTHOR'
           AND version.status = 'SUBMITTED'
           AND artifact.status <> 'VOIDED' AND artifact.archived_at IS NULL
        )`;
        where.push(query.hasArtifacts ? exists : `NOT ${exists}`);
      }
      if (query.profileNeedsReview !== undefined) {
        values.push(query.profileNeedsReview);
        where.push(`p.profile_needs_review = $${values.length}`);
      }
      let eventParameter: string | undefined;
      if (query.eventId) {
        values.push(query.eventId);
        eventParameter = `$${values.length}`;
        where.push(`EXISTS (
          SELECT 1 FROM event_participations participation
           WHERE participation.event_id = ${eventParameter}
             AND participation.person_id IN ${clusterSql}
             AND participation.archived_at IS NULL
        )`);
      }
      if (query.awaitingReview) {
        where.push(`EXISTS (
          SELECT 1
            FROM LATERAL (
              SELECT review.score
                FROM artifact_version_contributors contributor
                JOIN artifact_versions version
                  ON version.id = contributor.artifact_version_id
                JOIN artifacts awaiting_artifact
                  ON awaiting_artifact.id = version.artifact_id
                LEFT JOIN artifact_review_selections selection
                  ON selection.artifact_version_id = version.id
                LEFT JOIN artifact_reviews review
                  ON review.id = selection.current_final_review_id
               WHERE contributor.person_id IN ${clusterSql}
                 AND contributor.contribution_role = 'AUTHOR'
                 AND version.qualifies_for_activity
                 AND version.status = 'SUBMITTED'
                 AND awaiting_artifact.archived_at IS NULL
                 AND awaiting_artifact.status <> 'VOIDED'
               ORDER BY version.submitted_at DESC NULLS LAST, version.id
               LIMIT 1
            ) latest_pending
           WHERE latest_pending.score IS NULL
        )`);
      }

      const countResult = await app.pool.query(
        `SELECT count(*)::text AS total
           FROM persons p
          WHERE ${where.join(' AND ')}`,
        values,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      await app.pool.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, after, reason)
         VALUES ($1, $2, $3, 'participants.exported', 'export', $4::jsonb,
                 'Запрошена выгрузка участников по текущим фильтрам')`,
        [
          request.authUser!.userId,
          request.authUser!.sub,
          request.id,
          JSON.stringify({ filters: query, rows: total, streaming: true }),
        ],
      );

      const headers = [
        'ID',
        'ФИО',
        'Контакты',
        'Организации / факультеты',
        'Отправлял артефакты',
        'Количество артефактов',
        'Последний артефакт',
        'Источник профиля',
        'Профиль',
        'Мероприятия',
        'Артефакты',
        'Комментарии',
        'Все исходные поля (JSON)',
      ];

      async function* streamCsv(): AsyncGenerator<string> {
        yield `\uFEFF${csvRow(headers)}\r\n`;
        let offset = 0;
        while (offset < total && !request.raw.aborted) {
          const pageValues = [...values, EXPORT_BATCH_SIZE, offset];
          const limitParameter = `$${values.length + 1}`;
          const offsetParameter = `$${values.length + 2}`;
          const result = await app.pool.query(
            `WITH export_people AS MATERIALIZED (
               SELECT p.id
                 FROM persons p
                WHERE ${where.join(' AND ')}
                ORDER BY p.normalized_full_name, p.id
                LIMIT ${limitParameter} OFFSET ${offsetParameter}
             )
             SELECT p.id, p.canonical_full_name, p.last_artifact_at,
                p.profile_needs_review,
                EXISTS (
                  SELECT 1 FROM external_identities identity
                   WHERE identity.person_id IN ${clusterSql}
                     AND identity.source_namespace IN ('locker.user', 'locker.telegram')
                     AND identity.archived_at IS NULL
                ) AS from_bot,
                COALESCE(contacts.values, '') AS contacts,
                COALESCE(affiliations.values, '') AS affiliations,
                COALESCE(event_data.names, '') AS events,
                COALESCE(event_data.comments, '') AS comments,
                COALESCE(artifact_data.titles, '') AS artifacts,
                COALESCE(artifact_data.artifact_count, 0)::text AS artifact_count,
                COALESCE(source_data.rows, '[]'::jsonb) AS source_rows
           FROM export_people export_person
           JOIN persons p ON p.id = export_person.id
           LEFT JOIN LATERAL (
             SELECT string_agg(DISTINCT contact.type::text || ': ' || contact.raw_value,
                               ' | ' ORDER BY contact.type::text || ': ' || contact.raw_value)
                      AS values
               FROM contact_points contact
              WHERE contact.person_id IN ${clusterSql} AND contact.archived_at IS NULL
           ) contacts ON true
           LEFT JOIN LATERAL (
             SELECT string_agg(DISTINCT related.name ||
                      CASE WHEN affiliation.faculty IS NULL OR affiliation.faculty = ''
                           THEN '' ELSE ' / ' || affiliation.faculty END,
                      ' | ' ORDER BY related.name ||
                      CASE WHEN affiliation.faculty IS NULL OR affiliation.faculty = ''
                           THEN '' ELSE ' / ' || affiliation.faculty END) AS values
               FROM affiliations affiliation
               JOIN organizations related ON related.id = affiliation.organization_id
              WHERE affiliation.person_id IN ${clusterSql} AND affiliation.archived_at IS NULL
           ) affiliations ON true
           LEFT JOIN LATERAL (
             SELECT string_agg(DISTINCT event.name, ' | ' ORDER BY event.name) AS names,
                    string_agg(DISTINCT btrim(COALESCE(
                      NULLIF(cell->>'displayText', ''),
                      CASE WHEN jsonb_typeof(cell->'value') = 'string'
                           THEN cell->>'value' ELSE NULL END
                    )), ' | ') FILTER (WHERE cell IS NOT NULL) AS comments
               FROM event_participations participation
               JOIN events event ON event.id = participation.event_id
               LEFT JOIN source_entity_links link
                 ON upper(link.entity_type) = 'EVENT_PARTICIPATION'
                AND link.entity_id = participation.id AND link.detached_at IS NULL
               LEFT JOIN source_records source ON source.id = link.source_record_id
               LEFT JOIN LATERAL jsonb_array_elements(source.raw_json->'cells') cell
                 ON COALESCE(cell->>'normalizedHeader', '') = 'комментарий'
                AND btrim(COALESCE(NULLIF(cell->>'displayText', ''), cell->>'value', '')) <> ''
                AND char_length(btrim(COALESCE(NULLIF(cell->>'displayText', ''), cell->>'value', ''))) <= 10000
                AND lower(btrim(COALESCE(NULLIF(cell->>'displayText', ''), cell->>'value', ''))) !~ '^(нет|не указано|отсутствует|none|null|n/?a|test|тест|[-—.]+)$'
                AND btrim(COALESCE(NULLIF(cell->>'displayText', ''), cell->>'value', '')) ~ '[[:alnum:]А-Яа-яЁё]'
              WHERE participation.person_id IN ${clusterSql}
                AND participation.archived_at IS NULL
                ${eventParameter ? `AND participation.event_id = ${eventParameter}` : ''}
           ) event_data ON true
           LEFT JOIN LATERAL (
             SELECT string_agg(DISTINCT artifact.title, ' | ' ORDER BY artifact.title) AS titles,
                    count(DISTINCT artifact.id)::text AS artifact_count
              FROM artifacts artifact
              WHERE artifact.status <> 'VOIDED'
                AND artifact.archived_at IS NULL
                ${eventParameter ? `AND artifact.event_id = ${eventParameter}` : ''}
                AND EXISTS (
                  SELECT 1 FROM artifact_versions version
                  JOIN artifact_version_contributors contributor
                    ON contributor.artifact_version_id = version.id
                   WHERE version.artifact_id = artifact.id
                     AND version.status <> 'VOIDED'
                     AND contributor.person_id IN ${clusterSql}
                )
           ) artifact_data ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
                      'sheet', source.sheet_name,
                      'row', source.row_number,
                      'fields', (
                        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                 'header', COALESCE(cell->>'header', cell->>'address'),
                                 'address', cell->>'address',
                                 'value', COALESCE(
                                   NULLIF(cell->>'displayText', ''),
                                   cell#>>'{value,url}',
                                   cell#>>'{value,expression}',
                                   cell->>'value'
                                 )
                               ) ORDER BY (cell->>'column')::integer), '[]'::jsonb)
                          FROM jsonb_array_elements(source.raw_json->'cells') cell
                         WHERE COALESCE((cell->>'redacted')::boolean, false) = false
                      )
                    ) ORDER BY source.sheet_name, source.row_number) AS rows
               FROM (
                 SELECT DISTINCT source.id, source.sheet_name, source.row_number, source.raw_json
                   FROM source_entity_links link
                   JOIN source_records source ON source.id = link.source_record_id
                  WHERE upper(link.entity_type) = 'PERSON'
                    AND link.entity_id IN ${clusterSql}
                    AND link.detached_at IS NULL
                    ${
                      eventParameter
                        ? `AND EXISTS (
                             SELECT 1
                               FROM source_entity_links participation_link
                               JOIN event_participations source_participation
                                 ON source_participation.id = participation_link.entity_id
                              WHERE participation_link.source_record_id = source.id
                                AND upper(participation_link.entity_type) = 'EVENT_PARTICIPATION'
                                AND participation_link.detached_at IS NULL
                                AND source_participation.archived_at IS NULL
                                AND source_participation.event_id = ${eventParameter}
                           )`
                        : ''
                    }
               ) source
           ) source_data ON true
          ORDER BY p.normalized_full_name, p.id`,
            pageValues,
          );
          if (result.rows.length === 0) break;
          for (const row of result.rows) {
            yield `${csvRow([
              row.id,
              row.canonical_full_name,
              row.contacts,
              row.affiliations,
              Number(row.artifact_count ?? 0) > 0 ? 'Да' : 'Нет',
              row.artifact_count ?? '0',
              row.last_artifact_at?.toISOString() ?? '',
              row.from_bot ? 'BOT' : 'CRM / IMPORT',
              row.profile_needs_review ? 'Нужно уточнить ФИО' : 'Заполнен',
              row.events,
              row.artifacts,
              row.comments,
              JSON.stringify(row.source_rows),
            ])}\r\n`;
          }
          offset += result.rows.length;
        }
      }

      const suffix = query.eventId ? `-event-${query.eventId}` : '';
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="cpi-participants${suffix}.csv"`)
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('Pragma', 'no-cache')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Readable.from(streamCsv()));
    },
  );

  app.get(
    '/exports/events/:id/participants.xlsx',
    {
      config: { rateLimit: heavyOperationRateLimit(4, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'XLSX-таблица участников мероприятия',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request, reply) => {
      const eventId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const eventResult = await app.pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM events
          WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
        [eventId, organization.id],
      );
      const event = eventResult.rows[0];
      if (!event) return reply.code(404).send({ title: 'Мероприятие не найдено', status: 404 });

      const result = await app.pool.query<EventParticipantExportRow>(
        EVENT_PARTICIPANTS_EXPORT_SQL,
        [eventId, organization.id],
      );
      const bytes = await createEventParticipantsWorkbook({
        eventName: event.name,
        rows: result.rows.map((row, index) => ({
          number: index + 1,
          lastName: row.last_name,
          firstName: row.first_name,
          patronymic: row.patronymic,
          canonicalFullName: row.canonical_full_name,
          email: row.email,
          phone: row.phone,
          telegram: row.telegram,
          telegramUserId: row.telegram_user_id,
          attended: row.attended,
          decision: exportDecisionLabel(row.decisions),
          result: row.result,
          eventName: event.name,
        })),
      });
      await app.pool.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
         VALUES ($1, $2, $3, 'event.participants_xlsx_exported', 'event', $4,
                 $5::jsonb, 'Выгрузка таблицы участников мероприятия')`,
        [
          request.authUser!.userId,
          request.authUser!.sub,
          request.id,
          eventId,
          JSON.stringify({ rows: result.rows.length }),
        ],
      );
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header(
          'Content-Disposition',
          `attachment; filename="cpi-event-participants-${eventId}.xlsx"`,
        )
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Buffer.from(bytes));
    },
  );

  // Клиент создаётся при первой ZIP-выгрузке: остальные экспорты в объектное
  // хранилище не ходят и не должны падать без его конфигурации.
  let s3Client: S3Client | null = null;
  const getS3 = (): S3Client => {
    s3Client ??= new S3Client({
      endpoint: app.config.storage.endpoint,
      region: app.config.storage.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: app.config.storage.accessKey,
        secretAccessKey: app.config.storage.secretKey,
      },
    });
    return s3Client;
  };

  app.get(
    '/exports/period/summary.json',
    {
      config: { rateLimit: heavyOperationRateLimit(6, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'Сводка CRM за выбранный период',
        querystring: PeriodQuery,
      },
    },
    async (request, reply) => {
      const period = periodFromQuery(request.query as PeriodQueryInput);
      const organization = await getOrganizationContext(app.pool);
      const report = await loadOperationalPeriodReport(app.pool, organization.id, period);
      await auditPeriodExport(app, request, 'period.summary_exported', report, 'JSON');
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${periodFileStem(period)}.json"`)
        .send(report);
    },
  );

  app.get(
    '/exports/period/report.svg',
    {
      config: { rateLimit: heavyOperationRateLimit(6, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'Изображение дашборда за выбранный период',
        querystring: PeriodQuery,
      },
    },
    async (request, reply) => {
      const period = periodFromQuery(request.query as PeriodQueryInput);
      const organization = await getOrganizationContext(app.pool);
      const report = await loadOperationalPeriodReport(app.pool, organization.id, period);
      await auditPeriodExport(app, request, 'period.dashboard_image_exported', report, 'SVG');
      return reply
        .header('Content-Type', 'image/svg+xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${periodFileStem(period)}.svg"`)
        .send(operationalReportSvg(report));
    },
  );

  app.get(
    '/exports/period/package.zip',
    {
      config: { rateLimit: heavyOperationRateLimit(2, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'Полный ZIP: отчёт, таблицы и файлы артефактов за период',
        querystring: PeriodQuery,
      },
    },
    async (request, reply) => {
      const period = periodFromQuery(request.query as PeriodQueryInput);
      const organization = await getOrganizationContext(app.pool);
      const [report, data] = await Promise.all([
        loadOperationalPeriodReport(app.pool, organization.id, period),
        loadPeriodExportData(app, organization.id, period),
      ]);

      const usedPaths = new Set<string>();
      const downloads: {
        archivePath: string;
        fileId: string;
        storageProvider: 'CRM' | 'LOCKER';
      }[] = [];
      const skipped: { artifact: string; file: string; reason: string }[] = [];
      const versionFiles = new Map<string, string[]>();
      for (const artifact of data.artifacts) {
        const author = artifact.authors[0] ?? 'Без автора';
        const folder = `${artifact.submitted_at.toISOString().slice(0, 10)}_${sanitizeArchiveSegment(author)}`;
        for (const file of artifact.files) {
          if (file.status !== 'AVAILABLE') {
            skipped.push({ artifact: artifact.title, file: file.fileName, reason: file.status });
            continue;
          }
          const archivePath = uniqueArchivePath(
            usedPaths,
            `artifacts/${folder}/${sanitizeArchiveSegment(artifact.title)}/${sanitizeArchiveSegment(file.fileName)}`,
          );
          downloads.push({
            archivePath,
            fileId: file.id,
            storageProvider: file.storageProvider,
          });
          const paths = versionFiles.get(artifact.version_id) ?? [];
          paths.push(archivePath);
          versionFiles.set(artifact.version_id, paths);
        }
      }
      const sources = await resolveDownloadSources(app, getS3(), downloads);
      skipped.push(...sources.failures);

      const workbookBytes = await createOperationalPeriodWorkbook({
        period: { from: report.period.from, to: report.period.to },
        summary: [
          {
            label: 'Новые участники',
            value: report.people.newPeople,
            note: `Из бота: ${report.people.newFromBot}`,
          },
          {
            label: 'Всего участников',
            value: report.people.total,
            note: `Из бота: ${report.people.totalFromBot}`,
          },
          { label: 'Отправляли артефакты за период', value: report.artifacts.uniqueAuthors },
          { label: 'Отправляли артефакты всего', value: report.people.artifactSendersEver },
          { label: 'Отправлено версий', value: report.artifacts.submittedVersions },
          {
            label: 'Файлов',
            value: report.artifacts.files,
            note: `Доступно: ${report.artifacts.availableFiles}`,
          },
          {
            label: 'Оценено',
            value: report.artifacts.reviewed,
            note: `Средний балл: ${report.artifacts.averageScore?.toFixed(1) ?? '—'}`,
          },
          { label: 'Участий в мероприятиях', value: report.events.participations },
          { label: 'Завершено задач', value: report.tasks.completed },
          { label: 'Взаимодействий', value: report.interactions.recorded },
          { label: 'Нужно уточнить ФИО', value: report.people.profilesNeedReview },
          {
            label: 'Проектов в CRM',
            value: data.projects.length,
            note: 'Полный состав и все артефакты — на отдельных листах',
          },
        ],
        artifacts: data.artifacts.map((artifact) => ({
          versionId: artifact.version_id,
          artifactId: artifact.artifact_id,
          submittedAt: artifact.submitted_at.toISOString(),
          title: artifact.title,
          typeName: artifact.type_name,
          authors: artifact.authors.join(' | '),
          projectName: artifact.project_name,
          eventName: artifact.event_name,
          source: artifact.source,
          score: artifact.score,
          decision: artifact.decision,
          externalUrls: artifact.external_urls.join(' | '),
          archivePaths: (versionFiles.get(artifact.version_id) ?? []).join(' | '),
        })),
        people: data.people.map((person) => ({
          id: person.id,
          fullName: person.canonical_full_name,
          createdAt: person.created_at.toISOString(),
          source: person.from_bot ? 'BOT' : 'CRM / IMPORT',
          ownerName: person.owner_name,
          artifactCount: Number(person.artifact_count),
          profileNeedsReview: person.profile_needs_review,
        })),
        tasks: data.tasks.map((task) => ({
          id: task.id,
          createdAt: task.created_at.toISOString(),
          completedAt: task.completed_at?.toISOString() ?? null,
          status: task.status,
          title: task.title,
          personName: task.person_name,
          assigneeName: task.assignee_name,
          dueAt: task.due_at?.toISOString() ?? null,
          attachments: task.attachments.join(' | '),
        })),
        events: data.events.map((item) => ({
          id: item.id,
          eventName: item.event_name,
          personName: item.person_name,
          createdAt: item.created_at.toISOString(),
          decision: item.decision,
          attendance: item.attendance,
          result: item.result,
          source: item.data_origin,
        })),
        interactions: data.interactions.map((item) => ({
          id: item.id,
          occurredAt: item.occurred_at.toISOString(),
          personName: item.person_name,
          channel: item.channel,
          direction: item.direction,
          outcome: item.outcome,
          comment: item.comment,
          responsibleName: item.responsible_name,
          nextContactAt: item.next_contact_at?.toISOString() ?? null,
          attachments: item.attachments.join(' | '),
        })),
        projects: data.projects.map((project) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          description: project.description,
          startsAt: project.starts_at?.toISOString() ?? null,
          endsAt: project.ends_at?.toISOString() ?? null,
          ownerName: project.owner_name,
          memberCount: Number(project.member_count),
          artifactCount: Number(project.artifact_count),
          eventCount: Number(project.event_count),
        })),
        projectMembers: data.projectMembers.map((membership) => ({
          projectId: membership.project_id,
          projectName: membership.project_name,
          personId: membership.person_id,
          personName: membership.person_name,
          role: membership.role,
          joinedAt: membership.joined_at.toISOString(),
        })),
        projectArtifacts: data.projectArtifacts.map((artifact) => ({
          projectId: artifact.project_id,
          projectName: artifact.project_name,
          artifactId: artifact.artifact_id,
          title: artifact.title,
          typeName: artifact.type_name,
          status: artifact.status,
          latestVersionStatus: artifact.version_status,
          submittedAt: artifact.submitted_at?.toISOString() ?? null,
          authors: artifact.authors.join(' | '),
          eventName: artifact.event_name,
          score: artifact.score,
          decision: artifact.decision,
        })),
        projectEvents: data.projectEvents.map((item) => ({
          projectId: item.project_id,
          projectName: item.project_name,
          eventId: item.event_id,
          eventName: item.event_name,
          registeredAt: item.registered_at.toISOString(),
          decision: item.decision,
          attendance: item.attendance,
          result: item.result,
        })),
      });

      await auditPeriodExport(app, request, 'period.package_zip_exported', report, 'ZIP', {
        files: sources.entries.length,
        skipped: skipped.length,
      });

      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('warning', (error: Error) => app.log.warn({ err: error }, 'period zip warning'));
      archive.on('error', (error: Error) => archive.destroy(error));
      archive.append(
        JSON.stringify({ ...report, files: sources.entries.length, skipped }, null, 2),
        {
          name: 'report/summary.json',
        },
      );
      archive.append(operationalReportSvg(report), { name: 'report/dashboard.svg' });
      archive.append(Buffer.from(workbookBytes), { name: 'tables/Отчёт.xlsx' });
      archive.append(
        `Выгрузка ЦПИ за ${period.from.toISOString()} — ${period.to.toISOString()}\n\n` +
          'report/dashboard.svg — изображение отчёта\n' +
          'report/summary.json — машиночитаемая сводка\n' +
          'tables/Отчёт.xlsx — сводка и таблицы CRM на отдельных листах\n' +
          'В XLSX проекты раскрыты по участникам, артефактам и мероприятиям.\n' +
          'artifacts/ — доступные файлы отправленных версий\n' +
          'Недоступные или непроверенные файлы перечислены в summary.json и не теряются из CRM.\n',
        { name: 'README.txt' },
      );

      void (async () => {
        for (const entry of sources.entries) {
          if (request.raw.aborted) break;
          try {
            archive.append(await entry.open(), { name: entry.archivePath });
          } catch (error) {
            app.log.warn({ err: error, file: entry.archivePath }, 'period zip skipped file');
          }
        }
        await archive.finalize();
      })().catch((error: unknown) => {
        app.log.error({ err: error }, 'period zip stream failed');
        archive.destroy(error instanceof Error ? error : new Error('period zip failed'));
      });

      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${periodFileStem(period)}.zip"`)
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('X-Content-Type-Options', 'nosniff')
        .send(archive);
    },
  );

  app.get(
    '/exports/projects/:id/package.zip',
    {
      config: { rateLimit: heavyOperationRateLimit(2, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'ZIP-пакет проекта: XLSX и файлы всех артефактов',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const projectResult = await app.pool.query<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        starts_at: Date | null;
        ends_at: Date | null;
        owner_name: string | null;
      }>(
        `SELECT project.id, project.name, project.description, project.status,
                project.starts_at, project.ends_at, owner.display_name AS owner_name
           FROM projects project
           LEFT JOIN app_users owner ON owner.id = project.owner_user_id
          WHERE project.id = $1 AND project.organization_id = $2
            AND project.archived_at IS NULL`,
        [projectId, organization.id],
      );
      const project = projectResult.rows[0];
      if (!project) throw new HttpProblem(404, 'Проект не найден');

      const [members, artifacts, events] = await Promise.all([
        app.pool.query<{
          person_id: string;
          person_name: string;
          role: string;
          joined_at: Date;
        }>(
          `SELECT canonical.id AS person_id, canonical.canonical_full_name AS person_name,
                  membership.role, membership.joined_at
             FROM project_memberships membership
             JOIN persons member ON member.id = membership.person_id
             JOIN persons canonical
               ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
            WHERE membership.project_id = $1 AND membership.archived_at IS NULL
              AND canonical.archived_at IS NULL
            ORDER BY canonical.normalized_full_name, canonical.id`,
          [projectId],
        ),
        app.pool.query<{
          artifact_id: string;
          title: string;
          type_name: string;
          status: string;
          version_id: string | null;
          version_status: string | null;
          submitted_at: Date | null;
          event_name: string | null;
          score: number | null;
          decision: string | null;
          authors: string[];
          external_urls: string[];
          files: {
            id: string;
            fileName: string;
            status: string;
            storageProvider: 'CRM' | 'LOCKER';
          }[];
        }>(
          `SELECT artifact.id AS artifact_id, artifact.title, type.name AS type_name,
                  artifact.status, latest.id AS version_id,
                  latest.status AS version_status, latest.submitted_at,
                  event.name AS event_name, review.score, review.decision,
                  COALESCE(authors.items, '[]'::jsonb) AS authors,
                  COALESCE(urls.items, '[]'::jsonb) AS external_urls,
                  COALESCE(files.items, '[]'::jsonb) AS files
             FROM artifacts artifact
             JOIN artifact_types type ON type.id = artifact.type_id
             LEFT JOIN events event ON event.id = artifact.event_id
             LEFT JOIN LATERAL (
               SELECT version.id, version.status, version.submitted_at
                 FROM artifact_versions version
                WHERE version.artifact_id = artifact.id AND version.status <> 'VOIDED'
                ORDER BY version.version_number DESC LIMIT 1
             ) latest ON true
             LEFT JOIN artifact_review_selections selection
               ON selection.artifact_version_id = latest.id
             LEFT JOIN artifact_reviews review ON review.id = selection.current_final_review_id
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(DISTINCT canonical.canonical_full_name
                                ORDER BY canonical.canonical_full_name) AS items
                 FROM artifact_version_contributors contributor
                 JOIN persons member ON member.id = contributor.person_id
                 JOIN persons canonical
                   ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
                WHERE contributor.artifact_version_id = latest.id
                  AND contributor.contribution_role = 'AUTHOR'
             ) authors ON true
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(asset.external_url ORDER BY asset.display_order) AS items
                 FROM artifact_assets asset
                WHERE asset.artifact_version_id = latest.id
                  AND asset.asset_type = 'EXTERNAL_URL' AND asset.external_url IS NOT NULL
             ) urls ON true
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(jsonb_build_object(
                        'id', file.id,
                        'fileName', file.original_filename,
                        'status', file.status,
                        'storageProvider', file.storage_provider
                      ) ORDER BY asset.display_order, asset.id) AS items
                 FROM artifact_assets asset
                 JOIN file_objects file ON file.id = asset.file_object_id
                WHERE asset.artifact_version_id = latest.id AND asset.asset_type = 'FILE'
             ) files ON true
            WHERE artifact.project_id = $1 AND artifact.organization_id = $2
              AND artifact.archived_at IS NULL AND artifact.status <> 'VOIDED'
            ORDER BY latest.submitted_at DESC NULLS LAST, artifact.title`,
          [projectId, organization.id],
        ),
        app.pool.query<{
          event_id: string;
          event_name: string;
          registered_at: Date;
          decision: string;
          attendance: string;
          result: string | null;
        }>(
          `SELECT event.id AS event_id, event.name AS event_name,
                  participation.registered_at, participation.decision,
                  participation.attendance, participation.result
             FROM event_project_participations participation
             JOIN events event ON event.id = participation.event_id
            WHERE participation.project_id = $1
              AND participation.archived_at IS NULL AND event.archived_at IS NULL
            ORDER BY event.starts_at DESC NULLS LAST, event.name`,
          [projectId],
        ),
      ]);

      const usedPaths = new Set<string>();
      const pathsByArtifact = new Map<string, string[]>();
      const downloads: {
        archivePath: string;
        fileId: string;
        storageProvider: 'CRM' | 'LOCKER';
      }[] = [];
      const skipped: { artifact: string; file: string; reason: string }[] = [];
      for (const artifact of artifacts.rows) {
        const paths: string[] = [];
        for (const file of artifact.files) {
          if (file.status !== 'AVAILABLE') {
            skipped.push({ artifact: artifact.title, file: file.fileName, reason: file.status });
            continue;
          }
          const archivePath = uniqueArchivePath(
            usedPaths,
            `artifacts/${sanitizeArchiveSegment(artifact.title)}/${sanitizeArchiveSegment(file.fileName)}`,
          );
          paths.push(archivePath);
          downloads.push({ archivePath, fileId: file.id, storageProvider: file.storageProvider });
        }
        pathsByArtifact.set(artifact.artifact_id, paths);
      }
      const sources = await resolveDownloadSources(app, getS3(), downloads);
      skipped.push(...sources.failures);
      const workbook = await createProjectWorkbook({
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          description: project.description,
          startsAt: project.starts_at?.toISOString() ?? null,
          endsAt: project.ends_at?.toISOString() ?? null,
          ownerName: project.owner_name,
        },
        members: members.rows.map((member) => ({
          personId: member.person_id,
          personName: member.person_name,
          role: member.role,
          joinedAt: member.joined_at.toISOString(),
        })),
        artifacts: artifacts.rows.map((artifact) => ({
          artifactId: artifact.artifact_id,
          title: artifact.title,
          typeName: artifact.type_name,
          status: artifact.status,
          versionStatus: artifact.version_status,
          submittedAt: artifact.submitted_at?.toISOString() ?? null,
          authors: artifact.authors.join(' | '),
          eventName: artifact.event_name,
          score: artifact.score,
          decision: artifact.decision,
          externalUrls: artifact.external_urls.join(' | '),
          archivePaths: (pathsByArtifact.get(artifact.artifact_id) ?? []).join(' | '),
        })),
        events: events.rows.map((event) => ({
          eventId: event.event_id,
          eventName: event.event_name,
          registeredAt: event.registered_at.toISOString(),
          decision: event.decision,
          attendance: event.attendance,
          result: event.result,
        })),
      });

      await app.pool.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
         VALUES ($1, $2, $3, 'project.package_zip_exported', 'project', $4, $5::jsonb,
                 'Выгрузка ZIP-пакета проекта')`,
        [
          request.authUser!.userId,
          request.authUser!.sub,
          request.id,
          projectId,
          JSON.stringify({
            members: members.rows.length,
            artifacts: artifacts.rows.length,
            events: events.rows.length,
            files: sources.entries.length,
            skipped: skipped.length,
          }),
        ],
      );

      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('warning', (error: Error) => app.log.warn({ err: error }, 'project zip warning'));
      archive.on('error', (error: Error) => archive.destroy(error));
      archive.append(Buffer.from(workbook), { name: 'Проект.xlsx' });
      archive.append(JSON.stringify({ skipped }, null, 2), { name: 'summary.json' });
      void (async () => {
        for (const entry of sources.entries) {
          if (request.raw.aborted) break;
          try {
            archive.append(await entry.open(), { name: entry.archivePath });
          } catch (error) {
            app.log.warn({ err: error, file: entry.archivePath }, 'project zip skipped file');
          }
        }
        await archive.finalize();
      })().catch((error: unknown) => {
        archive.destroy(error instanceof Error ? error : new Error('project zip failed'));
      });
      const fileName = `cpi-project-${sanitizeArchiveSegment(project.name).slice(0, 60)}.zip`;
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="cpi-project-${projectId}.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        )
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('X-Content-Type-Options', 'nosniff')
        .send(archive);
    },
  );

  app.get(
    '/exports/events/:id/package.zip',
    {
      config: { rateLimit: heavyOperationRateLimit(2, '1 minute') },
      preHandler: [app.requirePermission(Permissions.EXPORTS_BULK), guardExportConcurrency],
      schema: {
        tags: ['Экспорт'],
        summary: 'ZIP-пакет мероприятия: таблица участников и файлы артефактов',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request, reply) => {
      const eventId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const eventResult = await app.pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM events
          WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
        [eventId, organization.id],
      );
      const event = eventResult.rows[0];
      if (!event) return reply.code(404).send({ title: 'Мероприятие не найдено', status: 404 });

      const [participantsResult, artifactsResult] = await Promise.all([
        app.pool.query<EventParticipantExportRow>(EVENT_PARTICIPANTS_EXPORT_SQL, [
          eventId,
          organization.id,
        ]),
        app.pool.query(EVENT_ARTIFACTS_SQL, [eventId]),
      ]);
      const artifacts = artifactsResult.rows.map(mapEventArtifactRow);

      // Раскладка архива: папка на автора, внутри — файлы его артефактов.
      const usedPaths = new Set<string>();
      const downloads: {
        archivePath: string;
        fileId: string;
        storageProvider: 'CRM' | 'LOCKER';
      }[] = [];
      const skipped: { artifact: string; file: string; reason: string }[] = [];
      const byAuthor = new Map<string, EventParticipantWorkbookArtifact[]>();
      const orphanArtifacts: EventParticipantWorkbookArtifact[] = [];

      for (const artifact of artifacts) {
        const author = artifact.authors[0];
        const folder = sanitizeArchiveSegment(author?.name ?? 'Без автора');
        const entries: EventParticipantWorkbookArtifact[] = [];

        if (artifact.files.length === 0) {
          entries.push({
            title: artifact.title,
            typeName: artifact.typeName,
            score: artifact.score,
            decision: artifact.decision,
            submittedAt: artifact.submittedAt,
            externalUrl: artifact.externalUrls[0] ?? null,
          });
        }

        for (const file of artifact.files) {
          if (file.status !== 'AVAILABLE') {
            skipped.push({
              artifact: artifact.title,
              file: file.fileName,
              reason: `Файл в статусе ${file.status}`,
            });
            entries.push({
              title: artifact.title,
              typeName: artifact.typeName,
              score: artifact.score,
              decision: artifact.decision,
              submittedAt: artifact.submittedAt,
              fileName: file.fileName,
            });
            continue;
          }
          const archivePath = uniqueArchivePath(
            usedPaths,
            `artifacts/${folder}/${sanitizeArchiveSegment(file.fileName)}`,
          );
          downloads.push({
            archivePath,
            fileId: file.id,
            storageProvider: file.storageProvider,
          });
          entries.push({
            title: artifact.title,
            typeName: artifact.typeName,
            score: artifact.score,
            decision: artifact.decision,
            submittedAt: artifact.submittedAt,
            fileName: file.fileName,
            archivePath,
            externalUrl: artifact.externalUrls[0] ?? null,
          });
        }

        if (author) {
          const bucket = byAuthor.get(author.id);
          if (bucket) bucket.push(...entries);
          else byAuthor.set(author.id, [...entries]);
        } else {
          orphanArtifacts.push(...entries);
        }
      }

      const sources = await resolveDownloadSources(app, getS3(), downloads);
      for (const failure of sources.failures) skipped.push(failure);

      const workbookRows = participantsResult.rows.map((row, index) => ({
        number: index + 1,
        lastName: row.last_name,
        firstName: row.first_name,
        patronymic: row.patronymic,
        canonicalFullName: row.canonical_full_name,
        email: row.email,
        phone: row.phone,
        telegram: row.telegram,
        telegramUserId: row.telegram_user_id,
        attended: row.attended,
        decision: exportDecisionLabel(row.decisions),
        result: row.result,
        eventName: event.name,
        artifacts: byAuthor.get(row.person_id) ?? [],
      }));
      // Авторы артефактов, не записанные в участники, не должны потеряться в таблице.
      const participantIds = new Set(participantsResult.rows.map((row) => row.person_id));
      let extraNumber = workbookRows.length;
      for (const artifact of artifacts) {
        const author = artifact.authors[0];
        if (!author || participantIds.has(author.id)) continue;
        participantIds.add(author.id);
        extraNumber += 1;
        workbookRows.push({
          number: extraNumber,
          lastName: '',
          firstName: '',
          patronymic: '',
          canonicalFullName: author.name,
          email: null,
          phone: null,
          telegram: null,
          telegramUserId: null,
          attended: null,
          decision: 'Не участник мероприятия',
          result: null,
          eventName: event.name,
          artifacts: byAuthor.get(author.id) ?? [],
        });
      }

      const workbookBytes = await createEventParticipantsWorkbook({
        eventName: event.name,
        rows: workbookRows,
      });

      await app.pool.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
         VALUES ($1, $2, $3, 'event.package_zip_exported', 'event', $4,
                 $5::jsonb, 'Выгрузка ZIP-пакета мероприятия')`,
        [
          request.authUser!.userId,
          request.authUser!.sub,
          request.id,
          eventId,
          JSON.stringify({
            participants: participantsResult.rows.length,
            artifacts: artifacts.length,
            files: sources.entries.length,
            skipped: skipped.length,
          }),
        ],
      );

      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('warning', (error: Error) => app.log.warn({ err: error }, 'zip export warning'));
      archive.on('error', (error: Error) => {
        app.log.error({ err: error }, 'zip export failed');
        archive.destroy(error);
      });

      archive.append(Buffer.from(workbookBytes), { name: 'Участники.xlsx' });
      archive.append(
        JSON.stringify(
          {
            event: { id: event.id, name: event.name },
            exportedAt: new Date().toISOString(),
            participants: participantsResult.rows.length,
            artifacts: artifacts.map((artifact) => ({
              id: artifact.id,
              title: artifact.title,
              typeName: artifact.typeName,
              authors: artifact.authors.map((author) => author.name),
              authorOutsideEvent: artifact.authorOutsideEvent,
              score: artifact.score,
              decision: artifact.decision,
              source: artifact.source,
            })),
            files: sources.entries.map((entry) => entry.archivePath),
            skipped,
          },
          null,
          2,
        ),
        { name: 'manifest.json' },
      );

      // Файлы кладутся по очереди: archiver всё равно обрабатывает поток за потоком,
      // а последовательность не даёт подписанным ссылкам протухнуть в ожидании.
      void (async () => {
        for (const entry of sources.entries) {
          if (request.raw.aborted) break;
          try {
            const body = await entry.open();
            archive.append(body, { name: entry.archivePath });
          } catch (error) {
            app.log.warn({ err: error, file: entry.archivePath }, 'zip export skipped file');
          }
        }
        await archive.finalize();
      })().catch((error: unknown) => {
        app.log.error({ err: error }, 'zip export stream failed');
        archive.destroy(error instanceof Error ? error : new Error('zip export failed'));
      });

      const fileName = `cpi-event-${sanitizeArchiveSegment(event.name).slice(0, 60)}.zip`;
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="cpi-event-${eventId}.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        )
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('X-Content-Type-Options', 'nosniff')
        .send(archive);
    },
  );
}

function periodFromQuery(query: PeriodQueryInput): PeriodBounds {
  try {
    return resolvePeriod(query);
  } catch (error) {
    throw new HttpProblem(400, error instanceof Error ? error.message : 'Некорректный период');
  }
}

function periodFileStem(period: PeriodBounds): string {
  return `cpi-report-${period.from.toISOString().slice(0, 10)}-${period.to.toISOString().slice(0, 10)}`;
}

async function auditPeriodExport(
  app: FastifyInstance,
  request: FastifyRequest,
  action: string,
  report: { period: unknown; artifacts: { submittedVersions: number } },
  format: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await app.pool.query(
    `INSERT INTO audit_log
       (actor_user_id, actor_subject, request_id, action, entity_type, after, reason)
     VALUES ($1, $2, $3, $4, 'export', $5::jsonb, $6)`,
    [
      request.authUser!.userId,
      request.authUser!.sub,
      request.id,
      action,
      JSON.stringify({
        period: report.period,
        format,
        artifacts: report.artifacts.submittedVersions,
        ...extra,
      }),
      `Выгрузка операционного отчёта в формате ${format}`,
    ],
  );
}

async function loadPeriodExportData(
  app: FastifyInstance,
  organizationId: string,
  period: PeriodBounds,
) {
  const parameters = [organizationId, period.from, period.to];
  const [
    artifacts,
    people,
    tasks,
    events,
    interactions,
    projects,
    projectMembers,
    projectArtifacts,
    projectEvents,
  ] = await Promise.all([
    app.pool.query<PeriodArtifactRow>(
      `SELECT version.id AS version_id, artifact.id AS artifact_id,
              version.submitted_at, artifact.title, type.name AS type_name,
              event.name AS event_name, project.name AS project_name,
              CASE WHEN locker.artifact_version_id IS NULL THEN 'CRM' ELSE 'BOT' END AS source,
              review.score, review.decision,
              COALESCE(authors.items, '[]'::jsonb) AS authors,
              COALESCE(urls.items, '[]'::jsonb) AS external_urls,
              COALESCE(files.items, '[]'::jsonb) AS files
         FROM artifact_versions version
         JOIN artifacts artifact ON artifact.id = version.artifact_id
         JOIN artifact_types type ON type.id = artifact.type_id
         LEFT JOIN events event ON event.id = artifact.event_id
         LEFT JOIN projects project ON project.id = artifact.project_id
         LEFT JOIN locker_submission_links locker ON locker.artifact_version_id = version.id
         LEFT JOIN artifact_review_selections selection ON selection.artifact_version_id = version.id
         LEFT JOIN artifact_reviews review ON review.id = selection.current_final_review_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT canonical.canonical_full_name
                            ORDER BY canonical.canonical_full_name) AS items
             FROM artifact_version_contributors contributor
             JOIN persons member ON member.id = contributor.person_id
             JOIN persons canonical ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
            WHERE contributor.artifact_version_id = version.id
              AND contributor.contribution_role = 'AUTHOR'
         ) authors ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(asset.external_url ORDER BY asset.display_order) AS items
             FROM artifact_assets asset
            WHERE asset.artifact_version_id = version.id
              AND asset.asset_type = 'EXTERNAL_URL' AND asset.external_url IS NOT NULL
         ) urls ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
                    'id', file.id,
                    'fileName', file.original_filename,
                    'status', file.status,
                    'storageProvider', file.storage_provider
                  ) ORDER BY asset.display_order, asset.id) AS items
             FROM artifact_assets asset
             JOIN file_objects file ON file.id = asset.file_object_id
            WHERE asset.artifact_version_id = version.id AND asset.asset_type = 'FILE'
         ) files ON true
        WHERE artifact.organization_id = $1 AND artifact.archived_at IS NULL
          AND artifact.status <> 'VOIDED' AND version.status = 'SUBMITTED'
          AND version.submitted_at >= $2 AND version.submitted_at < $3
        ORDER BY version.submitted_at, artifact.id, version.version_number`,
      parameters,
    ),
    app.pool.query<{
      id: string;
      canonical_full_name: string;
      created_at: Date;
      owner_name: string | null;
      from_bot: boolean;
      artifact_count: string;
      profile_needs_review: boolean;
    }>(
      `SELECT person.id, person.canonical_full_name, person.created_at,
              owner.display_name AS owner_name,
              person.profile_needs_review,
              COALESCE(artifact_data.artifact_count, 0)::text AS artifact_count,
              EXISTS (
                SELECT 1 FROM external_identities identity
                 WHERE identity.person_id IN (
                         SELECT member.id FROM persons member
                          WHERE member.id = person.id OR member.merged_into_person_id = person.id
                       )
                   AND identity.source_namespace IN ('locker.user', 'locker.telegram')
                   AND identity.archived_at IS NULL
              ) AS from_bot
         FROM persons person
         LEFT JOIN app_users owner ON owner.id = person.owner_user_id
         LEFT JOIN LATERAL (
           SELECT count(DISTINCT artifact.id) AS artifact_count
             FROM artifact_versions version
             JOIN artifacts artifact ON artifact.id = version.artifact_id
             JOIN artifact_version_contributors contributor
               ON contributor.artifact_version_id = version.id
            WHERE contributor.person_id IN (
                    SELECT member.id FROM persons member
                     WHERE member.id = person.id OR member.merged_into_person_id = person.id
                  )
              AND contributor.contribution_role = 'AUTHOR'
              AND version.status = 'SUBMITTED'
              AND artifact.status <> 'VOIDED' AND artifact.archived_at IS NULL
         ) artifact_data ON true
        WHERE person.organization_id = $1 AND person.archived_at IS NULL
          AND person.merged_into_person_id IS NULL
          AND person.created_at >= $2 AND person.created_at < $3
        ORDER BY person.normalized_full_name, person.id`,
      parameters,
    ),
    app.pool.query<{
      id: string;
      created_at: Date;
      completed_at: Date | null;
      status: string;
      title: string;
      person_name: string | null;
      assignee_name: string | null;
      due_at: Date | null;
      attachments: string[];
    }>(
      `SELECT task.id, task.created_at, task.completed_at, task.status, task.title,
              person.canonical_full_name AS person_name,
              assignee.display_name AS assignee_name, task.due_at,
              COALESCE(attachments.items, '[]'::jsonb) AS attachments
         FROM tasks task
         LEFT JOIN persons person ON person.id = task.person_id
         LEFT JOIN projects project ON project.id = task.project_id
         LEFT JOIN app_users assignee ON assignee.id = task.assignee_user_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(file.original_filename ORDER BY attachment.created_at) AS items
             FROM task_attachments attachment
             JOIN file_objects file ON file.id = attachment.file_object_id
            WHERE attachment.task_id = task.id
         ) attachments ON true
        WHERE task.archived_at IS NULL
          AND COALESCE(person.organization_id, project.organization_id) = $1
          AND ((task.created_at >= $2 AND task.created_at < $3)
               OR (task.completed_at >= $2 AND task.completed_at < $3))
        ORDER BY task.created_at, task.id`,
      parameters,
    ),
    app.pool.query<{
      id: string;
      event_name: string;
      person_name: string;
      created_at: Date;
      decision: string;
      attendance: string;
      data_origin: string;
      result: string | null;
    }>(
      `SELECT participation.id, event.name AS event_name,
              canonical.canonical_full_name AS person_name,
              participation.created_at, participation.decision,
              participation.attendance, participation.data_origin, participation.result
         FROM event_participations participation
         JOIN events event ON event.id = participation.event_id
         JOIN persons member ON member.id = participation.person_id
         JOIN persons canonical ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
        WHERE event.organization_id = $1 AND participation.archived_at IS NULL
          AND participation.created_at >= $2 AND participation.created_at < $3
        ORDER BY participation.created_at, participation.id`,
      parameters,
    ),
    app.pool.query<{
      id: string;
      occurred_at: Date;
      person_name: string;
      channel: string;
      direction: string;
      outcome: string | null;
      comment: string | null;
      responsible_name: string | null;
      next_contact_at: Date | null;
      attachments: string[];
    }>(
      `SELECT interaction.id, interaction.occurred_at,
              canonical.canonical_full_name AS person_name,
              interaction.channel, interaction.direction,
              interaction.outcome, interaction.comment,
              responsible.display_name AS responsible_name,
              interaction.next_contact_at,
              COALESCE(attachments.items, '[]'::jsonb) AS attachments
         FROM interactions interaction
         JOIN persons member ON member.id = interaction.person_id
         JOIN persons canonical ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
         LEFT JOIN app_users responsible ON responsible.id = interaction.responsible_user_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(file.original_filename ORDER BY attachment.created_at) AS items
             FROM interaction_attachments attachment
             JOIN file_objects file ON file.id = attachment.file_object_id
            WHERE attachment.interaction_id = interaction.id
         ) attachments ON true
        WHERE canonical.organization_id = $1 AND canonical.archived_at IS NULL
          AND interaction.archived_at IS NULL
          AND interaction.occurred_at >= $2 AND interaction.occurred_at < $3
        ORDER BY interaction.occurred_at, interaction.id`,
      parameters,
    ),
    app.pool.query<{
      id: string;
      name: string;
      description: string | null;
      status: string;
      starts_at: Date | null;
      ends_at: Date | null;
      owner_name: string | null;
      member_count: string;
      artifact_count: string;
      event_count: string;
    }>(
      `SELECT project.id, project.name, project.description, project.status,
              project.starts_at, project.ends_at, owner.display_name AS owner_name,
              (SELECT count(*) FROM project_memberships membership
                WHERE membership.project_id = project.id
                  AND membership.archived_at IS NULL)::text AS member_count,
              (SELECT count(*) FROM artifacts artifact
                WHERE artifact.project_id = project.id
                  AND artifact.archived_at IS NULL
                  AND artifact.status <> 'VOIDED')::text AS artifact_count,
              (SELECT count(*) FROM event_project_participations participation
                WHERE participation.project_id = project.id
                  AND participation.archived_at IS NULL)::text AS event_count
         FROM projects project
         LEFT JOIN app_users owner ON owner.id = project.owner_user_id
        WHERE project.organization_id = $1 AND project.archived_at IS NULL
        ORDER BY project.normalized_name, project.id`,
      [organizationId],
    ),
    app.pool.query<{
      project_id: string;
      project_name: string;
      person_id: string;
      person_name: string;
      role: string;
      joined_at: Date;
    }>(
      `SELECT project.id AS project_id, project.name AS project_name,
              canonical.id AS person_id, canonical.canonical_full_name AS person_name,
              membership.role, membership.joined_at
         FROM project_memberships membership
         JOIN projects project ON project.id = membership.project_id
         JOIN persons member ON member.id = membership.person_id
         JOIN persons canonical ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
        WHERE project.organization_id = $1 AND project.archived_at IS NULL
          AND membership.archived_at IS NULL AND canonical.archived_at IS NULL
        ORDER BY project.normalized_name, canonical.normalized_full_name, canonical.id`,
      [organizationId],
    ),
    app.pool.query<{
      project_id: string;
      project_name: string;
      artifact_id: string;
      title: string;
      type_name: string;
      status: string;
      version_status: string | null;
      submitted_at: Date | null;
      authors: string[];
      event_name: string | null;
      score: number | null;
      decision: string | null;
    }>(
      `SELECT project.id AS project_id, project.name AS project_name,
              artifact.id AS artifact_id, artifact.title, type.name AS type_name,
              artifact.status, latest.status AS version_status, latest.submitted_at,
              COALESCE(authors.items, '[]'::jsonb) AS authors,
              event.name AS event_name, review.score, review.decision
         FROM artifacts artifact
         JOIN projects project ON project.id = artifact.project_id
         JOIN artifact_types type ON type.id = artifact.type_id
         LEFT JOIN events event ON event.id = artifact.event_id
         LEFT JOIN LATERAL (
           SELECT version.id, version.status, version.submitted_at
             FROM artifact_versions version
            WHERE version.artifact_id = artifact.id AND version.status <> 'VOIDED'
            ORDER BY version.version_number DESC LIMIT 1
         ) latest ON true
         LEFT JOIN artifact_review_selections selection ON selection.artifact_version_id = latest.id
         LEFT JOIN artifact_reviews review ON review.id = selection.current_final_review_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT canonical.canonical_full_name
                            ORDER BY canonical.canonical_full_name) AS items
             FROM artifact_version_contributors contributor
             JOIN persons member ON member.id = contributor.person_id
             JOIN persons canonical ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
            WHERE contributor.artifact_version_id = latest.id
              AND contributor.contribution_role = 'AUTHOR'
         ) authors ON true
        WHERE project.organization_id = $1 AND project.archived_at IS NULL
          AND artifact.archived_at IS NULL AND artifact.status <> 'VOIDED'
        ORDER BY project.normalized_name, latest.submitted_at DESC NULLS LAST, artifact.title`,
      [organizationId],
    ),
    app.pool.query<{
      project_id: string;
      project_name: string;
      event_id: string;
      event_name: string;
      registered_at: Date;
      decision: string;
      attendance: string;
      result: string | null;
    }>(
      `SELECT project.id AS project_id, project.name AS project_name,
              event.id AS event_id, event.name AS event_name,
              participation.registered_at, participation.decision,
              participation.attendance, participation.result
         FROM event_project_participations participation
         JOIN projects project ON project.id = participation.project_id
         JOIN events event ON event.id = participation.event_id
        WHERE project.organization_id = $1 AND project.archived_at IS NULL
          AND event.archived_at IS NULL AND participation.archived_at IS NULL
        ORDER BY project.normalized_name, event.starts_at DESC NULLS LAST, event.name`,
      [organizationId],
    ),
  ]);
  return {
    artifacts: artifacts.rows,
    people: people.rows,
    tasks: tasks.rows,
    events: events.rows,
    interactions: interactions.rows,
    projects: projects.rows,
    projectMembers: projectMembers.rows,
    projectArtifacts: projectArtifacts.rows,
    projectEvents: projectEvents.rows,
  };
}

interface ResolvedDownload {
  archivePath: string;
  open: () => Promise<Readable>;
}

/**
 * Метаданные проверяются параллельно, но короткоживущая ссылка Locker запрашивается
 * непосредственно перед чтением файла. Так она не протухнет в большом периодическом ZIP.
 * Недоступный файл не роняет всю выгрузку.
 */
async function resolveDownloadSources(
  app: FastifyInstance,
  s3: S3Client,
  downloads: readonly { archivePath: string; fileId: string; storageProvider: 'CRM' | 'LOCKER' }[],
): Promise<{
  entries: ResolvedDownload[];
  failures: { artifact: string; file: string; reason: string }[];
}> {
  if (downloads.length === 0) return { entries: [], failures: [] };

  const metadata = await app.pool.query<{
    id: string;
    bucket: string;
    object_key: string;
    original_filename: string;
    storage_provider: 'CRM' | 'LOCKER';
    external_id: string | null;
  }>(
    `SELECT id, bucket, object_key, original_filename, storage_provider, external_id
       FROM file_objects WHERE id = ANY($1::uuid[])`,
    [downloads.map((item) => item.fileId)],
  );
  const byId = new Map(metadata.rows.map((row) => [row.id, row]));

  const entries: ResolvedDownload[] = [];
  const failures: { artifact: string; file: string; reason: string }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < downloads.length) {
      const download = downloads[cursor++]!;
      const file = byId.get(download.fileId);
      if (!file) {
        failures.push({
          artifact: download.archivePath,
          file: download.archivePath,
          reason: 'Метаданные файла не найдены',
        });
        continue;
      }
      try {
        if (file.storage_provider === 'LOCKER') {
          if (!file.external_id) throw new Error('нет внешнего идентификатора');
          entries.push({
            archivePath: download.archivePath,
            open: async () => {
              const link = await requestLockerDownloadUrl(app, file.external_id!);
              const response = await fetch(link.url, { signal: AbortSignal.timeout(60_000) });
              if (!response.ok || !response.body)
                throw new Error(`Locker вернул ${response.status}`);
              return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
            },
          });
        } else {
          entries.push({
            archivePath: download.archivePath,
            open: async () => {
              const object = await s3.send(
                new GetObjectCommand({ Bucket: file.bucket, Key: file.object_key }),
              );
              if (!object.Body) throw new Error('пустое тело объекта');
              return object.Body as Readable;
            },
          });
        }
      } catch (error) {
        failures.push({
          artifact: download.archivePath,
          file: file.original_filename,
          reason: error instanceof Error ? error.message : 'Не удалось получить ссылку',
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ARTIFACT_LINK_CONCURRENCY, downloads.length) }, worker),
  );
  // Параллельные воркеры перемешивают порядок — возвращаем исходный.
  const order = new Map(downloads.map((item, index) => [item.archivePath, index]));
  entries.sort(
    (left, right) => (order.get(left.archivePath) ?? 0) - (order.get(right.archivePath) ?? 0),
  );
  return { entries, failures };
}

/** Имя папки или файла внутри ZIP: без разделителей пути и управляющих символов. */
function sanitizeArchiveSegment(value: string): string {
  const cleaned = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u001f\u007f]/gu, '')
    .replaceAll(/[/\\:*?"<>|]/gu, '_')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '');
  return cleaned.slice(0, 120) || 'файл';
}

function uniqueArchivePath(used: Set<string>, candidate: string): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf('.');
  const base = dot > candidate.lastIndexOf('/') ? candidate.slice(0, dot) : candidate;
  const extension = dot > candidate.lastIndexOf('/') ? candidate.slice(dot) : '';
  let counter = 2;
  let next = `${base} (${counter})${extension}`;
  while (used.has(next)) {
    counter += 1;
    next = `${base} (${counter})${extension}`;
  }
  used.add(next);
  return next;
}

function exportDecisionLabel(values: readonly string[]): string {
  const priority = ['ACCEPTED', 'PENDING', 'WAITLISTED', 'REJECTED', 'UNKNOWN'];
  const selected = priority.find((value) => values.includes(value)) ?? 'UNKNOWN';
  return (
    {
      ACCEPTED: 'Одобрено',
      PENDING: 'На рассмотрении',
      WAITLISTED: 'Лист ожидания',
      REJECTED: 'Отклонено',
      UNKNOWN: 'Не указано',
    }[selected] ?? selected
  );
}

function csvRow(values: readonly unknown[]): string {
  return values.map((value) => csvCell(value == null ? '' : String(value))).join(';');
}

function csvCell(value: string): string {
  const safe = /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
