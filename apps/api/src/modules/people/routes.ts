import { createHash } from 'node:crypto';

import { CreatePersonBody, PatchPersonBody } from '@cpi-crm/contracts';
import { autoResolveDuplicateCandidatesInTransaction } from '@cpi-crm/db';
import {
  HEAD_QUALITY_BAND_LABELS,
  Permissions,
  computeHeadQuality,
  hasPermission,
  interpretHeadQuality,
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
  normalizeTelegramUsername,
  normalizeUnicode,
} from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { decodeCursor, encodeCursor, transaction } from '../../lib/sql.js';

/**
 * Q_head = 0.35 × средний Q_artifact (90 дней, к 100) + 0.25 × регулярность
 * (доля 30-дневных окон с качественным артефактом) + 0.20 × проектная
 * включённость + 0.20 × коммерческая применимость (связь со сделкой).
 */
function buildHeadQuality(
  row:
    | {
        avg_score: string | null;
        quality_windows: string;
        involved: boolean;
        commercial: boolean;
      }
    | undefined,
) {
  const components = {
    artifactQuality: row?.avg_score === null || row === undefined ? 0 : Number(row.avg_score) * 10,
    regularity: row === undefined ? 0 : (Math.min(3, Number(row.quality_windows)) / 3) * 100,
    projectInvolvement: row?.involved ? 100 : 0,
    commercialApplicability: row?.commercial ? 100 : 0,
  };
  const score = computeHeadQuality(components);
  const band = interpretHeadQuality(score);
  return {
    score: Math.round(score * 10) / 10,
    band,
    bandLabel: HEAD_QUALITY_BAND_LABELS[band],
    components: {
      artifactQuality: Math.round(components.artifactQuality * 10) / 10,
      regularity: Math.round(components.regularity * 10) / 10,
      projectInvolvement: components.projectInvolvement,
      commercialApplicability: components.commercialApplicability,
    },
  };
}

const LIVE_ACTIVITY_SQL = `CASE
  WHEN p.activation_state <> 'ACTIVATED' OR p.last_artifact_at IS NULL THEN 'UNKNOWN'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.active_window_hours) THEN 'ACTIVE'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.inactive_after_hours) THEN 'MEDIUM'
  ELSE 'INACTIVE'
END`;

interface PersonListRow {
  id: string;
  canonical_full_name: string;
  normalized_full_name: string;
  activation_state: 'UNKNOWN_LEGACY' | 'NOT_ACTIVATED' | 'ACTIVATED';
  live_activity_status: 'UNKNOWN' | 'ACTIVE' | 'MEDIUM' | 'INACTIVE';
  last_artifact_at: Date | null;
  organization_name: string | null;
  faculty: string | null;
  primary_contact: string | null;
  owner_name: string | null;
  artifact_count: string;
  latest_score: number | null;
  has_duplicate: boolean;
  total_count: string;
}

export async function registerPeopleRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/people',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Участники'],
        summary: 'Список и поиск участников',
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
          hasDuplicate: Type.Optional(Type.Boolean()),
          awaitingReview: Type.Optional(Type.Boolean()),
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
        }),
      },
    },
    async (request) => {
      const canReadContacts = hasPermission(request.authUser!.roles, Permissions.CONTACTS_READ);
      const query = request.query as {
        q?: string;
        activityStatus?: string;
        activationState?: string;
        hasDuplicate?: boolean;
        awaitingReview?: boolean;
        cursor?: string;
        limit?: number;
      };
      const organization = await getOrganizationContext(app.pool);
      const values: unknown[] = [organization.id];
      const clusterMemberIdsSql = `(SELECT cluster_member.id
                                      FROM persons cluster_member
                                     WHERE cluster_member.id = p.id
                                        OR cluster_member.merged_into_person_id = p.id)`;
      const conditions = [
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
        values.push(raw, normalizedName);
        const rawParam = `$${values.length - 1}`;
        const nameParam = `$${values.length}`;
        let contactsParam: string | undefined;
        if (canReadContacts) {
          values.push(contactCandidates);
          contactsParam = `$${values.length}`;
        }
        conditions.push(`(
          EXISTS (
            SELECT 1 FROM persons cluster_member
             WHERE (cluster_member.id = p.id OR cluster_member.merged_into_person_id = p.id)
               AND (cluster_member.id::text = ${rawParam} OR cluster_member.id::text LIKE ${rawParam} || '%')
          )
          OR p.normalized_full_name = ${nameParam}
          OR p.normalized_full_name LIKE ${nameParam} || '%'
          OR similarity(p.normalized_full_name, ${nameParam}) >= 0.32
          OR EXISTS (
            SELECT 1 FROM person_aliases pa
             WHERE pa.person_id IN ${clusterMemberIdsSql} AND pa.archived_at IS NULL
               AND (pa.normalized_value = ${nameParam} OR similarity(pa.normalized_value, ${nameParam}) >= 0.32)
          )
          ${
            canReadContacts
              ? `OR EXISTS (
            SELECT 1 FROM contact_points cp
             WHERE cp.person_id IN ${clusterMemberIdsSql} AND cp.archived_at IS NULL
               AND cp.normalized_value = ANY(${contactsParam!}::text[])
          )`
              : ''
          }
          OR EXISTS (
            SELECT 1 FROM person_search_documents psd
             WHERE psd.person_id IN ${clusterMemberIdsSql}
               AND ${canReadContacts ? 'psd.search_text' : `(psd.canonical_name || ' ' || psd.internal_ids)`} ILIKE '%' || ${nameParam} || '%'
          )
        )`);
      }

      if (query.activityStatus) {
        values.push(query.activityStatus);
        conditions.push(`${LIVE_ACTIVITY_SQL} = $${values.length}`);
      }
      if (query.activationState) {
        values.push(query.activationState);
        conditions.push(`p.activation_state = $${values.length}`);
      }
      if (query.hasDuplicate) conditions.push('duplicates.has_duplicate = true');
      if (query.awaitingReview)
        conditions.push('latest.score IS NULL AND latest.version_id IS NOT NULL');
      if (query.cursor) {
        let cursor: [string, string];
        try {
          cursor = decodeCursor(query.cursor);
        } catch {
          throw new HttpProblem(400, 'Некорректный курсор страницы');
        }
        values.push(cursor[0], cursor[1]);
        conditions.push(
          `(p.normalized_full_name, p.id) > ($${values.length - 1}, $${values.length}::uuid)`,
        );
      }
      const limit = query.limit ?? 50;
      values.push(limit + 1);

      const result = await app.pool.query<PersonListRow>(
        `SELECT p.id, p.canonical_full_name, p.normalized_full_name, p.activation_state,
                ${LIVE_ACTIVITY_SQL} AS live_activity_status,
                p.last_artifact_at,
                affiliation.organization_name, affiliation.faculty,
                contact.primary_contact, owner.display_name AS owner_name,
                COALESCE(artifact_agg.artifact_count, 0)::text AS artifact_count,
                latest.score AS latest_score,
                COALESCE(duplicates.has_duplicate, false) AS has_duplicate,
                count(*) OVER()::text AS total_count
           FROM persons p
           JOIN organization_settings os ON os.organization_id = p.organization_id
           JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
           LEFT JOIN app_users owner ON owner.id = p.owner_user_id
           LEFT JOIN LATERAL (
             SELECT cp.raw_value AS primary_contact
               FROM contact_points cp
              WHERE cp.person_id IN ${clusterMemberIdsSql} AND cp.archived_at IS NULL
              ORDER BY cp.is_primary DESC, cp.created_at
              LIMIT 1
           ) contact ON true
           LEFT JOIN LATERAL (
             SELECT o.name AS organization_name, af.faculty
               FROM affiliations af
               JOIN organizations o ON o.id = af.organization_id
              WHERE af.person_id IN ${clusterMemberIdsSql} AND af.archived_at IS NULL
              ORDER BY af.is_primary DESC, af.created_at
              LIMIT 1
           ) affiliation ON true
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT av.artifact_id) AS artifact_count
               FROM artifact_version_contributors avc
               JOIN artifact_versions av ON av.id = avc.artifact_version_id
               JOIN artifacts a ON a.id = av.artifact_id
              WHERE avc.person_id IN ${clusterMemberIdsSql}
                AND avc.contribution_role = 'AUTHOR'
                AND av.qualifies_for_activity
                AND av.status = 'SUBMITTED'
                AND a.status <> 'VOIDED'
                AND a.archived_at IS NULL
           ) artifact_agg ON true
           LEFT JOIN LATERAL (
             SELECT av.id AS version_id, ar.score
               FROM artifact_version_contributors avc
               JOIN artifact_versions av ON av.id = avc.artifact_version_id
               JOIN artifacts a ON a.id = av.artifact_id
               LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id
               LEFT JOIN artifact_reviews ar ON ar.id = ars.current_final_review_id
              WHERE avc.person_id IN ${clusterMemberIdsSql}
                AND avc.contribution_role = 'AUTHOR'
                AND av.qualifies_for_activity
                AND av.status = 'SUBMITTED'
                AND a.status <> 'VOIDED'
                AND a.archived_at IS NULL
              ORDER BY av.submitted_at DESC NULLS LAST, av.id
              LIMIT 1
           ) latest ON true
           LEFT JOIN LATERAL (
             SELECT true AS has_duplicate
               FROM duplicate_candidates dc
              WHERE dc.status = 'OPEN'
                AND (dc.person_a_id IN ${clusterMemberIdsSql}
                  OR dc.person_b_id IN ${clusterMemberIdsSql})
              LIMIT 1
           ) duplicates ON true
          WHERE ${conditions.join(' AND ')}
          ORDER BY p.normalized_full_name, p.id
          LIMIT $${values.length}`,
        values,
      );

      const hasNext = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return {
        items: rows.map((item) => mapPersonSummary(item, canReadContacts)),
        nextCursor: hasNext && last ? encodeCursor(last.normalized_full_name, last.id) : null,
        total: Number(rows[0]?.total_count ?? 0),
      };
    },
  );

  app.post(
    '/people',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: { tags: ['Участники'], summary: 'Создать участника', body: CreatePersonBody },
    },
    async (request, reply) => {
      const body = request.body as {
        canonicalFullName: string;
        lifecycleDataState?: 'LEGACY_INCOMPLETE' | 'COMPLETE';
        contacts?: Array<{
          type: 'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX' | 'OTHER';
          value: string;
          isPrimary?: boolean;
        }>;
        organization?: string;
        faculty?: string;
      };
      if (
        body.contacts?.length &&
        !hasPermission(request.authUser!.roles, Permissions.CONTACTS_WRITE)
      ) {
        throw new HttpProblem(
          403,
          'Доступ к контактам запрещён',
          `Требуется разрешение ${Permissions.CONTACTS_WRITE}.`,
        );
      }
      const actor = request.authUser!;
      const organization = await getOrganizationContext(app.pool);
      const name = normalizeUnicode(body.canonicalFullName).replace(/\s+/gu, ' ').trim();
      const normalizedName = normalizeFullName(name);
      if (!normalizedName) throw new HttpProblem(400, 'ФИО не заполнено');

      const result = await transaction(app.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO persons
             (organization_id, canonical_full_name, normalized_full_name, lifecycle_data_state,
              activation_state, activity_status, applied_lifecycle_rule_set_id)
           VALUES ($1, $2, $3, $4::lifecycle_data_state,
                   CASE WHEN $4::text = 'COMPLETE' THEN 'NOT_ACTIVATED'::activation_state ELSE 'UNKNOWN_LEGACY'::activation_state END,
                   'UNKNOWN', $5)
           RETURNING id`,
          [
            organization.id,
            name,
            normalizedName,
            body.lifecycleDataState ?? 'COMPLETE',
            organization.ruleSetId,
          ],
        );
        const personId = inserted.rows[0]!.id;
        await client.query(
          `INSERT INTO person_aliases
             (person_id, raw_value, normalized_value, alias_type, data_origin, is_preferred)
           VALUES ($1, $2, $3, 'SOURCE_VARIANT', 'LIVE', true)`,
          [personId, name, normalizedName],
        );

        for (const contact of body.contacts ?? []) {
          const normalized = normalizeContact(contact.type, contact.value);
          await client.query(
            `INSERT INTO contact_points
               (person_id, type, raw_value, normalized_value, is_primary, data_origin)
             VALUES ($1, $2, $3, $4, $5, 'LIVE')`,
            [personId, contact.type, contact.value, normalized, contact.isPrimary ?? false],
          );
          await queueContactDuplicates(client, personId, contact.type, normalized);
        }

        if (body.organization?.trim()) {
          const affiliationOrganizationId = await findOrCreateOrganization(
            client,
            body.organization,
          );
          await client.query(
            `INSERT INTO affiliations
               (person_id, organization_id, faculty, is_primary, data_origin)
             VALUES ($1, $2, $3, true, 'LIVE')`,
            [personId, affiliationOrganizationId, body.faculty?.trim() || null],
          );
        }

        await client.query(
          `INSERT INTO person_search_documents
             (person_id, internal_ids, canonical_name, search_text)
           VALUES ($1::uuid, $1::uuid::text, $2, $2 || ' ' || $1::uuid::text)`,
          [personId, normalizedName],
        );
        const auditId = await writeAudit(client, {
          actor,
          requestId: request.id,
          action: 'person.created',
          entityType: 'person',
          entityId: personId,
          after: {
            canonicalFullName: name,
            lifecycleDataState: body.lifecycleDataState ?? 'COMPLETE',
          },
        });
        await client.query(
          `INSERT INTO field_observations
             (entity_type, entity_id, field_name, raw_value, normalized_value, audit_log_id,
              observed_by_user_id, is_canonical)
           VALUES ('person', $1, 'canonical_full_name', to_jsonb($2::text), to_jsonb($3::text), $4, $5, true)`,
          [personId, name, normalizedName, auditId, actor.userId],
        );
        await autoResolveDuplicateCandidatesInTransaction(client, {
          organizationId: organization.id,
          actorUserId: actor.userId,
          actorSubject: actor.sub,
          requestId: `${request.id}:auto-dedupe`,
          newlyCreatedPersonIds: [personId],
        });
        const canonical = await client.query<{ id: string }>(
          'SELECT COALESCE(merged_into_person_id, id) AS id FROM persons WHERE id = $1',
          [personId],
        );
        return { id: canonical.rows[0]?.id ?? personId };
      });
      return reply.code(201).send(result);
    },
  );

  app.get(
    '/people/:id',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Участники'],
        summary: 'Развёрнутая карточка участника',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const requestedId = (request.params as { id: string }).id;
      const canonical = await resolveCanonicalId(app, requestedId);
      const detailResult = await app.pool.query<
        PersonListRow & {
          version: number;
          lifecycle_data_state: 'LEGACY_INCOMPLETE' | 'COMPLETE';
          activated_at: Date | null;
          next_status_transition_at: Date | null;
          notes: string | null;
        }
      >(
        `SELECT p.id, p.canonical_full_name, p.normalized_full_name, p.activation_state,
                ${LIVE_ACTIVITY_SQL} AS live_activity_status, p.last_artifact_at, p.notes,
                p.lifecycle_data_state, p.activated_at, p.next_status_transition_at, p.version,
                affiliation.organization_name, affiliation.faculty,
                contact.primary_contact, owner.display_name AS owner_name,
                COALESCE(artifact_agg.artifact_count, 0)::text AS artifact_count,
                latest.score AS latest_score,
                COALESCE(duplicates.has_duplicate, false) AS has_duplicate,
                '1'::text AS total_count
           FROM persons p
           JOIN organization_settings os ON os.organization_id = p.organization_id
           JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
           LEFT JOIN app_users owner ON owner.id = p.owner_user_id
           LEFT JOIN LATERAL (SELECT cp.raw_value AS primary_contact FROM contact_points cp WHERE cp.person_id IN (SELECT id FROM persons WHERE id = p.id OR merged_into_person_id = p.id) AND cp.archived_at IS NULL ORDER BY cp.is_primary DESC, cp.created_at LIMIT 1) contact ON true
           LEFT JOIN LATERAL (SELECT o.name AS organization_name, af.faculty FROM affiliations af JOIN organizations o ON o.id = af.organization_id WHERE af.person_id IN (SELECT id FROM persons WHERE id = p.id OR merged_into_person_id = p.id) AND af.archived_at IS NULL ORDER BY af.is_primary DESC, af.created_at LIMIT 1) affiliation ON true
           LEFT JOIN LATERAL (SELECT count(DISTINCT av.artifact_id) AS artifact_count FROM artifact_version_contributors avc JOIN artifact_versions av ON av.id = avc.artifact_version_id JOIN artifacts a ON a.id = av.artifact_id WHERE avc.person_id IN (SELECT id FROM persons WHERE id = p.id OR merged_into_person_id = p.id) AND avc.contribution_role = 'AUTHOR' AND av.qualifies_for_activity AND av.status = 'SUBMITTED' AND a.status <> 'VOIDED' AND a.archived_at IS NULL) artifact_agg ON true
           LEFT JOIN LATERAL (SELECT ar.score FROM artifact_version_contributors avc JOIN artifact_versions av ON av.id = avc.artifact_version_id JOIN artifacts a ON a.id = av.artifact_id LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id LEFT JOIN artifact_reviews ar ON ar.id = ars.current_final_review_id WHERE avc.person_id IN (SELECT id FROM persons WHERE id = p.id OR merged_into_person_id = p.id) AND avc.contribution_role = 'AUTHOR' AND av.qualifies_for_activity AND av.status = 'SUBMITTED' AND a.status <> 'VOIDED' AND a.archived_at IS NULL ORDER BY av.submitted_at DESC NULLS LAST, av.id LIMIT 1) latest ON true
           LEFT JOIN LATERAL (SELECT true AS has_duplicate FROM duplicate_candidates dc WHERE dc.status = 'OPEN' AND (dc.person_a_id = p.id OR dc.person_b_id = p.id) LIMIT 1) duplicates ON true
          WHERE p.id = $1 AND p.archived_at IS NULL`,
        [canonical],
      );
      const row = detailResult.rows[0];
      if (!row) throw new HttpProblem(404, 'Участник не найден');
      const canReadContacts = hasPermission(request.authUser!.roles, Permissions.CONTACTS_READ);
      const canReadRaw = hasPermission(request.authUser!.roles, Permissions.IMPORTS_READ_RAW);
      const clusterSql = `(SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1)`;
      const [
        contacts,
        aliases,
        affiliations,
        artifacts,
        tasks,
        sources,
        tags,
        participations,
        headQualityRows,
      ] = await Promise.all([
          app.pool.query(
            `SELECT id, type, raw_value, is_primary FROM contact_points WHERE person_id IN ${clusterSql} AND archived_at IS NULL ORDER BY is_primary DESC, created_at`,
            [canonical],
          ),
          app.pool.query(
            `SELECT id, raw_value FROM person_aliases WHERE person_id IN ${clusterSql} AND archived_at IS NULL ORDER BY is_preferred DESC, created_at`,
            [canonical],
          ),
          app.pool.query(
            `SELECT af.id, o.name AS organization, af.faculty, af.role_title AS role FROM affiliations af JOIN organizations o ON o.id = af.organization_id WHERE af.person_id IN ${clusterSql} AND af.archived_at IS NULL ORDER BY af.is_primary DESC`,
            [canonical],
          ),
          app.pool.query(
            `SELECT a.id, a.title, a.event_id, at.name AS type_name, a.status, av.id AS version_id, av.version_number, av.status AS version_status, av.submitted_at, ar.score, COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', author.id, 'name', author.canonical_full_name)) FILTER (WHERE author.id IS NOT NULL AND avc.contribution_role = 'AUTHOR'), '[]') AS authors FROM artifacts a JOIN artifact_types at ON at.id = a.type_id LEFT JOIN LATERAL (SELECT v.* FROM artifact_versions v WHERE v.artifact_id = a.id AND v.status <> 'VOIDED' ORDER BY v.version_number DESC LIMIT 1) av ON true LEFT JOIN artifact_version_contributors avc ON avc.artifact_version_id = av.id LEFT JOIN persons contributor ON contributor.id = avc.person_id LEFT JOIN persons author ON author.id = COALESCE(contributor.merged_into_person_id, contributor.id) LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id LEFT JOIN artifact_reviews ar ON ar.id = ars.current_final_review_id WHERE a.archived_at IS NULL AND a.status <> 'VOIDED' AND EXISTS (SELECT 1 FROM artifact_version_contributors own JOIN artifact_versions ownv ON ownv.id = own.artifact_version_id WHERE ownv.artifact_id = a.id AND ownv.status <> 'VOIDED' AND own.person_id IN ${clusterSql}) GROUP BY a.id, at.name, av.id, av.version_number, av.status, av.submitted_at, ar.score ORDER BY av.submitted_at DESC NULLS LAST`,
            [canonical],
          ),
          app.pool.query(
            `SELECT id, title, status, due_at FROM tasks WHERE person_id IN ${clusterSql} AND archived_at IS NULL ORDER BY status = 'OPEN' DESC, due_at NULLS LAST`,
            [canonical],
          ),
          app.pool.query(
            `SELECT sr.id, ib.original_filename AS file_name, sr.sheet_name, sr.row_number,
                    string_agg(DISTINCT sel.relation, ', ' ORDER BY sel.relation) AS relation,
                    ${canReadRaw ? 'sr.raw_json' : 'NULL::jsonb'} AS raw_json
               FROM source_entity_links sel
               JOIN source_records sr ON sr.id = sel.source_record_id
               JOIN import_batches ib ON ib.id = sr.batch_id
              WHERE upper(sel.entity_type) = 'PERSON'
                AND sel.entity_id IN ${clusterSql} AND sel.detached_at IS NULL
              GROUP BY sr.id, ib.original_filename
              ORDER BY sr.sheet_name, sr.row_number`,
            [canonical],
          ),
          app.pool.query(
            `SELECT t.name FROM person_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.person_id IN ${clusterSql} AND t.archived_at IS NULL ORDER BY t.name`,
            [canonical],
          ),
          app.pool.query(
            `SELECT ep.id AS participation_id, ep.registered_at, ep.decision, ep.decision_at,
                  ep.attendance, ep.attended_at, ep.data_origin,
                  e.id AS event_id, e.name AS event_name, e.status AS event_status,
                  e.starts_at, e.ends_at,
                  COALESCE(provenance.sources, '[]'::jsonb) AS sources,
                  COALESCE(provenance.comments, '[]'::jsonb) AS comments
             FROM event_participations ep
             JOIN events e ON e.id = ep.event_id
             LEFT JOIN LATERAL (
               SELECT
                 COALESCE(
                   jsonb_agg(DISTINCT jsonb_build_object(
                     'id', sel.id,
                     'fileName', ib.original_filename,
                     'sheetName', sr.sheet_name,
                     'rowNumber', sr.row_number,
                     'relation', sel.relation
                   )) FILTER (WHERE sel.id IS NOT NULL),
                   '[]'::jsonb
                 ) AS sources,
                 COALESCE(
                   jsonb_agg(DISTINCT source_comment.value)
                     FILTER (WHERE source_comment.value IS NOT NULL),
                   '[]'::jsonb
                 ) AS comments
                 FROM source_entity_links sel
                 JOIN source_records sr ON sr.id = sel.source_record_id
                 JOIN import_batches ib ON ib.id = sr.batch_id
                 LEFT JOIN LATERAL (
                   SELECT NULLIF(
                     btrim(COALESCE(cell ->> 'displayText', cell ->> 'value')),
                     ''
                   ) AS value
                     FROM jsonb_array_elements(COALESCE(sr.raw_json -> 'cells', '[]'::jsonb)) cell
                    WHERE lower(btrim(cell ->> 'header')) = 'комментарий'
                 ) source_comment ON true
                WHERE upper(sel.entity_type) = 'EVENT_PARTICIPATION'
                  AND sel.entity_id = ep.id
                  AND sel.detached_at IS NULL
             ) provenance ON true
            WHERE ep.person_id IN ${clusterSql}
              AND ep.archived_at IS NULL
              AND e.archived_at IS NULL
            ORDER BY COALESCE(e.starts_at, ep.attended_at, ep.registered_at, e.created_at) DESC,
                     e.name, ep.id`,
            [canonical],
          ),
          // Q_head: компоненты индекса качества головы за последние 90 дней.
          app.pool.query<{
            avg_score: string | null;
            quality_windows: string;
            involved: boolean;
            commercial: boolean;
          }>(
            `WITH reviewed AS (
               SELECT DISTINCT ar.id, ar.score, ar.criteria, ar.decision, av.submitted_at
                 FROM artifact_version_contributors avc
                 JOIN artifact_versions av ON av.id = avc.artifact_version_id
                 JOIN artifact_review_selections sel ON sel.artifact_version_id = av.id
                 JOIN artifact_reviews ar ON ar.id = sel.current_final_review_id
                WHERE avc.person_id IN ${clusterSql}
                  AND av.qualifies_for_activity
                  AND av.submitted_at IS NOT NULL
                  AND av.submitted_at > now() - interval '90 days'
                  AND ar.voided_at IS NULL AND ar.status = 'FINAL' AND ar.score IS NOT NULL
             ),
             quality AS (
               SELECT submitted_at FROM reviewed
                WHERE decision = 'ACCEPTED' AND score >= 7
                  AND (criteria IS NULL
                       OR ((criteria->>'relevance')::int > 0 AND (criteria->>'verifiability')::int > 0))
             )
             SELECT
               (SELECT avg(score)::text FROM reviewed) AS avg_score,
               (SELECT count(DISTINCT floor(extract(epoch FROM (now() - submitted_at)) / 2592000))
                  FROM quality)::text AS quality_windows,
               EXISTS (SELECT 1 FROM team_memberships tm
                        WHERE tm.person_id IN ${clusterSql}
                          AND tm.archived_at IS NULL AND tm.valid_to IS NULL) AS involved,
               EXISTS (SELECT 1 FROM deals d
                        WHERE d.person_id IN ${clusterSql} AND d.archived_at IS NULL) AS commercial`,
            [canonical],
          ),
        ]);
      const mappedArtifacts = artifacts.rows.map((item) => ({
        id: item.id,
        title: item.title,
        typeName: item.type_name,
        eventId: item.event_id,
        status: item.status,
        latestVersionId: item.version_id,
        latestVersionNumber: item.version_number,
        latestVersionStatus: item.version_status,
        submittedAt: item.submitted_at?.toISOString() ?? null,
        score: item.score,
        authors: item.authors,
      }));
      const eventMap = new Map<
        string,
        {
          id: string;
          name: string;
          status: string;
          startsAt: string | null;
          endsAt: string | null;
          participations: Array<Record<string, unknown>>;
          artifacts: typeof mappedArtifacts;
        }
      >();
      for (const item of participations.rows) {
        let event = eventMap.get(item.event_id);
        if (!event) {
          event = {
            id: item.event_id,
            name: item.event_name,
            status: item.event_status,
            startsAt: item.starts_at?.toISOString() ?? null,
            endsAt: item.ends_at?.toISOString() ?? null,
            participations: [],
            artifacts: mappedArtifacts.filter((artifact) => artifact.eventId === item.event_id),
          };
          eventMap.set(item.event_id, event);
        }
        event.participations.push({
          id: item.participation_id,
          role: null,
          registeredAt: item.registered_at?.toISOString() ?? null,
          decision: item.decision,
          decisionAt: item.decision_at?.toISOString() ?? null,
          attendance: item.attendance,
          attendedAt: item.attended_at?.toISOString() ?? null,
          dataOrigin: item.data_origin,
          comments: item.comments,
          sources: item.sources,
        });
      }
      return {
        ...mapPersonSummary(row, canReadContacts),
        version: row.version,
        lifecycleDataState: row.lifecycle_data_state,
        activatedAt: row.activated_at?.toISOString() ?? null,
        nextStatusTransitionAt: row.next_status_transition_at?.toISOString() ?? null,
        contacts: canReadContacts
          ? contacts.rows.map((item) => ({
              id: item.id,
              type: item.type,
              rawValue: item.raw_value,
              isPrimary: item.is_primary,
            }))
          : [],
        aliases: aliases.rows.map((item) => ({ id: item.id, rawValue: item.raw_value })),
        affiliations: affiliations.rows,
        artifacts: mappedArtifacts,
        events: [...eventMap.values()],
        tasks: tasks.rows.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          dueAt: item.due_at?.toISOString() ?? null,
        })),
        sources: sources.rows.map((item) => ({
          id: item.id,
          fileName: item.file_name,
          sheetName: item.sheet_name,
          rowNumber: item.row_number,
          relation: item.relation,
          fields: sourceFields(item.raw_json),
        })),
        tags: tags.rows.map((item) => item.name),
        notes: row.notes ?? null,
        headQuality: buildHeadQuality(headQualityRows.rows[0]),
      };
    },
  );

  app.patch(
    '/people/:id',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Участники'],
        summary: 'Обновить карточку участника',
        body: PatchPersonBody,
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const id = await resolveCanonicalId(app, (request.params as { id: string }).id);
      const body = request.body as {
        version: number;
        canonicalFullName?: string;
        ownerUserId?: string | null;
        organization?: string | null;
        faculty?: string | null;
        roleTitle?: string | null;
        notes?: string | null;
        contacts?: Array<{
          id?: string;
          type: 'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX' | 'OTHER';
          value: string;
          isPrimary?: boolean;
          archive?: boolean;
        }>;
      };
      const hasContacts = body.contacts !== undefined;
      if (
        hasContacts &&
        !hasPermission(request.authUser!.roles, Permissions.CONTACTS_WRITE)
      ) {
        throw new HttpProblem(
          403,
          'Доступ к контактам запрещён',
          `Требуется разрешение ${Permissions.CONTACTS_WRITE}.`,
        );
      }
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const current = await client.query<{
          canonical_full_name: string;
          owner_user_id: string | null;
          version: number;
        }>('SELECT canonical_full_name, owner_user_id, version FROM persons WHERE id = $1 FOR UPDATE', [
          id,
        ]);
        if (!current.rows[0]) throw new HttpProblem(404, 'Участник не найден');
        if (current.rows[0].version !== body.version)
          throw new HttpProblem(
            409,
            'Карточка уже изменена',
            'Обновите страницу перед повторным сохранением.',
          );

        const name =
          body.canonicalFullName !== undefined
            ? normalizeUnicode(body.canonicalFullName).replace(/\s+/gu, ' ').trim()
            : current.rows[0].canonical_full_name;
        if (!name || [...name].length < 2) throw new HttpProblem(400, 'ФИО не заполнено');
        const normalized = normalizeFullName(name);
        if (!normalized) throw new HttpProblem(400, 'ФИО не заполнено');

        const nextOwnerUserId =
          body.ownerUserId !== undefined ? body.ownerUserId : current.rows[0].owner_user_id;
        if (body.ownerUserId) {
          const owner = await client.query(
            `SELECT 1 FROM app_users WHERE id = $1 AND status = 'ACTIVE'`,
            [body.ownerUserId],
          );
          if (!owner.rows[0]) throw new HttpProblem(400, 'Ответственный пользователь не найден');
        }

        const updated = await client.query<{ id: string; version: number }>(
          `UPDATE persons
              SET canonical_full_name = $2,
                  normalized_full_name = $3,
                  owner_user_id = $4,
                  notes = CASE WHEN $5 THEN $6 ELSE notes END,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1
            RETURNING id, version`,
          [id, name, normalized, nextOwnerUserId, body.notes !== undefined, body.notes ?? null],
        );

        if (body.canonicalFullName !== undefined) {
          await client.query(
            `UPDATE person_search_documents
                SET canonical_name = $2,
                    search_text = $2 || ' ' || internal_ids,
                    rebuilt_at = now(),
                    updated_at = now()
              WHERE person_id = $1`,
            [id, normalized],
          );
          await client.query(
            `UPDATE person_aliases
                SET raw_value = $2,
                    normalized_value = $3,
                    updated_at = now(),
                    version = version + 1
              WHERE person_id = $1
                AND is_preferred = true
                AND archived_at IS NULL`,
            [id, name, normalized],
          );
        }

        const affiliationTouched =
          body.organization !== undefined ||
          body.faculty !== undefined ||
          body.roleTitle !== undefined;
        let affiliationAfter: {
          organization: string | null;
          faculty: string | null;
          roleTitle: string | null;
        } | null = null;
        if (affiliationTouched) {
          affiliationAfter = await upsertPrimaryAffiliation(client, {
            personId: id,
            ...(body.organization !== undefined ? { organization: body.organization } : {}),
            ...(body.faculty !== undefined ? { faculty: body.faculty } : {}),
            ...(body.roleTitle !== undefined ? { roleTitle: body.roleTitle } : {}),
          });
        }

        const contactsAfter: Array<{
          id: string;
          type: string;
          rawValue: string;
          isPrimary: boolean;
        }> = [];
        if (hasContacts) {
          const existing = await client.query<{
            id: string;
            type: string;
            raw_value: string;
            is_primary: boolean;
          }>(
            `SELECT id, type, raw_value, is_primary
               FROM contact_points
              WHERE person_id = $1 AND archived_at IS NULL
              FOR UPDATE`,
            [id],
          );
          const existingById = new Map(existing.rows.map((row) => [row.id, row]));
          const keptIds = new Set<string>();

          for (const contact of body.contacts ?? []) {
            if (contact.archive) {
              if (!contact.id || !existingById.has(contact.id)) {
                throw new HttpProblem(400, 'Контакт для удаления не найден');
              }
              await client.query(
                `UPDATE contact_points
                    SET archived_at = now(), is_primary = false, updated_at = now(), version = version + 1
                  WHERE id = $1 AND person_id = $2 AND archived_at IS NULL`,
                [contact.id, id],
              );
              continue;
            }

            const rawValue = normalizeUnicode(contact.value).replace(/\s+/gu, ' ').trim();
            if (!rawValue) throw new HttpProblem(400, 'Контакт не заполнен');
            const normalizedContact = normalizeContact(contact.type, rawValue);
            const isPrimary = contact.isPrimary ?? false;

            if (contact.id) {
              if (!existingById.has(contact.id)) {
                throw new HttpProblem(400, 'Контакт для обновления не найден');
              }
              if (isPrimary) {
                await client.query(
                  `UPDATE contact_points
                      SET is_primary = false, updated_at = now()
                    WHERE person_id = $1 AND type = $2 AND archived_at IS NULL AND id <> $3`,
                  [id, contact.type, contact.id],
                );
              }
              const row = await client.query<{
                id: string;
                type: string;
                raw_value: string;
                is_primary: boolean;
              }>(
                `UPDATE contact_points
                    SET type = $3,
                        raw_value = $4,
                        normalized_value = $5,
                        is_primary = $6,
                        updated_at = now(),
                        version = version + 1
                  WHERE id = $1 AND person_id = $2 AND archived_at IS NULL
                  RETURNING id, type, raw_value, is_primary`,
                [contact.id, id, contact.type, rawValue, normalizedContact, isPrimary],
              );
              if (!row.rows[0]) throw new HttpProblem(400, 'Контакт для обновления не найден');
              keptIds.add(row.rows[0].id);
              contactsAfter.push({
                id: row.rows[0].id,
                type: row.rows[0].type,
                rawValue: row.rows[0].raw_value,
                isPrimary: row.rows[0].is_primary,
              });
              await queueContactDuplicates(client, id, contact.type, normalizedContact);
            } else {
              if (isPrimary) {
                await client.query(
                  `UPDATE contact_points
                      SET is_primary = false, updated_at = now()
                    WHERE person_id = $1 AND type = $2 AND archived_at IS NULL`,
                  [id, contact.type],
                );
              }
              const row = await client.query<{
                id: string;
                type: string;
                raw_value: string;
                is_primary: boolean;
              }>(
                `INSERT INTO contact_points
                   (person_id, type, raw_value, normalized_value, is_primary, data_origin)
                 VALUES ($1, $2, $3, $4, $5, 'LIVE')
                 RETURNING id, type, raw_value, is_primary`,
                [id, contact.type, rawValue, normalizedContact, isPrimary],
              );
              keptIds.add(row.rows[0]!.id);
              contactsAfter.push({
                id: row.rows[0]!.id,
                type: row.rows[0]!.type,
                rawValue: row.rows[0]!.raw_value,
                isPrimary: row.rows[0]!.is_primary,
              });
              await queueContactDuplicates(client, id, contact.type, normalizedContact);
            }
          }

          // Contacts omitted from the payload are archived so the form can fully replace the list.
          for (const existingContact of existing.rows) {
            if (keptIds.has(existingContact.id)) continue;
            await client.query(
              `UPDATE contact_points
                  SET archived_at = now(), is_primary = false, updated_at = now(), version = version + 1
                WHERE id = $1 AND person_id = $2 AND archived_at IS NULL`,
              [existingContact.id, id],
            );
          }

          await rebuildPersonSearchDocument(client, id, normalized);
          await autoResolveDuplicateCandidatesInTransaction(client, {
            organizationId: organization.id,
            actorUserId: request.authUser!.userId,
            actorSubject: request.authUser!.sub,
            requestId: `${request.id}:auto-dedupe`,
            newlyCreatedPersonIds: [id],
          });
        } else if (body.canonicalFullName !== undefined) {
          await rebuildPersonSearchDocument(client, id, normalized);
        }

        const after = {
          canonicalFullName: name,
          ownerUserId: nextOwnerUserId,
          ...(affiliationAfter ? { affiliation: affiliationAfter } : {}),
          ...(hasContacts ? { contacts: contactsAfter } : {}),
        };
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'person.updated',
          entityType: 'person',
          entityId: id,
          before: current.rows[0],
          after,
        });
        return {
          id: updated.rows[0]!.id,
          version: updated.rows[0]!.version,
        };
      });
    },
  );

  app.post(
    '/people/:id/contacts',
    {
      preHandler: app.requirePermission(Permissions.CONTACTS_WRITE),
      schema: {
        tags: ['Контакты'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          type: Type.String(),
          value: Type.String({ minLength: 1 }),
          isPrimary: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const id = await resolveCanonicalId(app, (request.params as { id: string }).id);
      const body = request.body as {
        type: 'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX' | 'OTHER';
        value: string;
        isPrimary?: boolean;
      };
      const normalized = normalizeContact(body.type, body.value);
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        if (body.isPrimary)
          await client.query(
            `UPDATE contact_points SET is_primary = false, updated_at = now() WHERE person_id = $1 AND type = $2 AND archived_at IS NULL`,
            [id, body.type],
          );
        const result = await client.query(
          `INSERT INTO contact_points (person_id, type, raw_value, normalized_value, is_primary, data_origin) VALUES ($1, $2, $3, $4, $5, 'LIVE') RETURNING id`,
          [id, body.type, body.value, normalized, body.isPrimary ?? false],
        );
        await queueContactDuplicates(client, id, body.type, normalized);
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'contact.created',
          entityType: 'contact_point',
          entityId: result.rows[0].id,
          after: { type: body.type, isPrimary: body.isPrimary ?? false },
        });
        await autoResolveDuplicateCandidatesInTransaction(client, {
          organizationId: organization.id,
          actorUserId: request.authUser!.userId,
          actorSubject: request.authUser!.sub,
          requestId: `${request.id}:auto-dedupe`,
          newlyCreatedPersonIds: [id],
        });
        return result.rows[0];
      });
      return reply.code(201).send(created);
    },
  );
}

function sourceFields(rawJson: unknown): Array<{ header: string; address: string; value: string }> {
  if (!rawJson || typeof rawJson !== 'object' || !('cells' in rawJson)) return [];
  const cells = (rawJson as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return [];
  const result: Array<{ header: string; address: string; value: string }> = [];
  for (const rawCell of cells) {
    if (!rawCell || typeof rawCell !== 'object') continue;
    const cell = rawCell as Record<string, unknown>;
    const header =
      typeof cell.header === 'string' && cell.header.trim() ? cell.header : 'Без заголовка';
    const address = typeof cell.address === 'string' ? cell.address : '';
    if (cell.redacted === true) {
      result.push({ header, address, value: 'Значение скрыто политикой безопасности' });
      continue;
    }
    const displayText = typeof cell.displayText === 'string' ? cell.displayText.trim() : '';
    let value = displayText;
    if (!value && cell.value != null) {
      if (
        typeof cell.value === 'string' ||
        typeof cell.value === 'number' ||
        typeof cell.value === 'boolean'
      ) {
        value = String(cell.value);
      } else if (typeof cell.value === 'object' && !Array.isArray(cell.value)) {
        const objectValue = cell.value as Record<string, unknown>;
        const candidate = objectValue.url ?? objectValue.expression ?? objectValue.text;
        value = typeof candidate === 'string' ? candidate : JSON.stringify(cell.value);
      }
    }
    if (value) result.push({ header, address, value });
  }
  return result;
}

function mapPersonSummary(row: PersonListRow, includeContact = true) {
  return {
    id: row.id,
    canonicalFullName: row.canonical_full_name,
    organization: row.organization_name,
    faculty: row.faculty,
    primaryContact: includeContact ? row.primary_contact : null,
    ownerName: row.owner_name,
    activationState: row.activation_state,
    activityStatus: row.live_activity_status,
    lastArtifactAt: row.last_artifact_at?.toISOString() ?? null,
    countableArtifactCount: Number(row.artifact_count),
    latestArtifactScore: row.latest_score,
    hasDuplicateCandidate: row.has_duplicate,
  };
}

function normalizeContact(type: string, rawValue: string): string {
  const raw = normalizeUnicode(rawValue).trim();
  if (!raw) throw new HttpProblem(400, 'Контакт не заполнен');
  if (type === 'EMAIL') {
    const email = normalizeEmail(raw);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new HttpProblem(400, 'Некорректный email');
    return email;
  }
  if (type === 'PHONE') {
    const phone = normalizePhone(raw);
    if (!phone) throw new HttpProblem(400, 'Некорректный телефон');
    return phone.e164;
  }
  if (type === 'TELEGRAM') {
    const username = normalizeTelegramUsername(raw);
    if (!username) throw new HttpProblem(400, 'Некорректный Telegram username');
    return username;
  }
  return normalizeFullName(raw);
}

async function findOrCreateOrganization(
  client: import('pg').PoolClient,
  rawName: string,
): Promise<string> {
  const name = normalizeUnicode(rawName).replace(/\s+/gu, ' ').trim();
  const normalized = normalizeFullName(name);
  if (!normalized) throw new HttpProblem(400, 'Название организации не заполнено');
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM organizations WHERE normalized_name = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1',
    [normalized],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    'INSERT INTO organizations (name, normalized_name, kind) VALUES ($1, $2, $3) RETURNING id',
    [name, normalized, 'AFFILIATION'],
  );
  return inserted.rows[0]!.id;
}

async function upsertPrimaryAffiliation(
  client: import('pg').PoolClient,
  input: {
    personId: string;
    organization?: string | null;
    faculty?: string | null;
    roleTitle?: string | null;
  },
): Promise<{ organization: string | null; faculty: string | null; roleTitle: string | null }> {
  const current = await client.query<{
    id: string;
    organization_id: string;
    organization_name: string;
    faculty: string | null;
    role_title: string | null;
  }>(
    `SELECT af.id, af.organization_id, o.name AS organization_name, af.faculty, af.role_title
       FROM affiliations af
       JOIN organizations o ON o.id = af.organization_id
      WHERE af.person_id = $1 AND af.archived_at IS NULL
      ORDER BY af.is_primary DESC, af.created_at
      LIMIT 1
      FOR UPDATE OF af`,
    [input.personId],
  );

  const clearOrganization = input.organization === null || input.organization === '';
  if (clearOrganization) {
    if (current.rows[0]) {
      await client.query(
        `UPDATE affiliations
            SET archived_at = now(), is_primary = false, updated_at = now(), version = version + 1
          WHERE person_id = $1 AND archived_at IS NULL`,
        [input.personId],
      );
    }
    return { organization: null, faculty: null, roleTitle: null };
  }

  const nextOrganizationName =
    typeof input.organization === 'string'
      ? normalizeUnicode(input.organization).replace(/\s+/gu, ' ').trim()
      : (current.rows[0]?.organization_name ?? '');
  if (!nextOrganizationName) {
    if (input.faculty !== undefined || input.roleTitle !== undefined) {
      throw new HttpProblem(
        400,
        'Укажите организацию',
        'Факультет и роль можно сохранить только вместе с организацией.',
      );
    }
    return { organization: null, faculty: null, roleTitle: null };
  }

  const organizationId = await findOrCreateOrganization(client, nextOrganizationName);
  const nextFaculty =
    input.faculty !== undefined
      ? input.faculty === null
        ? null
        : normalizeUnicode(input.faculty).replace(/\s+/gu, ' ').trim() || null
      : (current.rows[0]?.faculty ?? null);
  const nextRoleTitle =
    input.roleTitle !== undefined
      ? input.roleTitle === null
        ? null
        : normalizeUnicode(input.roleTitle).replace(/\s+/gu, ' ').trim() || null
      : (current.rows[0]?.role_title ?? null);

  if (current.rows[0]) {
    await client.query(
      `UPDATE affiliations
          SET organization_id = $2,
              faculty = $3,
              role_title = $4,
              is_primary = true,
              updated_at = now(),
              version = version + 1
        WHERE id = $1`,
      [current.rows[0].id, organizationId, nextFaculty, nextRoleTitle],
    );
    await client.query(
      `UPDATE affiliations
          SET is_primary = false, updated_at = now()
        WHERE person_id = $1 AND id <> $2 AND archived_at IS NULL AND is_primary = true`,
      [input.personId, current.rows[0].id],
    );
  } else {
    await client.query(
      `INSERT INTO affiliations
         (person_id, organization_id, faculty, role_title, is_primary, data_origin)
       VALUES ($1, $2, $3, $4, true, 'LIVE')`,
      [input.personId, organizationId, nextFaculty, nextRoleTitle],
    );
  }

  return {
    organization: nextOrganizationName,
    faculty: nextFaculty,
    roleTitle: nextRoleTitle,
  };
}

async function rebuildPersonSearchDocument(
  client: import('pg').PoolClient,
  personId: string,
  canonicalName: string,
): Promise<void> {
  const contacts = await client.query<{ raw_value: string }>(
    `SELECT raw_value
       FROM contact_points
      WHERE person_id IN (
              SELECT member.id FROM persons member
               WHERE member.id = $1 OR member.merged_into_person_id = $1
            )
        AND archived_at IS NULL
      ORDER BY is_primary DESC, created_at, id`,
    [personId],
  );
  const contactText = contacts.rows.map((row) => row.raw_value).join(' ');
  const searchText = [canonicalName, personId, contactText].filter(Boolean).join(' ').trim();
  await client.query(
    `INSERT INTO person_search_documents (person_id, internal_ids, canonical_name, search_text)
     VALUES ($1::uuid, $1::uuid::text, $2, $3)
     ON CONFLICT (person_id) DO UPDATE
       SET canonical_name = EXCLUDED.canonical_name,
           search_text = EXCLUDED.search_text,
           rebuilt_at = now(),
           updated_at = now()`,
    [personId, canonicalName, searchText],
  );
}

async function queueContactDuplicates(
  client: import('pg').PoolClient,
  personId: string,
  type: string,
  normalized: string,
): Promise<void> {
  const matches = await client.query<{ person_id: string }>(
    `SELECT DISTINCT person_id FROM contact_points WHERE type = $1 AND normalized_value = $2 AND person_id <> $3 AND archived_at IS NULL`,
    [type, normalized, personId],
  );
  for (const match of matches.rows) {
    const [personA, personB] = [personId, match.person_id].sort();
    const fingerprint = createHash('sha256')
      .update(`${type}:${normalized}:${personA}:${personB}`)
      .digest('hex');
    await client.query(
      `INSERT INTO duplicate_candidates (person_a_id, person_b_id, confidence_basis_points, evidence_fingerprint, reasons, conflicts) VALUES ($1, $2, $3, $4, $5::jsonb, '[]'::jsonb) ON CONFLICT (person_a_id, person_b_id, evidence_fingerprint) DO NOTHING`,
      [
        personA,
        personB,
        type === 'PHONE' || type === 'EMAIL' ? 9000 : 7800,
        fingerprint,
        JSON.stringify([
          `Совпал ${type === 'PHONE' ? 'телефон' : type === 'EMAIL' ? 'email' : 'контакт'}`,
        ]),
      ],
    );
  }
}

async function resolveCanonicalId(app: FastifyInstance, id: string): Promise<string> {
  const result = await app.pool.query<{ id: string }>(
    `WITH RECURSIVE canonical_chain AS (
       SELECT id, merged_into_person_id, ARRAY[id] AS path
         FROM persons
        WHERE id = $1 AND archived_at IS NULL
       UNION ALL
       SELECT p.id, p.merged_into_person_id, chain.path || p.id
         FROM persons p
         JOIN canonical_chain chain ON p.id = chain.merged_into_person_id
        WHERE p.archived_at IS NULL AND NOT p.id = ANY(chain.path)
     )
     SELECT id FROM canonical_chain
      WHERE merged_into_person_id IS NULL
      ORDER BY cardinality(path) DESC
      LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new HttpProblem(404, 'Участник не найден');
  return row.id;
}
