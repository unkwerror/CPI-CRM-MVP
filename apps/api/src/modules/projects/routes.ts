import { Permissions, normalizeFullName, normalizeUnicode } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const PROJECT_STATUSES = ['IDEA', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;
const DECISIONS = ['UNKNOWN', 'PENDING', 'ACCEPTED', 'REJECTED', 'WAITLISTED'] as const;
const ATTENDANCES = ['UNKNOWN', 'ATTENDED', 'NO_SHOW', 'PARTIAL'] as const;

const ProjectStatus = Type.Union(PROJECT_STATUSES.map((status) => Type.Literal(status)));
const ParticipationDecision = Type.Union(DECISIONS.map((status) => Type.Literal(status)));
const AttendanceStatus = Type.Union(ATTENDANCES.map((status) => Type.Literal(status)));

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/projects',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Проекты'],
        summary: 'Реестр проектов',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 500 })),
          status: Type.Optional(ProjectStatus),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as {
        q?: string;
        status?: (typeof PROJECT_STATUSES)[number];
        limit?: number;
        offset?: number;
      };
      const organization = await getOrganizationContext(app.pool);
      const values: unknown[] = [organization.id];
      const filters = ['project.organization_id = $1', 'project.archived_at IS NULL'];
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        filters.push(
          `(project.name ILIKE $${values.length} OR COALESCE(project.description, '') ILIKE $${values.length})`,
        );
      }
      if (query.status) {
        values.push(query.status);
        filters.push(`project.status = $${values.length}`);
      }
      values.push(query.limit ?? 100);
      const limitParameter = values.length;
      values.push(query.offset ?? 0);
      const offsetParameter = values.length;

      const result = await app.pool.query(
        `SELECT project.id, project.name, project.description, project.status,
                project.starts_at, project.ends_at, project.version,
                owner.display_name AS owner_name,
                (SELECT count(DISTINCT COALESCE(person.merged_into_person_id, person.id))
                   FROM project_memberships membership
                   JOIN persons person ON person.id = membership.person_id
                  WHERE membership.project_id = project.id
                    AND membership.archived_at IS NULL
                    AND person.archived_at IS NULL)::text AS member_count,
                (SELECT count(*) FROM artifacts artifact
                  WHERE artifact.project_id = project.id
                    AND artifact.archived_at IS NULL
                    AND artifact.status <> 'VOIDED')::text AS artifact_count,
                (SELECT count(*) FROM event_project_participations participation
                  WHERE participation.project_id = project.id
                    AND participation.archived_at IS NULL)::text AS event_count,
                count(*) OVER()::text AS total_count
           FROM projects project
           LEFT JOIN app_users owner ON owner.id = project.owner_user_id
          WHERE ${filters.join(' AND ')}
          ORDER BY project.updated_at DESC, project.normalized_name, project.id
          LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        values,
      );
      return {
        items: result.rows.map(mapProjectSummary),
        total: Number(result.rows[0]?.total_count ?? 0),
      };
    },
  );

  app.get(
    '/projects/:id',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Проекты'],
        summary: 'Карточка проекта',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const projectId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const projectResult = await app.pool.query(
        `SELECT project.id, project.name, project.description, project.status,
                project.starts_at, project.ends_at, project.version,
                project.owner_user_id, owner.display_name AS owner_name,
                (SELECT count(*) FROM artifacts artifact
                  WHERE artifact.project_id = project.id
                    AND artifact.archived_at IS NULL
                    AND artifact.status <> 'VOIDED')::text AS artifact_count
           FROM projects project
           LEFT JOIN app_users owner ON owner.id = project.owner_user_id
          WHERE project.id = $1 AND project.organization_id = $2
            AND project.archived_at IS NULL`,
        [projectId, organization.id],
      );
      const project = projectResult.rows[0];
      if (!project) throw new HttpProblem(404, 'Проект не найден');

      const [members, events, tasks] = await Promise.all([
        app.pool.query(
          `SELECT membership.id AS membership_id, canonical.id,
                  canonical.canonical_full_name, membership.role,
                  membership.joined_at, membership.version,
                  (SELECT count(DISTINCT artifact.id)
                     FROM artifacts artifact
                    WHERE artifact.project_id = $1
                      AND artifact.archived_at IS NULL
                      AND artifact.status <> 'VOIDED'
                      AND EXISTS (
                        SELECT 1
                          FROM artifact_versions version
                          JOIN artifact_version_contributors contributor
                            ON contributor.artifact_version_id = version.id
                          JOIN persons author ON author.id = contributor.person_id
                         WHERE version.artifact_id = artifact.id
                           AND version.status <> 'VOIDED'
                           AND contributor.contribution_role = 'AUTHOR'
                           AND COALESCE(author.merged_into_person_id, author.id) = canonical.id
                      ))::text AS artifact_count
             FROM project_memberships membership
             JOIN persons observed ON observed.id = membership.person_id
             JOIN persons canonical
               ON canonical.id = COALESCE(observed.merged_into_person_id, observed.id)
            WHERE membership.project_id = $1
              AND membership.archived_at IS NULL
              AND canonical.archived_at IS NULL
            ORDER BY canonical.normalized_full_name, canonical.id`,
          [projectId],
        ),
        app.pool.query(
          `SELECT participation.id AS participation_id, event.id, event.name,
                  event.status, event.starts_at, event.ends_at,
                  participation.decision, participation.attendance,
                  participation.result, participation.registered_at,
                  participation.version
             FROM event_project_participations participation
             JOIN events event ON event.id = participation.event_id
            WHERE participation.project_id = $1
              AND participation.archived_at IS NULL
              AND event.organization_id = $2
              AND event.archived_at IS NULL
            ORDER BY event.starts_at DESC NULLS LAST, event.normalized_name`,
          [projectId, organization.id],
        ),
        app.pool.query(
          `SELECT task.id, task.title, task.status, task.due_at,
                  assignee.display_name AS assignee_name
             FROM tasks task
             LEFT JOIN app_users assignee ON assignee.id = task.assignee_user_id
            WHERE task.project_id = $1 AND task.archived_at IS NULL
            ORDER BY (task.status IN ('DONE', 'CANCELLED')), task.due_at NULLS LAST, task.created_at DESC`,
          [projectId],
        ),
      ]);

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        startsAt: project.starts_at?.toISOString() ?? null,
        endsAt: project.ends_at?.toISOString() ?? null,
        version: Number(project.version),
        ownerUserId: project.owner_user_id,
        ownerName: project.owner_name,
        memberCount: members.rows.length,
        artifactCount: Number(project.artifact_count),
        eventCount: events.rows.length,
        members: members.rows.map((row) => ({
          membershipId: row.membership_id,
          id: row.id,
          canonicalFullName: row.canonical_full_name,
          role: row.role,
          joinedAt: row.joined_at.toISOString(),
          version: Number(row.version),
          artifactCount: Number(row.artifact_count),
        })),
        events: events.rows.map((row) => ({
          participationId: row.participation_id,
          id: row.id,
          name: row.name,
          status: row.status,
          startsAt: row.starts_at?.toISOString() ?? null,
          endsAt: row.ends_at?.toISOString() ?? null,
          decision: row.decision,
          attendance: row.attendance,
          result: row.result,
          registeredAt: row.registered_at.toISOString(),
          version: Number(row.version),
        })),
        tasks: tasks.rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          dueAt: row.due_at?.toISOString() ?? null,
          assigneeName: row.assignee_name,
        })),
      };
    },
  );

  app.patch(
    '/projects/:id',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Проекты'],
        summary: 'Обновить проект',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            version: Type.Integer({ minimum: 1 }),
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
            description: Type.Optional(
              Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]),
            ),
            status: Type.Optional(ProjectStatus),
            startsAt: Type.Optional(
              Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
            ),
            endsAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
            ownerUserId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const projectId = (request.params as { id: string }).id;
      const body = request.body as {
        version: number;
        name?: string;
        description?: string | null;
        status?: (typeof PROJECT_STATUSES)[number];
        startsAt?: string | null;
        endsAt?: string | null;
        ownerUserId?: string | null;
      };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, name, description, status, starts_at, ends_at, owner_user_id, version
             FROM projects
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
            FOR UPDATE`,
          [projectId, organization.id],
        );
        const project = current.rows[0];
        if (!project) throw new HttpProblem(404, 'Проект не найден');
        if (Number(project.version) !== body.version) {
          throw new HttpProblem(
            409,
            'Проект уже изменён',
            'Обновите страницу и повторите действие.',
          );
        }

        const name = cleanProjectName(body.name ?? project.name);
        const startsAt =
          body.startsAt === undefined ? project.starts_at : parseOptionalDate(body.startsAt);
        const endsAt = body.endsAt === undefined ? project.ends_at : parseOptionalDate(body.endsAt);
        if (startsAt && endsAt && endsAt <= startsAt) {
          throw new HttpProblem(400, 'Дата окончания должна быть позже начала');
        }
        if (body.ownerUserId) await assertActiveUser(client, body.ownerUserId);
        const updated = await client.query(
          `UPDATE projects
              SET name = $3, normalized_name = $4, description = $5,
                  status = $6, starts_at = $7, ends_at = $8,
                  owner_user_id = $9, updated_at = now(), version = version + 1
            WHERE id = $1 AND organization_id = $2
            RETURNING id, name, description, status, starts_at, ends_at,
                      owner_user_id, version`,
          [
            projectId,
            organization.id,
            name,
            normalizeFullName(name),
            body.description === undefined ? project.description : body.description?.trim() || null,
            body.status ?? project.status,
            startsAt,
            endsAt,
            body.ownerUserId === undefined ? project.owner_user_id : body.ownerUserId,
          ],
        );
        const row = updated.rows[0]!;
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'project.updated',
          entityType: 'project',
          entityId: projectId,
          before: project,
          after: row,
        });
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          status: row.status,
          startsAt: row.starts_at?.toISOString() ?? null,
          endsAt: row.ends_at?.toISOString() ?? null,
          ownerUserId: row.owner_user_id,
          version: Number(row.version),
        };
      });
    },
  );

  app.post(
    '/projects/:id/members',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Проекты'],
        summary: 'Добавить участника в проект',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            personId: Type.String({ format: 'uuid' }),
            role: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const projectId = (request.params as { id: string }).id;
      const body = request.body as { personId: string; role?: string };
      const role = body.role?.trim() || 'Участник';
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        await assertProject(client, projectId, organization.id);
        const person = await canonicalPerson(client, body.personId, organization.id);
        const existing = await client.query(
          `SELECT id FROM project_memberships
            WHERE project_id = $1 AND person_id = $2 AND archived_at IS NULL`,
          [projectId, person.id],
        );
        if (existing.rows[0]) throw new HttpProblem(409, 'Участник уже состоит в проекте');

        const restored = await client.query<{ id: string }>(
          `UPDATE project_memberships
              SET archived_at = NULL, role = $3, joined_at = now(),
                  data_origin = 'LIVE', updated_at = now(), version = version + 1
            WHERE id = (
              SELECT id FROM project_memberships
               WHERE project_id = $1 AND person_id = $2 AND archived_at IS NOT NULL
               ORDER BY archived_at DESC LIMIT 1
            )
            RETURNING id`,
          [projectId, person.id, role],
        );
        const membership =
          restored.rows[0] ??
          (
            await client.query<{ id: string }>(
              `INSERT INTO project_memberships (project_id, person_id, role, data_origin)
               VALUES ($1, $2, $3, 'LIVE') RETURNING id`,
              [projectId, person.id, role],
            )
          ).rows[0]!;
        const addedToEvents = await addPeopleToProjectEvents(client, projectId, [person.id]);

        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'project.member_added',
          entityType: 'project_membership',
          entityId: membership.id,
          after: {
            projectId,
            personId: person.id,
            role,
            restored: restored.rows[0] !== undefined,
            addedToEvents,
          },
        });
        return {
          id: membership.id,
          personId: person.id,
          canonicalFullName: person.canonicalFullName,
          role,
          addedToEvents,
        };
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/projects/:id/members/:personId',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Проекты'],
        summary: 'Изменить роль участника проекта',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          personId: Type.String({ format: 'uuid' }),
        }),
        body: Type.Object(
          { role: Type.String({ minLength: 1, maxLength: 500 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { id: projectId, personId } = request.params as { id: string; personId: string };
      const role = (request.body as { role: string }).role.trim();
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        await assertProject(client, projectId, organization.id);
        const person = await canonicalPerson(client, personId, organization.id);
        const updated = await client.query<{ id: string }>(
          `UPDATE project_memberships
              SET role = $3, updated_at = now(), version = version + 1
            WHERE project_id = $1 AND person_id = $2 AND archived_at IS NULL
            RETURNING id`,
          [projectId, person.id, role],
        );
        if (!updated.rows[0]) throw new HttpProblem(404, 'Участник проекта не найден');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'project.member_role_updated',
          entityType: 'project_membership',
          entityId: updated.rows[0].id,
          after: { projectId, personId: person.id, role },
        });
        return { id: updated.rows[0].id, role };
      });
    },
  );

  app.delete(
    '/projects/:id/members/:personId',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Проекты'],
        summary: 'Убрать участника из проекта',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          personId: Type.String({ format: 'uuid' }),
        }),
      },
    },
    async (request, reply) => {
      const { id: projectId, personId } = request.params as { id: string; personId: string };
      const organization = await getOrganizationContext(app.pool);
      await transaction(app.pool, async (client) => {
        await assertProject(client, projectId, organization.id);
        const person = await canonicalPerson(client, personId, organization.id);
        const archived = await client.query<{ id: string }>(
          `UPDATE project_memberships
              SET archived_at = now(), updated_at = now(), version = version + 1
            WHERE project_id = $1 AND person_id = $2 AND archived_at IS NULL
            RETURNING id`,
          [projectId, person.id],
        );
        if (!archived.rows[0]) throw new HttpProblem(404, 'Участник проекта не найден');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'project.member_removed',
          entityType: 'project_membership',
          entityId: archived.rows[0].id,
          after: { projectId, personId: person.id },
        });
      });
      return reply.code(204).send();
    },
  );

  app.get(
    '/events/:id/projects',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Мероприятия', 'Проекты'],
        summary: 'Проекты мероприятия',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const eventId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      await assertEvent(app.pool, eventId, organization.id);
      const result = await app.pool.query(
        `SELECT participation.id AS participation_id, project.id, project.name,
                project.description, project.status, project.starts_at, project.ends_at,
                participation.decision, participation.attendance, participation.result,
                participation.registered_at, participation.version,
                (SELECT count(*) FROM project_memberships membership
                  WHERE membership.project_id = project.id
                    AND membership.archived_at IS NULL)::text AS member_count,
                (SELECT count(*) FROM artifacts artifact
                  WHERE artifact.project_id = project.id
                    AND artifact.archived_at IS NULL
                    AND artifact.status <> 'VOIDED')::text AS artifact_count
           FROM event_project_participations participation
           JOIN projects project ON project.id = participation.project_id
          WHERE participation.event_id = $1
            AND participation.archived_at IS NULL
            AND project.organization_id = $2
            AND project.archived_at IS NULL
          ORDER BY project.normalized_name, project.id`,
        [eventId, organization.id],
      );
      return { items: result.rows.map(mapEventProject) };
    },
  );

  app.post(
    '/events/:id/projects',
    {
      preHandler: app.requirePermission(Permissions.EVENTS_WRITE),
      schema: {
        tags: ['Мероприятия', 'Проекты'],
        summary: 'Добавить проект и всех его участников в мероприятие',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            projectId: Type.String({ format: 'uuid' }),
            decision: Type.Optional(ParticipationDecision),
            attendance: Type.Optional(AttendanceStatus),
            result: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const eventId = (request.params as { id: string }).id;
      const body = request.body as {
        projectId: string;
        decision?: (typeof DECISIONS)[number];
        attendance?: (typeof ATTENDANCES)[number];
        result?: string;
      };
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        await assertEvent(client, eventId, organization.id);
        await assertProject(client, body.projectId, organization.id);
        const active = await client.query(
          `SELECT id FROM event_project_participations
            WHERE event_id = $1 AND project_id = $2 AND archived_at IS NULL`,
          [eventId, body.projectId],
        );
        if (active.rows[0]) throw new HttpProblem(409, 'Проект уже добавлен в мероприятие');

        const restored = await client.query<{ id: string }>(
          `UPDATE event_project_participations
              SET archived_at = NULL, registered_at = now(),
                  decision = $3::participation_decision,
                  attendance = $4::attendance_status,
                  result = $5, data_origin = 'LIVE',
                  updated_at = now(), version = version + 1
            WHERE id = (
              SELECT id FROM event_project_participations
               WHERE event_id = $1 AND project_id = $2 AND archived_at IS NOT NULL
               ORDER BY archived_at DESC LIMIT 1
            )
            RETURNING id`,
          [
            eventId,
            body.projectId,
            body.decision ?? 'UNKNOWN',
            body.attendance ?? 'UNKNOWN',
            body.result?.trim() || null,
          ],
        );
        const participation =
          restored.rows[0] ??
          (
            await client.query<{ id: string }>(
              `INSERT INTO event_project_participations
                 (event_id, project_id, decision, attendance, result, data_origin)
               VALUES ($1, $2, $3::participation_decision, $4::attendance_status, $5, 'LIVE')
               RETURNING id`,
              [
                eventId,
                body.projectId,
                body.decision ?? 'UNKNOWN',
                body.attendance ?? 'UNKNOWN',
                body.result?.trim() || null,
              ],
            )
          ).rows[0]!;
        const members = await client.query<{ person_id: string }>(
          `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
             FROM project_memberships membership
             JOIN persons person ON person.id = membership.person_id
            WHERE membership.project_id = $1
              AND membership.archived_at IS NULL
              AND person.archived_at IS NULL`,
          [body.projectId],
        );
        const participantsAdded = await addPeopleToEvent(
          client,
          eventId,
          members.rows.map((row) => row.person_id),
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'event.project_added',
          entityType: 'event_project_participation',
          entityId: participation.id,
          after: {
            eventId,
            projectId: body.projectId,
            decision: body.decision ?? 'UNKNOWN',
            attendance: body.attendance ?? 'UNKNOWN',
            result: body.result?.trim() || null,
            projectMemberCount: members.rows.length,
            participantsAdded,
            restored: restored.rows[0] !== undefined,
          },
        });
        return {
          id: participation.id,
          projectId: body.projectId,
          projectMemberCount: members.rows.length,
          participantsAdded,
        };
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/events/:id/projects/:projectId',
    {
      preHandler: app.requirePermission(Permissions.EVENTS_WRITE),
      schema: {
        tags: ['Мероприятия', 'Проекты'],
        summary: 'Обновить результат проекта на мероприятии',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          projectId: Type.String({ format: 'uuid' }),
        }),
        body: Type.Object(
          {
            decision: Type.Optional(ParticipationDecision),
            attendance: Type.Optional(AttendanceStatus),
            result: Type.Optional(
              Type.Union([Type.String({ minLength: 1, maxLength: 10_000 }), Type.Null()]),
            ),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
    },
    async (request) => {
      const { id: eventId, projectId } = request.params as { id: string; projectId: string };
      const body = request.body as {
        decision?: (typeof DECISIONS)[number];
        attendance?: (typeof ATTENDANCES)[number];
        result?: string | null;
      };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        await assertEvent(client, eventId, organization.id);
        await assertProject(client, projectId, organization.id);
        const updated = await client.query<{ id: string }>(
          `UPDATE event_project_participations
              SET decision = COALESCE($3::participation_decision, decision),
                  attendance = COALESCE($4::attendance_status, attendance),
                  result = CASE WHEN $5::boolean THEN $6 ELSE result END,
                  updated_at = now(), version = version + 1
            WHERE event_id = $1 AND project_id = $2 AND archived_at IS NULL
            RETURNING id`,
          [
            eventId,
            projectId,
            body.decision ?? null,
            body.attendance ?? null,
            body.result !== undefined,
            body.result?.trim() || null,
          ],
        );
        if (!updated.rows[0]) throw new HttpProblem(404, 'Проект не добавлен в мероприятие');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'event.project_updated',
          entityType: 'event_project_participation',
          entityId: updated.rows[0].id,
          after: { eventId, projectId, ...body, result: body.result?.trim() || null },
        });
        return { id: updated.rows[0].id };
      });
    },
  );

  app.delete(
    '/events/:id/projects/:projectId',
    {
      preHandler: app.requirePermission(Permissions.EVENTS_WRITE),
      schema: {
        tags: ['Мероприятия', 'Проекты'],
        summary: 'Убрать проект из мероприятия',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          projectId: Type.String({ format: 'uuid' }),
        }),
      },
    },
    async (request, reply) => {
      const { id: eventId, projectId } = request.params as { id: string; projectId: string };
      const organization = await getOrganizationContext(app.pool);
      await transaction(app.pool, async (client) => {
        await assertEvent(client, eventId, organization.id);
        const archived = await client.query<{ id: string }>(
          `UPDATE event_project_participations participation
              SET archived_at = now(), updated_at = now(), version = version + 1
             FROM projects project
            WHERE participation.event_id = $1
              AND participation.project_id = $2
              AND participation.archived_at IS NULL
              AND project.id = participation.project_id
              AND project.organization_id = $3
            RETURNING participation.id`,
          [eventId, projectId, organization.id],
        );
        if (!archived.rows[0]) throw new HttpProblem(404, 'Проект не добавлен в мероприятие');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'event.project_removed',
          entityType: 'event_project_participation',
          entityId: archived.rows[0].id,
          after: { eventId, projectId },
        });
      });
      return reply.code(204).send();
    },
  );
}

function mapProjectSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : null,
    endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : null,
    version: Number(row.version),
    ownerName: row.owner_name,
    memberCount: Number(row.member_count),
    artifactCount: Number(row.artifact_count),
    eventCount: Number(row.event_count),
  };
}

function mapEventProject(row: Record<string, unknown>) {
  return {
    participationId: row.participation_id,
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : null,
    endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : null,
    decision: row.decision,
    attendance: row.attendance,
    result: row.result,
    registeredAt: row.registered_at instanceof Date ? row.registered_at.toISOString() : null,
    version: Number(row.version),
    memberCount: Number(row.member_count),
    artifactCount: Number(row.artifact_count),
  };
}

function cleanProjectName(value: string): string {
  const name = normalizeUnicode(value).replace(/\s+/gu, ' ').trim();
  if (!name) throw new HttpProblem(400, 'Название проекта не может быть пустым');
  return name;
}

function parseOptionalDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpProblem(400, 'Некорректная дата проекта');
  return date;
}

async function assertProject(client: PoolClient, projectId: string, organizationId: string) {
  const result = await client.query(
    `SELECT id FROM projects
      WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
      FOR UPDATE`,
    [projectId, organizationId],
  );
  if (!result.rows[0]) throw new HttpProblem(404, 'Проект не найден');
}

async function assertEvent(
  client: Pick<PoolClient, 'query'>,
  eventId: string,
  organizationId: string,
) {
  const result = await client.query(
    `SELECT id FROM events
      WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
    [eventId, organizationId],
  );
  if (!result.rows[0]) throw new HttpProblem(404, 'Мероприятие не найдено');
}

async function assertActiveUser(client: PoolClient, userId: string) {
  const result = await client.query(
    'SELECT id FROM app_users WHERE id = $1 AND active FOR UPDATE',
    [userId],
  );
  if (!result.rows[0]) throw new HttpProblem(400, 'Ответственный пользователь не найден');
}

async function canonicalPerson(client: PoolClient, personId: string, organizationId: string) {
  const result = await client.query<{ id: string; canonical_full_name: string }>(
    `SELECT canonical.id, canonical.canonical_full_name
       FROM persons observed
       JOIN persons canonical ON canonical.id = COALESCE(observed.merged_into_person_id, observed.id)
      WHERE observed.id = $1 AND observed.organization_id = $2
        AND canonical.archived_at IS NULL
      FOR UPDATE OF canonical`,
    [personId, organizationId],
  );
  if (!result.rows[0]) throw new HttpProblem(404, 'Участник не найден');
  return {
    id: result.rows[0].id,
    canonicalFullName: result.rows[0].canonical_full_name,
  };
}

async function addPeopleToProjectEvents(
  client: PoolClient,
  projectId: string,
  personIds: string[],
): Promise<number> {
  if (personIds.length === 0) return 0;
  const events = await client.query<{ event_id: string }>(
    `SELECT event_id FROM event_project_participations
      WHERE project_id = $1 AND archived_at IS NULL`,
    [projectId],
  );
  let added = 0;
  for (const event of events.rows) {
    added += await addPeopleToEvent(client, event.event_id, personIds);
  }
  return added;
}

async function addPeopleToEvent(
  client: PoolClient,
  eventId: string,
  personIds: string[],
): Promise<number> {
  if (personIds.length === 0) return 0;
  const result = await client.query(
    `WITH requested(person_id) AS (
       SELECT DISTINCT unnest($2::uuid[])
     )
     INSERT INTO event_participations (person_id, event_id, registered_at, data_origin)
     SELECT requested.person_id, $1, now(), 'LIVE'
       FROM requested
      WHERE NOT EXISTS (
        SELECT 1
          FROM event_participations existing
          JOIN persons observed ON observed.id = existing.person_id
         WHERE existing.event_id = $1
           AND existing.archived_at IS NULL
           AND COALESCE(observed.merged_into_person_id, observed.id) = requested.person_id
      )
     ON CONFLICT (person_id, event_id) WHERE archived_at IS NULL DO NOTHING`,
    [eventId, personIds],
  );
  return result.rowCount ?? 0;
}
