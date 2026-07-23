import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { beginIdempotentRequest } from '../../lib/idempotency.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import { recalculatePersonLifecycle } from '../artifacts/lifecycle-service.js';
import { revertMergeOperation } from './revert-merge.js';

const LIVE_ACTIVITY_SQL = `CASE
  WHEN p.activation_state <> 'ACTIVATED' OR p.last_artifact_at IS NULL THEN 'UNKNOWN'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.active_window_hours) THEN 'ACTIVE'
  WHEN now() <= p.last_artifact_at + make_interval(hours => lrs.inactive_after_hours) THEN 'MEDIUM'
  ELSE 'INACTIVE'
END`;

export async function registerOperationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/participants',
    { preHandler: app.requirePermission(Permissions.PEOPLE_READ), schema: { tags: ['Дашборд'] } },
    async () => {
      const metrics = await app.pool.query<{
        total_people: string;
        activated_ever: string;
        active: string;
        medium: string;
        inactive: string;
        not_activated: string;
        unknown_legacy: string;
        unreviewed_artifacts: string;
        duplicate_candidates: string;
        overdue_tasks: string;
        recent_versions: string;
        recent_authors: string;
        event_count: string;
      }>(
        `WITH live_people AS (
           SELECT p.id, p.activation_state, ${LIVE_ACTIVITY_SQL} AS live_activity
             FROM persons p
             JOIN organization_settings os ON os.organization_id = p.organization_id
             JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
            WHERE p.archived_at IS NULL AND p.merged_into_person_id IS NULL
         ), artifact_metrics AS (
           SELECT count(*) FILTER (WHERE ars.id IS NULL) AS unreviewed_artifacts,
                  count(*) FILTER (WHERE av.qualifies_for_activity AND av.submitted_at >= now() - interval '3 weeks') AS recent_versions,
                  count(DISTINCT COALESCE(author_person.merged_into_person_id, author_person.id)) FILTER (WHERE av.qualifies_for_activity AND av.submitted_at >= now() - interval '3 weeks' AND avc.contribution_role = 'AUTHOR') AS recent_authors
             FROM artifact_versions av
             LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id
             LEFT JOIN artifact_version_contributors avc ON avc.artifact_version_id = av.id
             LEFT JOIN persons author_person ON author_person.id = avc.person_id
            WHERE av.status = 'SUBMITTED'
         )
         SELECT count(*)::text AS total_people,
                count(*) FILTER (WHERE lp.activation_state = 'ACTIVATED')::text AS activated_ever,
                count(*) FILTER (WHERE lp.live_activity = 'ACTIVE')::text AS active,
                count(*) FILTER (WHERE lp.live_activity = 'MEDIUM')::text AS medium,
                count(*) FILTER (WHERE lp.live_activity = 'INACTIVE')::text AS inactive,
                count(*) FILTER (WHERE lp.activation_state = 'NOT_ACTIVATED')::text AS not_activated,
                count(*) FILTER (WHERE lp.activation_state = 'UNKNOWN_LEGACY')::text AS unknown_legacy,
                (SELECT unreviewed_artifacts::text FROM artifact_metrics),
                (SELECT count(*)::text FROM duplicate_candidates WHERE status = 'OPEN') AS duplicate_candidates,
                (SELECT count(*)::text FROM tasks WHERE status = 'OPEN' AND due_at < now() AND archived_at IS NULL) AS overdue_tasks,
                (SELECT recent_versions::text FROM artifact_metrics),
                (SELECT recent_authors::text FROM artifact_metrics),
                (SELECT count(*)::text FROM events WHERE archived_at IS NULL) AS event_count
           FROM live_people lp`,
      );
      const scores = await app.pool.query<{ score: number; count: string }>(
        `SELECT series.score, count(ar.id)::text AS count
           FROM generate_series(1, 10) AS series(score)
           LEFT JOIN artifact_reviews ar ON ar.score = series.score AND ar.status = 'FINAL' AND ar.voided_at IS NULL
           LEFT JOIN artifact_review_selections ars ON ars.current_final_review_id = ar.id
          GROUP BY series.score ORDER BY series.score`,
      );
      const row = metrics.rows[0];
      return {
        totalPeople: Number(row?.total_people ?? 0),
        activatedEver: Number(row?.activated_ever ?? 0),
        active: Number(row?.active ?? 0),
        medium: Number(row?.medium ?? 0),
        inactive: Number(row?.inactive ?? 0),
        notActivated: Number(row?.not_activated ?? 0),
        unknownLegacy: Number(row?.unknown_legacy ?? 0),
        unreviewedArtifacts: Number(row?.unreviewed_artifacts ?? 0),
        duplicateCandidates: Number(row?.duplicate_candidates ?? 0),
        overdueTasks: Number(row?.overdue_tasks ?? 0),
        recentVersions: Number(row?.recent_versions ?? 0),
        recentAuthors: Number(row?.recent_authors ?? 0),
        eventCount: Number(row?.event_count ?? 0),
        scoreDistribution: scores.rows.map((item) => ({
          score: item.score,
          count: Number(item.count),
        })),
      };
    },
  );

  app.get(
    '/tasks',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Задачи'],
        querystring: Type.Object({ overdue: Type.Optional(Type.Boolean()) }),
      },
    },
    async (request) => {
      const overdue = (request.query as { overdue?: boolean }).overdue ?? false;
      const result = await app.pool.query(
        `SELECT t.id, t.person_id, t.title, t.status, t.due_at,
                p.canonical_full_name AS person_name
           FROM tasks t
           LEFT JOIN persons p ON p.id = t.person_id
          WHERE t.archived_at IS NULL
            AND (NOT $1::boolean OR (t.status = 'OPEN' AND t.due_at < now()))
          ORDER BY t.status = 'OPEN' DESC, t.due_at NULLS LAST, t.created_at DESC
          LIMIT 100`,
        [overdue],
      );
      return {
        items: result.rows.map((item) => ({
          id: item.id,
          personId: item.person_id,
          title: item.title,
          status: item.status,
          dueAt: item.due_at?.toISOString() ?? null,
          personName: item.person_name,
        })),
      };
    },
  );

  app.post(
    '/tasks',
    {
      preHandler: app.requirePermission(Permissions.TASKS_MANAGE),
      schema: {
        tags: ['Задачи'],
        body: Type.Object({
          personId: Type.String({ format: 'uuid' }),
          title: Type.String({ minLength: 1, maxLength: 500 }),
          dueAt: Type.Optional(Type.String({ format: 'date-time' })),
          isNextStep: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        personId: string;
        title: string;
        dueAt?: string;
        isNextStep?: boolean;
      };
      const result = await transaction(app.pool, async (client) => {
        const requested = await client.query<{ id: string }>(
          'SELECT id FROM persons WHERE id = $1 FOR UPDATE',
          [body.personId],
        );
        if (!requested.rows[0]) throw new HttpProblem(404, 'Участник не найден');
        const canonical = await client.query<{ id: string }>(
          'SELECT COALESCE(merged_into_person_id, id) AS id FROM persons WHERE id = $1',
          [body.personId],
        );
        const canonicalPersonId = canonical.rows[0]?.id;
        if (!canonicalPersonId) throw new HttpProblem(404, 'Участник не найден');
        if (canonicalPersonId !== body.personId) {
          await client.query('SELECT id FROM persons WHERE id = $1 FOR UPDATE', [
            canonicalPersonId,
          ]);
        }
        if (body.isNextStep) {
          await client.query(
            `UPDATE tasks
                SET is_next_step = false, updated_at = now()
              WHERE person_id IN (
                      SELECT id FROM persons
                       WHERE id = $1 OR merged_into_person_id = $1
                    )
                AND status = 'OPEN' AND archived_at IS NULL`,
            [canonicalPersonId],
          );
        }
        const task = await client.query<{ id: string }>(
          `INSERT INTO tasks (person_id, title, created_by_user_id, assignee_user_id, due_at, is_next_step) VALUES ($1, $2, $3, $3, $4, $5) RETURNING id`,
          [
            canonicalPersonId,
            body.title.trim(),
            request.authUser!.userId,
            body.dueAt ? new Date(body.dueAt) : null,
            body.isNextStep ?? false,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'task.created',
          entityType: 'task',
          entityId: task.rows[0]!.id,
          after: { personId: canonicalPersonId, title: body.title, dueAt: body.dueAt },
        });
        return task.rows[0];
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    '/tasks/:id/complete',
    {
      preHandler: app.requirePermission(Permissions.TASKS_MANAGE),
      schema: {
        tags: ['Задачи'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ result: Type.Optional(Type.String({ maxLength: 10_000 })) }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { result?: string };
      return transaction(app.pool, async (client) => {
        const completed = await client.query<{ id: string }>(
          `UPDATE tasks
              SET status = 'DONE', completed_at = now(), result = $2,
                  is_next_step = false, version = version + 1, updated_at = now()
            WHERE id = $1 AND status = 'OPEN' AND archived_at IS NULL
            RETURNING id`,
          [id, body.result?.trim() || null],
        );
        if (!completed.rows[0]) throw new HttpProblem(409, 'Задача уже закрыта или не найдена');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'task.completed',
          entityType: 'task',
          entityId: id,
          after: { status: 'DONE', result: body.result },
        });
        return { id, status: 'DONE' };
      });
    },
  );

  app.post(
    '/interactions',
    {
      preHandler: app.requirePermission(Permissions.TASKS_MANAGE),
      schema: {
        tags: ['Взаимодействия'],
        body: Type.Object({
          personId: Type.String({ format: 'uuid' }),
          channel: Type.Union([
            Type.Literal('EMAIL'),
            Type.Literal('PHONE'),
            Type.Literal('TELEGRAM'),
            Type.Literal('MAX'),
            Type.Literal('IN_PERSON'),
            Type.Literal('OTHER'),
          ]),
          direction: Type.Union([
            Type.Literal('INBOUND'),
            Type.Literal('OUTBOUND'),
            Type.Literal('INTERNAL'),
          ]),
          occurredAt: Type.String({ format: 'date-time' }),
          outcome: Type.Optional(Type.String({ maxLength: 2000 })),
          comment: Type.Optional(Type.String({ maxLength: 10_000 })),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        personId: string;
        channel: string;
        direction: string;
        occurredAt: string;
        outcome?: string;
        comment?: string;
      };
      const result = await transaction(app.pool, async (client) => {
        const canonical = await client.query<{ id: string }>(
          'SELECT COALESCE(merged_into_person_id, id) AS id FROM persons WHERE id = $1',
          [body.personId],
        );
        if (!canonical.rows[0]) throw new HttpProblem(404, 'Участник не найден');
        const interaction = await client.query<{ id: string }>(
          `INSERT INTO interactions (person_id, channel, direction, occurred_at, outcome, comment, created_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            canonical.rows[0].id,
            body.channel,
            body.direction,
            new Date(body.occurredAt),
            body.outcome ?? null,
            body.comment ?? null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'interaction.created',
          entityType: 'interaction',
          entityId: interaction.rows[0]!.id,
          after: {
            personId: canonical.rows[0].id,
            channel: body.channel,
            direction: body.direction,
            occurredAt: body.occurredAt,
          },
        });
        return interaction.rows[0];
      });
      return reply.code(201).send(result);
    },
  );

  await registerDuplicateRoutes(app);
}

async function registerDuplicateRoutes(app: FastifyInstance) {
  app.get(
    '/duplicate-candidates',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: { tags: ['Дубли'] },
    },
    async () => {
      const result = await app.pool.query(
        `SELECT dc.id, dc.confidence_basis_points, dc.status, dc.reasons,
                a.id AS a_id, a.canonical_full_name AS a_name, ac.raw_value AS a_contact, ao.name AS a_organization,
                b.id AS b_id, b.canonical_full_name AS b_name, bc.raw_value AS b_contact, bo.name AS b_organization
           FROM duplicate_candidates dc
           JOIN persons a ON a.id = dc.person_a_id
           JOIN persons b ON b.id = dc.person_b_id
           LEFT JOIN LATERAL (SELECT raw_value FROM contact_points WHERE person_id = a.id AND archived_at IS NULL ORDER BY is_primary DESC LIMIT 1) ac ON true
           LEFT JOIN LATERAL (SELECT o.name FROM affiliations af JOIN organizations o ON o.id = af.organization_id WHERE af.person_id = a.id AND af.archived_at IS NULL ORDER BY af.is_primary DESC LIMIT 1) ao ON true
           LEFT JOIN LATERAL (SELECT raw_value FROM contact_points WHERE person_id = b.id AND archived_at IS NULL ORDER BY is_primary DESC LIMIT 1) bc ON true
           LEFT JOIN LATERAL (SELECT o.name FROM affiliations af JOIN organizations o ON o.id = af.organization_id WHERE af.person_id = b.id AND af.archived_at IS NULL ORDER BY af.is_primary DESC LIMIT 1) bo ON true
          WHERE dc.status = 'OPEN'
          ORDER BY dc.confidence_basis_points DESC, dc.detected_at
          LIMIT 100`,
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          confidence: row.confidence_basis_points / 10_000,
          status: row.status,
          reasons: Array.isArray(row.reasons)
            ? row.reasons.map((reason: unknown) => duplicateReasonLabel(reason))
            : [],
          left: compactPerson(row.a_id, row.a_name, row.a_contact, row.a_organization),
          right: compactPerson(row.b_id, row.b_name, row.b_contact, row.b_organization),
        })),
      };
    },
  );

  app.post(
    '/duplicate-candidates/:id/not-duplicate',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Дубли'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 2000 }) }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { reason: string };
      return transaction(app.pool, async (client) => {
        const candidate = await client.query<{
          person_a_id: string;
          person_b_id: string;
          evidence_fingerprint: string;
        }>(
          `UPDATE duplicate_candidates SET status = 'NOT_DUPLICATE', decided_at = now(), decided_by_user_id = $2, decision_reason = $3, updated_at = now() WHERE id = $1 AND status = 'OPEN' RETURNING person_a_id, person_b_id, evidence_fingerprint`,
          [id, request.authUser!.userId, body.reason],
        );
        if (!candidate.rows[0]) throw new HttpProblem(409, 'Кандидат уже обработан');
        const row = candidate.rows[0];
        await client.query(
          `INSERT INTO not_duplicate_pairs (person_a_id, person_b_id, evidence_fingerprint, reason, decided_by_user_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [
            row.person_a_id,
            row.person_b_id,
            row.evidence_fingerprint,
            body.reason,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'duplicate.not_duplicate',
          entityType: 'duplicate_candidate',
          entityId: id,
          reason: body.reason,
        });
        return { id, status: 'NOT_DUPLICATE' };
      });
    },
  );

  app.post(
    '/duplicate-candidates/:id/defer',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Дубли'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 2000 }) }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const reason = (request.body as { reason: string }).reason;
      return transaction(app.pool, async (client) => {
        const dismissed = await client.query(
          `UPDATE duplicate_candidates
              SET status = 'DISMISSED', decided_at = now(), decided_by_user_id = $2,
                  decision_reason = $3, updated_at = now()
            WHERE id = $1 AND status = 'OPEN'
            RETURNING id`,
          [id, request.authUser!.userId, reason],
        );
        if (!dismissed.rows[0]) throw new HttpProblem(409, 'Кандидат уже обработан');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'duplicate.dismissed',
          entityType: 'duplicate_candidate',
          entityId: id,
          reason,
        });
        return { id, status: 'DISMISSED' };
      });
    },
  );

  app.post(
    '/duplicate-candidates/:id/merge',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Дубли'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          masterPersonId: Type.String({ format: 'uuid' }),
          reason: Type.String({ minLength: 3, maxLength: 2000 }),
        }),
      },
    },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { masterPersonId: string; reason: string };
      const idempotency = await beginIdempotentRequest(app.pool, {
        subject: request.authUser!.sub,
        route: `/duplicate-candidates/${id}/merge`,
        key: headerValue(request.headers['idempotency-key']),
        payload: body,
      });
      if (idempotency.replay) return reply.code(idempotency.status).send(idempotency.body);
      try {
        const result = await transaction(app.pool, async (client) => {
          const candidate = await client.query<{ person_a_id: string; person_b_id: string }>(
            'SELECT person_a_id, person_b_id FROM duplicate_candidates WHERE id = $1 AND status = $2 FOR UPDATE',
            [id, 'OPEN'],
          );
          const pair = candidate.rows[0];
          if (!pair) throw new HttpProblem(409, 'Кандидат уже обработан');
          if (body.masterPersonId !== pair.person_a_id && body.masterPersonId !== pair.person_b_id)
            throw new HttpProblem(400, 'Мастер-карточка не входит в выбранную пару');
          const loser =
            body.masterPersonId === pair.person_a_id ? pair.person_b_id : pair.person_a_id;
          const locked = await client.query(
            'SELECT id, merged_into_person_id FROM persons WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
            [[body.masterPersonId, loser]],
          );
          if (locked.rows.length !== 2 || locked.rows.some((row) => row.merged_into_person_id))
            throw new HttpProblem(409, 'Одна из карточек уже входит в другой merge-кластер');
          const loserChildren = await client.query<{ id: string }>(
            `SELECT id FROM persons WHERE merged_into_person_id = $1 ORDER BY id FOR UPDATE`,
            [loser],
          );
          if (loserChildren.rows.length > 0) {
            throw new HttpProblem(
              409,
              'MERGE_DEPENDENCY_CONFLICT',
              'Выбранная дублирующая карточка уже является основной для других карточек. Оставьте её основной или сначала отмените зависимые объединения.',
            );
          }
          await client.query(
            'UPDATE persons SET merged_into_person_id = $2, updated_at = now(), version = version + 1 WHERE id = $1',
            [loser, body.masterPersonId],
          );
          const operation = await client.query<{ id: string }>(
            `INSERT INTO merge_operations (master_person_id, duplicate_candidate_id, cluster_before, cluster_after, reason, operated_by_user_id) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) RETURNING id`,
            [
              body.masterPersonId,
              id,
              JSON.stringify([body.masterPersonId, loser]),
              JSON.stringify([
                { master: body.masterPersonId, members: [body.masterPersonId, loser] },
              ]),
              body.reason,
              request.authUser!.userId,
            ],
          );
          await client.query(
            `INSERT INTO merge_operation_items (merge_operation_id, action, entity_type, entity_id, source_person_id, target_person_id, before, after) VALUES ($1, 'REASSIGNED', 'person', $2, $2, $3, $4::jsonb, $5::jsonb)`,
            [
              operation.rows[0]!.id,
              loser,
              body.masterPersonId,
              JSON.stringify({ mergedIntoPersonId: null }),
              JSON.stringify({ mergedIntoPersonId: body.masterPersonId }),
            ],
          );
          const demotedTasks = await client.query<{ id: string }>(
            `WITH ranked AS (
               SELECT id,
                      row_number() OVER (ORDER BY created_at DESC, id DESC) AS position
                 FROM tasks
                WHERE person_id IN (
                        SELECT id FROM persons
                         WHERE id = $1 OR merged_into_person_id = $1
                      )
                  AND status = 'OPEN' AND is_next_step AND archived_at IS NULL
             )
             UPDATE tasks
                SET is_next_step = false, updated_at = now()
              WHERE id IN (SELECT id FROM ranked WHERE position > 1)
              RETURNING id`,
            [body.masterPersonId],
          );
          for (const task of demotedTasks.rows) {
            await client.query(
              `INSERT INTO merge_operation_items
                 (merge_operation_id, action, entity_type, entity_id, field_name, before, after)
               VALUES ($1, 'CANONICAL_VALUE_SELECTED', 'task', $2, 'is_next_step',
                       $3::jsonb, $4::jsonb)`,
              [
                operation.rows[0]!.id,
                task.id,
                JSON.stringify({ isNextStep: true }),
                JSON.stringify({ isNextStep: false }),
              ],
            );
          }
          await client.query(
            `UPDATE duplicate_candidates SET status = 'MERGED', decided_at = now(), decided_by_user_id = $2, decision_reason = $3, updated_at = now() WHERE id = $1`,
            [id, request.authUser!.userId, body.reason],
          );
          await client.query(
            `UPDATE person_search_documents SET internal_ids = internal_ids || ' ' || $2, search_text = search_text || ' ' || $2, updated_at = now() WHERE person_id = $1`,
            [body.masterPersonId, loser],
          );
          await recalculatePersonLifecycle(client, body.masterPersonId, 'RECONCILIATION');
          await writeAudit(client, {
            actor: request.authUser!,
            requestId: request.id,
            action: 'person.merge',
            entityType: 'merge_operation',
            entityId: operation.rows[0]!.id,
            after: { masterPersonId: body.masterPersonId, mergedPersonId: loser },
            reason: body.reason,
          });
          const response = {
            id: operation.rows[0]!.id,
            masterPersonId: body.masterPersonId,
            mergedPersonId: loser,
          };
          await idempotency.record(200, response, client);
          return response;
        });
        return result;
      } catch (error) {
        await idempotency.release().catch(() => undefined);
        throw error;
      }
    },
  );

  app.post(
    '/merge-operations/:id/revert',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Дубли'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 2000 }) }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const reason = (request.body as { reason: string }).reason;
      return transaction(app.pool, async (client) => {
        const reverted = await revertMergeOperation(client, {
          operationId: id,
          userId: request.authUser!.userId,
          reason,
        });
        if (reverted.alreadyReverted) return { id, status: 'REVERTED' };
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'person.unmerge',
          entityType: 'merge_operation',
          entityId: id,
          after: {
            masterPersonId: reverted.masterPersonId,
            restoredPersonIds: reverted.restoredPersonIds,
          },
          reason,
        });
        return { id, status: 'REVERTED' };
      });
    },
  );
}

function compactPerson(
  id: string,
  name: string,
  contact: string | null,
  organization: string | null,
) {
  return {
    id,
    canonicalFullName: name,
    primaryContact: contact,
    organization,
    activationState: 'UNKNOWN_LEGACY',
    activityStatus: 'UNKNOWN',
    countableArtifactCount: 0,
    latestArtifactScore: null,
    hasDuplicateCandidate: true,
  };
}

function duplicateReasonLabel(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object' && 'code' in reason) {
    const code = String((reason as { code: unknown }).code);
    if (code === 'EXACT_NORMALIZED_FULL_NAME') return 'Совпало нормализованное ФИО';
    if (code === 'EXACT_NORMALIZED_CONTACT:PHONE') return 'Совпал телефон';
    if (code === 'EXACT_NORMALIZED_CONTACT:EMAIL') return 'Совпал email';
    if (code === 'EXACT_NORMALIZED_CONTACT:TELEGRAM') return 'Совпал Telegram';
    return code;
  }
  return 'Обнаружено совпадение';
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
