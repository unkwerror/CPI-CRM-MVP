import { Permissions, hasPermission } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';

const LIVE_ACTIVITY_SQL = `CASE
  WHEN p.activation_state <> 'ACTIVATED' OR p.last_artifact_at IS NULL THEN 'UNKNOWN'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.active_window_hours) THEN 'ACTIVE'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.inactive_after_hours) THEN 'MEDIUM'
  ELSE 'INACTIVE'
END`;

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
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
         SELECT e.id, e.name, e.normalized_name, e.status, e.starts_at, e.ends_at,
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
        SELECT page.id, page.name, page.status, page.starts_at, page.ends_at,
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
            participantCount: Number(row.participant_count),
            artifactCount: Number(row.artifact_count),
          })),
        total: Number(result.rows[0]?.total_count ?? 0),
      };
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
        `SELECT id, name, status, starts_at, ends_at
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
              ORDER BY contact.is_primary DESC, contact.created_at, contact.id
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
