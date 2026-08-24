import { createHash } from 'node:crypto';

import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { writeAudit } from '../../lib/audit.js';
import { beginIdempotentRequest } from '../../lib/idempotency.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import { recalculatePersonLifecycle } from '../artifacts/lifecycle-service.js';
import { revertMergeOperation } from './revert-merge.js';

const TaskStatusSchema = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('DONE'),
  Type.Literal('CANCELLED'),
]);

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

const FINISHED_TASK_STATUSES = new Set<TaskStatus>(['DONE', 'CANCELLED']);

export async function registerOperationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/participants',
    { preHandler: app.requirePermission(Permissions.PEOPLE_READ), schema: { tags: ['Дашборд'] } },
    async () => {
      const metrics = await app.pool.query<{
        total_people: string;
        artifact_senders: string;
        without_artifacts: string;
        profiles_need_review: string;
        unreviewed_artifacts: string;
        duplicate_candidates: string;
        overdue_tasks: string;
        recent_versions: string;
        recent_authors: string;
        event_count: string;
      }>(
        `WITH live_people AS (
           SELECT p.id, p.profile_needs_review,
                  EXISTS (
                    SELECT 1
                      FROM artifact_version_contributors contributor
                      JOIN artifact_versions version ON version.id = contributor.artifact_version_id
                      JOIN artifacts artifact ON artifact.id = version.artifact_id
                     WHERE contributor.person_id IN (
                             SELECT member.id FROM persons member
                              WHERE member.id = p.id OR member.merged_into_person_id = p.id
                           )
                       AND contributor.contribution_role = 'AUTHOR'
                       AND version.status = 'SUBMITTED'
                       AND artifact.status <> 'VOIDED' AND artifact.archived_at IS NULL
                  ) AS has_artifacts
             FROM persons p
            WHERE p.archived_at IS NULL AND p.merged_into_person_id IS NULL
         ), artifact_metrics AS (
           SELECT count(*) FILTER (WHERE ars.id IS NULL) AS unreviewed_artifacts,
                  count(*) FILTER (WHERE av.submitted_at >= now() - interval '3 weeks') AS recent_versions,
                  count(DISTINCT COALESCE(author_person.merged_into_person_id, author_person.id)) FILTER (WHERE av.submitted_at >= now() - interval '3 weeks' AND avc.contribution_role = 'AUTHOR') AS recent_authors
             FROM artifact_versions av
             LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id
             LEFT JOIN artifact_version_contributors avc ON avc.artifact_version_id = av.id
             LEFT JOIN persons author_person ON author_person.id = avc.person_id
            WHERE av.status = 'SUBMITTED'
         )
         SELECT count(*)::text AS total_people,
                count(*) FILTER (WHERE lp.has_artifacts)::text AS artifact_senders,
                count(*) FILTER (WHERE NOT lp.has_artifacts)::text AS without_artifacts,
                count(*) FILTER (WHERE lp.profile_needs_review)::text AS profiles_need_review,
                (SELECT unreviewed_artifacts::text FROM artifact_metrics),
                (SELECT count(*)::text FROM duplicate_candidates WHERE status = 'OPEN') AS duplicate_candidates,
                (SELECT count(*)::text FROM tasks WHERE status NOT IN ('DONE', 'CANCELLED') AND due_at < now() AND archived_at IS NULL) AS overdue_tasks,
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
        artifactSenders: Number(row?.artifact_senders ?? 0),
        withoutArtifacts: Number(row?.without_artifacts ?? 0),
        profilesNeedReview: Number(row?.profiles_need_review ?? 0),
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
    '/task-assignees',
    {
      preHandler: app.requirePermission(Permissions.TASKS_MANAGE),
      schema: { tags: ['Задачи'], summary: 'Активные пользователи CRM для назначения задач' },
    },
    async (request) => {
      const result = await app.pool.query(
        `SELECT id, display_name, email
           FROM app_users
          WHERE status = 'ACTIVE' AND archived_at IS NULL
            AND oidc_subject NOT IN ('local-importer', 'locker-integration')
          ORDER BY display_name, id`,
      );
      return {
        currentUserId: request.authUser!.userId,
        items: result.rows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          email: row.email,
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
        querystring: Type.Object({
          overdue: Type.Optional(Type.Boolean()),
          status: Type.Optional(TaskStatusSchema),
          assignee: Type.Optional(Type.Union([Type.Literal('me'), Type.Literal('all')])),
          search: Type.Optional(Type.String({ maxLength: 200 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as {
        overdue?: boolean;
        status?: TaskStatus;
        assignee?: 'me' | 'all';
        search?: string;
        limit?: number;
      };
      const search = query.search?.trim() ?? '';
      const result = await app.pool.query(
        `SELECT t.id, t.person_id, t.project_id, t.title, t.description, t.status,
                t.due_at, t.completed_at, t.result, t.is_next_step, t.version, t.created_at,
                p.canonical_full_name AS person_name,
                u.display_name AS assignee_name,
                t.assignee_user_id,
                COALESCE(attachments.items, '[]'::jsonb) AS attachments
           FROM tasks t
           LEFT JOIN persons p ON p.id = t.person_id
           LEFT JOIN app_users u ON u.id = t.assignee_user_id
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
                      'id', file.id,
                      'fileName', file.original_filename,
                      'sizeBytes', file.size_bytes,
                      'status', file.status
                    ) ORDER BY attachment.created_at, attachment.id) AS items
               FROM task_attachments attachment
               JOIN file_objects file ON file.id = attachment.file_object_id
              WHERE attachment.task_id = t.id
           ) attachments ON true
          WHERE t.archived_at IS NULL
            AND (NOT $1::boolean OR (t.status <> 'DONE' AND t.status <> 'CANCELLED' AND t.due_at < now()))
            AND ($2::text IS NULL OR t.status = $2::task_status)
            AND ($3::uuid IS NULL OR t.assignee_user_id = $3::uuid)
            AND ($4::text = '' OR t.title ILIKE '%' || $4 || '%'
                 OR p.canonical_full_name ILIKE '%' || $4 || '%')
          ORDER BY t.status = 'DONE', t.status = 'CANCELLED',
                   t.due_at NULLS LAST, t.created_at DESC
          LIMIT $5`,
        [
          query.overdue ?? false,
          query.status ?? null,
          query.assignee === 'me' ? request.authUser!.userId : null,
          search,
          query.limit ?? 200,
        ],
      );
      return {
        items: result.rows.map((item) => ({
          id: item.id,
          personId: item.person_id,
          projectId: item.project_id,
          title: item.title,
          description: item.description,
          status: item.status,
          dueAt: item.due_at?.toISOString() ?? null,
          completedAt: item.completed_at?.toISOString() ?? null,
          result: item.result,
          isNextStep: item.is_next_step,
          version: item.version,
          createdAt: item.created_at?.toISOString() ?? null,
          personName: item.person_name,
          assigneeUserId: item.assignee_user_id,
          assigneeName: item.assignee_name,
          attachments: item.attachments,
        })),
      };
    },
  );

  app.patch(
    '/tasks/:id',
    {
      preHandler: app.requirePermission(Permissions.TASKS_MANAGE),
      schema: {
        tags: ['Задачи'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          version: Type.Integer({ minimum: 1 }),
          status: Type.Optional(TaskStatusSchema),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          description: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
          dueAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
          isNextStep: Type.Optional(Type.Boolean()),
          result: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
          assigneeUserId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
          fileObjectIds: Type.Optional(
            Type.Array(Type.String({ format: 'uuid' }), {
              maxItems: 10,
              uniqueItems: true,
            }),
          ),
        }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as {
        version: number;
        status?: TaskStatus;
        title?: string;
        description?: string | null;
        dueAt?: string | null;
        isNextStep?: boolean;
        result?: string | null;
        assigneeUserId?: string | null;
        fileObjectIds?: string[];
      };
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, person_id, title, description, status, due_at, completed_at,
                  result, is_next_step, version
             FROM tasks WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new HttpProblem(404, 'Задача не найдена');
        if (row.version !== body.version) throw new HttpProblem(409, 'Задача уже изменена');

        if (body.assigneeUserId) await assertActiveAssignee(client, body.assigneeUserId);

        const nextStatus: TaskStatus = body.status ?? row.status;
        const nextIsNextStep = body.isNextStep ?? row.is_next_step;
        // The partial unique index only tolerates one live next step per person,
        // so free the slot before this task claims it.
        if (nextIsNextStep && !FINISHED_TASK_STATUSES.has(nextStatus) && row.person_id) {
          await client.query(
            `UPDATE tasks
                SET is_next_step = false, version = version + 1, updated_at = now()
              WHERE person_id = $1 AND id <> $2 AND is_next_step
                AND status NOT IN ('DONE', 'CANCELLED') AND archived_at IS NULL`,
            [row.person_id, id],
          );
        }

        const updated = await client.query(
          `UPDATE tasks
              SET title = COALESCE($2, title),
                  description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                  status = $5::task_status,
                  due_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE due_at END,
                  is_next_step = CASE WHEN $8::task_status IN ('DONE', 'CANCELLED')
                                      THEN false ELSE $9::boolean END,
                  result = CASE WHEN $10::boolean THEN $11 ELSE result END,
                  assignee_user_id = CASE WHEN $12::boolean THEN $13::uuid ELSE assignee_user_id END,
                  completed_at = CASE WHEN $8::task_status = 'DONE'
                                      THEN COALESCE(completed_at, now()) ELSE NULL END,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, status, version`,
          [
            id,
            body.title?.trim() ?? null,
            body.description !== undefined,
            body.description === undefined ? null : body.description?.trim() || null,
            nextStatus,
            body.dueAt !== undefined,
            body.dueAt ? new Date(body.dueAt) : null,
            nextStatus,
            nextIsNextStep,
            body.result !== undefined,
            body.result === undefined ? null : body.result?.trim() || null,
            body.assigneeUserId !== undefined,
            body.assigneeUserId ?? null,
          ],
        );
        if (body.fileObjectIds !== undefined) {
          await replaceTaskAttachments(client, id, body.fileObjectIds, request.authUser!.userId);
        }
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'task.updated',
          entityType: 'task',
          entityId: id,
          before: {
            title: row.title,
            status: row.status,
            dueAt: row.due_at?.toISOString() ?? null,
            isNextStep: row.is_next_step,
          },
          after: { ...body, status: nextStatus },
        });
        const result = updated.rows[0]!;
        return { id: result.id, status: result.status, version: result.version };
      });
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
          description: Type.Optional(Type.String({ maxLength: 10_000 })),
          dueAt: Type.Optional(Type.String({ format: 'date-time' })),
          isNextStep: Type.Optional(Type.Boolean()),
          assigneeUserId: Type.Optional(Type.String({ format: 'uuid' })),
          fileObjectIds: Type.Optional(
            Type.Array(Type.String({ format: 'uuid' }), {
              maxItems: 10,
              uniqueItems: true,
            }),
          ),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        personId: string;
        title: string;
        description?: string;
        dueAt?: string;
        isNextStep?: boolean;
        assigneeUserId?: string;
        fileObjectIds?: string[];
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
        const assigneeUserId = body.assigneeUserId ?? request.authUser!.userId;
        await assertActiveAssignee(client, assigneeUserId);
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
                AND status NOT IN ('DONE', 'CANCELLED') AND archived_at IS NULL`,
            [canonicalPersonId],
          );
        }
        const task = await client.query<{ id: string }>(
          `INSERT INTO tasks (person_id, title, description, created_by_user_id, assignee_user_id, due_at, is_next_step)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            canonicalPersonId,
            body.title.trim(),
            body.description?.trim() || null,
            request.authUser!.userId,
            assigneeUserId,
            body.dueAt ? new Date(body.dueAt) : null,
            body.isNextStep ?? false,
          ],
        );
        await replaceTaskAttachments(
          client,
          task.rows[0]!.id,
          body.fileObjectIds ?? [],
          request.authUser!.userId,
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'task.created',
          entityType: 'task',
          entityId: task.rows[0]!.id,
          after: {
            personId: canonicalPersonId,
            title: body.title,
            dueAt: body.dueAt,
            assigneeUserId,
            attachmentCount: body.fileObjectIds?.length ?? 0,
          },
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
            WHERE id = $1 AND status IN ('OPEN', 'IN_PROGRESS') AND archived_at IS NULL
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
            Type.Literal('NOTE'),
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
          responsibleUserId: Type.Optional(Type.String({ format: 'uuid' })),
          nextContactAt: Type.Optional(
            Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
          ),
          fileObjectIds: Type.Optional(
            Type.Array(Type.String({ format: 'uuid' }), { maxItems: 10, uniqueItems: true }),
          ),
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
        responsibleUserId?: string;
        nextContactAt?: string | null;
        fileObjectIds?: string[];
      };
      const result = await transaction(app.pool, async (client) => {
        const canonical = await client.query<{ id: string }>(
          'SELECT COALESCE(merged_into_person_id, id) AS id FROM persons WHERE id = $1',
          [body.personId],
        );
        if (!canonical.rows[0]) throw new HttpProblem(404, 'Участник не найден');
        const responsibleUserId = body.responsibleUserId ?? request.authUser!.userId;
        await assertActiveAssignee(client, responsibleUserId);
        const interaction = await client.query<{ id: string }>(
          `INSERT INTO interactions
             (person_id, channel, direction, occurred_at, outcome, comment,
              created_by_user_id, responsible_user_id, next_contact_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            canonical.rows[0].id,
            body.channel,
            body.direction,
            new Date(body.occurredAt),
            body.outcome?.trim() || null,
            body.comment?.trim() || null,
            request.authUser!.userId,
            responsibleUserId,
            body.nextContactAt ? new Date(body.nextContactAt) : null,
          ],
        );
        await replaceInteractionAttachments(
          client,
          interaction.rows[0]!.id,
          body.fileObjectIds ?? [],
          request.authUser!.userId,
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
            responsibleUserId,
            nextContactAt: body.nextContactAt ?? null,
            attachmentCount: body.fileObjectIds?.length ?? 0,
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
    '/people/:id/duplicate-suggestions',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Дубли'],
        summary: 'Подходящие карточки для объединения с участником',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const personId = (request.params as { id: string }).id;
      const result = await app.pool.query<{
        id: string;
        canonical_full_name: string;
        primary_contact: string | null;
        organization_name: string | null;
        faculty: string | null;
        profile_needs_review: boolean;
        archived: boolean;
        from_bot: boolean;
        artifact_count: string;
        event_count: string;
        project_count: string;
        created_at: Date | null;
        open_candidate_id: string | null;
        open_candidate_reasons: unknown[] | null;
        confidence_basis_points: number | null;
        exact_name: boolean;
        prefix_name: boolean;
        token_overlap: number;
        exact_contact: boolean;
      }>(
        `WITH requested_person AS (
           SELECT COALESCE(requested.merged_into_person_id, requested.id) AS id
             FROM persons requested
            WHERE requested.id = $1 AND requested.archived_at IS NULL
         ), current_person AS (
           SELECT person.id, person.organization_id, person.normalized_full_name
             FROM requested_person requested
             JOIN persons person ON person.id = requested.id
            WHERE person.merged_into_person_id IS NULL AND person.archived_at IS NULL
         )
         SELECT candidate.id, candidate.canonical_full_name,
                contact.primary_contact, affiliation.organization_name, affiliation.faculty,
                candidate.profile_needs_review,
                candidate.archived_at IS NOT NULL AS archived,
                EXISTS (
                  SELECT 1 FROM external_identities identity
                   WHERE identity.person_id IN (
                           SELECT member.id FROM persons member
                            WHERE member.id = candidate.id
                               OR member.merged_into_person_id = candidate.id
                         )
                     AND identity.source_namespace IN ('locker.user', 'locker.telegram')
                     AND identity.archived_at IS NULL
                ) AS from_bot,
                COALESCE(artifact_stats.artifact_count, 0)::text AS artifact_count,
                COALESCE(event_stats.event_count, 0)::text AS event_count,
                COALESCE(project_stats.project_count, 0)::text AS project_count,
                candidate.created_at,
                open_candidate.id AS open_candidate_id,
                open_candidate.reasons AS open_candidate_reasons,
                open_candidate.confidence_basis_points,
                candidate.normalized_full_name = current.normalized_full_name AS exact_name,
                candidate.normalized_full_name LIKE current.normalized_full_name || ' %'
                  OR current.normalized_full_name LIKE candidate.normalized_full_name || ' %'
                  AS prefix_name,
                name_match.token_overlap,
                COALESCE(contact_match.matched, false) AS exact_contact
           FROM current_person current
           JOIN persons candidate
             ON candidate.organization_id = current.organization_id
            AND candidate.id <> current.id
            AND candidate.merged_into_person_id IS NULL
            AND candidate.archived_at IS NULL
           CROSS JOIN LATERAL (
             SELECT count(*)::integer AS token_overlap
               FROM (
                 SELECT DISTINCT token
                   FROM unnest(regexp_split_to_array(current.normalized_full_name, '[[:space:]]+')) token
                  WHERE char_length(token) >= 2
                 INTERSECT
                 SELECT DISTINCT token
                   FROM unnest(regexp_split_to_array(candidate.normalized_full_name, '[[:space:]]+')) token
                  WHERE char_length(token) >= 2
               ) shared_tokens
           ) name_match
           LEFT JOIN LATERAL (
             SELECT dc.id, dc.reasons, dc.confidence_basis_points
               FROM duplicate_candidates dc
              WHERE dc.status = 'OPEN'
                AND dc.person_a_id = LEAST(current.id, candidate.id)
                AND dc.person_b_id = GREATEST(current.id, candidate.id)
              ORDER BY dc.confidence_basis_points DESC, dc.detected_at
              LIMIT 1
           ) open_candidate ON true
           LEFT JOIN LATERAL (
             SELECT true AS matched
               FROM contact_points current_contact
               JOIN contact_points candidate_contact
                 ON candidate_contact.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = candidate.id
                          OR member.merged_into_person_id = candidate.id
                    )
                AND candidate_contact.archived_at IS NULL
                AND candidate_contact.type = current_contact.type
                AND (
                  candidate_contact.normalized_value = current_contact.normalized_value
                  OR (
                    candidate_contact.messenger_stable_id IS NOT NULL
                    AND candidate_contact.messenger_stable_id = current_contact.messenger_stable_id
                  )
                )
              WHERE current_contact.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = current.id OR member.merged_into_person_id = current.id
                    )
                AND current_contact.archived_at IS NULL
                AND current_contact.type IN ('PHONE', 'EMAIL', 'TELEGRAM')
              LIMIT 1
           ) contact_match ON true
           LEFT JOIN LATERAL (
             SELECT cp.raw_value AS primary_contact
               FROM contact_points cp
              WHERE cp.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = candidate.id
                          OR member.merged_into_person_id = candidate.id
                    )
                AND cp.archived_at IS NULL
              ORDER BY (cp.type = 'TELEGRAM' AND cp.messenger_stable_id IS NOT NULL) DESC,
                       (cp.type = 'TELEGRAM') DESC, cp.is_primary DESC, cp.created_at
              LIMIT 1
           ) contact ON true
           LEFT JOIN LATERAL (
             SELECT organization.name AS organization_name, affiliation.faculty
               FROM affiliations affiliation
               JOIN organizations organization ON organization.id = affiliation.organization_id
              WHERE affiliation.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = candidate.id
                          OR member.merged_into_person_id = candidate.id
                    )
                AND affiliation.archived_at IS NULL
              ORDER BY affiliation.is_primary DESC, affiliation.created_at
              LIMIT 1
           ) affiliation ON true
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT artifact.id) AS artifact_count
               FROM artifact_version_contributors contributor
               JOIN artifact_versions version ON version.id = contributor.artifact_version_id
               JOIN artifacts artifact ON artifact.id = version.artifact_id
              WHERE contributor.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = candidate.id
                          OR member.merged_into_person_id = candidate.id
                    )
                AND contributor.contribution_role = 'AUTHOR'
                AND version.status = 'SUBMITTED'
                AND artifact.status <> 'VOIDED' AND artifact.archived_at IS NULL
           ) artifact_stats ON true
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT participation.event_id) AS event_count
               FROM event_participations participation
              WHERE participation.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = candidate.id
                          OR member.merged_into_person_id = candidate.id
                    )
                AND participation.archived_at IS NULL
           ) event_stats ON true
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT membership.project_id) AS project_count
               FROM project_memberships membership
              WHERE membership.person_id IN (
                      SELECT member.id FROM persons member
                       WHERE member.id = candidate.id
                          OR member.merged_into_person_id = candidate.id
                    )
                AND membership.archived_at IS NULL
           ) project_stats ON true
          WHERE (
                  open_candidate.id IS NOT NULL
                  OR COALESCE(contact_match.matched, false)
                  OR candidate.normalized_full_name = current.normalized_full_name
                  OR (
                    cardinality(regexp_split_to_array(current.normalized_full_name, '[[:space:]]+')) >= 2
                    AND cardinality(regexp_split_to_array(candidate.normalized_full_name, '[[:space:]]+')) >= 2
                    AND (
                      candidate.normalized_full_name LIKE current.normalized_full_name || ' %'
                      OR current.normalized_full_name LIKE candidate.normalized_full_name || ' %'
                      OR name_match.token_overlap >= 2
                    )
                  )
                )
            AND (
                  open_candidate.id IS NOT NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM not_duplicate_pairs pair
                     WHERE pair.person_a_id = LEAST(current.id, candidate.id)
                       AND pair.person_b_id = GREATEST(current.id, candidate.id)
                  )
                )
          ORDER BY (open_candidate.id IS NOT NULL) DESC,
                   COALESCE(contact_match.matched, false) DESC,
                   (candidate.normalized_full_name = current.normalized_full_name) DESC,
                   (candidate.normalized_full_name LIKE current.normalized_full_name || ' %'
                     OR current.normalized_full_name LIKE candidate.normalized_full_name || ' %') DESC,
                   name_match.token_overlap DESC,
                   candidate.profile_needs_review,
                   candidate.canonical_full_name
          LIMIT 10`,
        [personId],
      );

      return {
        items: result.rows.map((row) => {
          const reasons = Array.isArray(row.open_candidate_reasons)
            ? row.open_candidate_reasons.map((reason) => duplicateReasonLabel(reason))
            : [];
          if (row.exact_contact) reasons.push('Совпал контакт');
          if (row.exact_name) reasons.push('Полностью совпало ФИО');
          else if (row.prefix_name || row.token_overlap >= 2) reasons.push('Совпали фамилия и имя');
          return {
            id: row.id,
            canonicalFullName: row.canonical_full_name,
            primaryContact: row.primary_contact,
            organization: row.organization_name,
            faculty: row.faculty,
            fromBot: row.from_bot,
            profileNeedsReview: row.profile_needs_review,
            archived: row.archived,
            artifactCount: Number(row.artifact_count),
            eventCount: Number(row.event_count),
            projectCount: Number(row.project_count),
            createdAt: row.created_at?.toISOString() ?? null,
            openCandidateId: row.open_candidate_id,
            confidence:
              row.confidence_basis_points === null ? null : row.confidence_basis_points / 10_000,
            reasons: [...new Set(reasons)],
          };
        }),
      };
    },
  );

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
    '/duplicate-candidates',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Дубли'],
        summary: 'Завести пару на слияние вручную',
        body: Type.Object({
          personAId: Type.String({ format: 'uuid' }),
          personBId: Type.String({ format: 'uuid' }),
          reason: Type.String({ minLength: 3, maxLength: 2000 }),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as { personAId: string; personBId: string; reason: string };
      if (body.personAId === body.personBId)
        throw new HttpProblem(400, 'Нельзя объединить карточку саму с собой');
      // Схема требует person_a_id < person_b_id и 64 hex-символа отпечатка.
      const [first, second] = [body.personAId, body.personBId].sort();
      const fingerprint = createHash('sha256').update(`manual:${first}:${second}`).digest('hex');

      return transaction(app.pool, async (client) => {
        // Карточки в архиве допустимы: гигиена ФИО прячет личности, заведённые
        // ботом по имени из Telegram, а слияние с живым участником — это ровно
        // тот способ, которым такие карточки возвращаются в оборот.
        const people = await client.query<{
          id: string;
          merged_into_person_id: string | null;
          archived: boolean;
        }>(
          `SELECT id, merged_into_person_id, archived_at IS NOT NULL AS archived
             FROM persons
            WHERE id = ANY($1::uuid[])
            ORDER BY id FOR UPDATE`,
          [[first, second]],
        );
        if (people.rows.length !== 2) throw new HttpProblem(404, 'Одна из карточек не найдена');
        if (people.rows.some((row) => row.merged_into_person_id))
          throw new HttpProblem(409, 'Одна из карточек уже объединена');
        if (people.rows.every((row) => row.archived))
          throw new HttpProblem(409, 'Обе карточки в архиве — объединять нечего');

        const existing = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM duplicate_candidates
            WHERE person_a_id = $1 AND person_b_id = $2
            ORDER BY status = 'OPEN' DESC, detected_at DESC
            LIMIT 1`,
          [first, second],
        );
        const open = existing.rows.find((row) => row.status === 'OPEN');
        if (open) return reply.code(200).send({ id: open.id, status: 'OPEN' });

        const created = await client.query<{ id: string }>(
          `INSERT INTO duplicate_candidates
             (person_a_id, person_b_id, confidence_basis_points, evidence_fingerprint, reasons)
           VALUES ($1, $2, 10000, $3, $4::jsonb)
           ON CONFLICT (person_a_id, person_b_id, evidence_fingerprint)
           DO UPDATE SET status = 'OPEN', decided_at = NULL, decided_by_user_id = NULL,
                         decision_reason = NULL, updated_at = now()
           RETURNING id`,
          [first, second, fingerprint, JSON.stringify(['MANUAL'])],
        );
        const id = created.rows[0]!.id;
        await client.query(
          'DELETE FROM not_duplicate_pairs WHERE person_a_id = $1 AND person_b_id = $2',
          [first, second],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'duplicate.manually_queued',
          entityType: 'duplicate_candidate',
          entityId: id,
          reason: body.reason,
          after: { personAId: first, personBId: second },
        });
        return reply.code(201).send({ id, status: 'OPEN' });
      });
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
                  AND status NOT IN ('DONE', 'CANCELLED') AND is_next_step AND archived_at IS NULL
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
          // Одна и та же пара может попасть в очередь по нескольким признакам
          // (например, совпали и имя, и телефон). После слияния закрываем все
          // открытые свидетельства этой пары, чтобы фантомный дубль не оставался
          // на дашборде.
          await client.query(
            `UPDATE duplicate_candidates
                SET status = 'MERGED', decided_at = now(), decided_by_user_id = $3,
                    decision_reason = $4, updated_at = now()
              WHERE status = 'OPEN'
                AND person_a_id = LEAST($1::uuid, $2::uuid)
                AND person_b_id = GREATEST($1::uuid, $2::uuid)`,
            [body.masterPersonId, loser, request.authUser!.userId, body.reason],
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

async function assertActiveAssignee(client: PoolClient, userId: string): Promise<void> {
  const user = await client.query<{ id: string }>(
    `SELECT id FROM app_users
      WHERE id = $1 AND status = 'ACTIVE' AND archived_at IS NULL
        AND oidc_subject NOT IN ('local-importer', 'locker-integration')`,
    [userId],
  );
  if (!user.rows[0]) throw new HttpProblem(400, 'Исполнитель CRM не найден');
}

async function replaceTaskAttachments(
  client: PoolClient,
  taskId: string,
  requestedIds: readonly string[],
  actorUserId: string,
): Promise<void> {
  const fileIds = [...new Set(requestedIds)];
  if (fileIds.length > 10)
    throw new HttpProblem(400, 'К задаче можно приложить не более 10 файлов');
  if (fileIds.length > 0) {
    const files = await client.query<{ id: string }>(
      `SELECT file.id
         FROM file_objects file
        WHERE file.id = ANY($1::uuid[])
          AND file.status = 'AVAILABLE'
          AND (
            file.uploaded_by_user_id = $2
            OR EXISTS (
              SELECT 1 FROM task_attachments attachment
               WHERE attachment.task_id = $3 AND attachment.file_object_id = file.id
            )
          )`,
      [fileIds, actorUserId, taskId],
    );
    if (files.rows.length !== fileIds.length) {
      throw new HttpProblem(400, 'Один из файлов задачи недоступен или ещё проверяется');
    }
  }
  await client.query(
    `DELETE FROM task_attachments
      WHERE task_id = $1 AND NOT (file_object_id = ANY($2::uuid[]))`,
    [taskId, fileIds],
  );
  for (const fileId of fileIds) {
    await client.query(
      `INSERT INTO task_attachments (task_id, file_object_id, uploaded_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, file_object_id) DO NOTHING`,
      [taskId, fileId, actorUserId],
    );
  }
}

async function replaceInteractionAttachments(
  client: PoolClient,
  interactionId: string,
  requestedIds: readonly string[],
  actorUserId: string,
): Promise<void> {
  const fileIds = [...new Set(requestedIds)];
  if (fileIds.length > 10)
    throw new HttpProblem(400, 'К взаимодействию можно приложить не более 10 файлов');
  if (fileIds.length > 0) {
    const files = await client.query<{ id: string }>(
      `SELECT file.id
         FROM file_objects file
        WHERE file.id = ANY($1::uuid[])
          AND file.status = 'AVAILABLE'
          AND file.uploaded_by_user_id = $2`,
      [fileIds, actorUserId],
    );
    if (files.rows.length !== fileIds.length) {
      throw new HttpProblem(400, 'Один из файлов взаимодействия недоступен или ещё проверяется');
    }
  }
  for (const fileId of fileIds) {
    await client.query(
      `INSERT INTO interaction_attachments
         (interaction_id, file_object_id, uploaded_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (interaction_id, file_object_id) DO NOTHING`,
      [interactionId, fileId, actorUserId],
    );
  }
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
    fromBot: false,
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
