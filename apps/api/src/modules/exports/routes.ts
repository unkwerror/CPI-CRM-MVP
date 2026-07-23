import { Permissions, normalizeEmail, normalizeFullName, normalizePhone } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';

import { createConcurrencyGuard, heavyOperationRateLimit } from '../../lib/heavy-operations.js';
import { getOrganizationContext } from '../../lib/organization.js';

const LIVE_ACTIVITY_SQL = `CASE
  WHEN p.activation_state <> 'ACTIVATED' OR p.last_artifact_at IS NULL THEN 'UNKNOWN'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.active_window_hours) THEN 'ACTIVE'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.inactive_after_hours) THEN 'MEDIUM'
  ELSE 'INACTIVE'
END`;

const EXPORT_BATCH_SIZE = 25;

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
          activityStatus: Type.Optional(
            Type.Union([
              Type.Literal('UNKNOWN'),
              Type.Literal('ACTIVE'),
              Type.Literal('MEDIUM'),
              Type.Literal('INACTIVE'),
            ]),
          ),
          activationState: Type.Optional(
            Type.Union([
              Type.Literal('UNKNOWN_LEGACY'),
              Type.Literal('NOT_ACTIVATED'),
              Type.Literal('ACTIVATED'),
            ]),
          ),
          eventId: Type.Optional(Type.String({ format: 'uuid' })),
          awaitingReview: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const query = request.query as {
        q?: string;
        activityStatus?: string;
        activationState?: string;
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
      if (query.activityStatus) {
        values.push(query.activityStatus);
        where.push(`${LIVE_ACTIVITY_SQL} = $${values.length}`);
      }
      if (query.activationState) {
        values.push(query.activationState);
        where.push(`p.activation_state = $${values.length}`);
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
           JOIN organization_settings settings ON settings.organization_id = p.organization_id
           JOIN lifecycle_rule_sets lrs ON lrs.id = settings.current_lifecycle_rule_set_id
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
        'Активация',
        'Активность',
        'Последний артефакт',
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
                 JOIN organization_settings settings
                   ON settings.organization_id = p.organization_id
                 JOIN lifecycle_rule_sets lrs
                   ON lrs.id = settings.current_lifecycle_rule_set_id
                WHERE ${where.join(' AND ')}
                ORDER BY p.normalized_full_name, p.id
                LIMIT ${limitParameter} OFFSET ${offsetParameter}
             )
             SELECT p.id, p.canonical_full_name, p.activation_state,
                ${LIVE_ACTIVITY_SQL} AS activity_status, p.last_artifact_at,
                COALESCE(contacts.values, '') AS contacts,
                COALESCE(affiliations.values, '') AS affiliations,
                COALESCE(event_data.names, '') AS events,
                COALESCE(event_data.comments, '') AS comments,
                COALESCE(artifact_data.titles, '') AS artifacts,
                COALESCE(source_data.rows, '[]'::jsonb) AS source_rows
           FROM export_people export_person
           JOIN persons p ON p.id = export_person.id
           JOIN organization_settings settings ON settings.organization_id = p.organization_id
           JOIN lifecycle_rule_sets lrs ON lrs.id = settings.current_lifecycle_rule_set_id
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
              WHERE participation.person_id IN ${clusterSql}
                AND participation.archived_at IS NULL
                ${eventParameter ? `AND participation.event_id = ${eventParameter}` : ''}
           ) event_data ON true
           LEFT JOIN LATERAL (
             SELECT string_agg(DISTINCT artifact.title, ' | ' ORDER BY artifact.title) AS titles
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
              row.activation_state,
              row.activity_status,
              row.last_artifact_at?.toISOString() ?? '',
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
}

function csvRow(values: readonly unknown[]): string {
  return values.map((value) => csvCell(value == null ? '' : String(value))).join(';');
}

function csvCell(value: string): string {
  const safe = /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
