import { normalizeFullName, normalizeUnicode, Permissions, Roles } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { writeAudit } from '../../lib/audit.js';
import { requireLockerIntegration } from '../../lib/locker-auth.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import type { AuthUser } from '../../types.js';

const APPLICATION_TYPES = ['CREATE', 'JOIN'] as const;
const APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const REVIEW_DECISIONS = ['APPROVED', 'REJECTED'] as const;

const LockerIdentity = Type.Object(
  {
    lockerUserId: Type.String({ format: 'uuid' }),
    telegramUserId: Type.String({ pattern: '^[0-9]+$', maxLength: 32 }),
  },
  { additionalProperties: false },
);

const LOCKER_ACTOR: AuthUser = {
  sub: 'locker-integration',
  userId: '00000000-0000-4000-8000-000000000002',
  name: 'Интеграция Locker',
  email: 'locker-integration@cpi.local',
  roles: [],
  permissions: [],
};

type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export async function registerProjectApplicationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/project-applications',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Проекты'],
        summary: 'Заявки на проекты',
        querystring: Type.Object({
          status: Type.Optional(
            Type.Union(APPLICATION_STATUSES.map((status) => Type.Literal(status))),
          ),
          type: Type.Optional(Type.Union(APPLICATION_TYPES.map((type) => Type.Literal(type)))),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as {
        status?: (typeof APPLICATION_STATUSES)[number];
        type?: (typeof APPLICATION_TYPES)[number];
        limit?: number;
      };
      const organization = await getOrganizationContext(app.pool);
      const isAdmin = request.authUser!.roles.includes(Roles.ADMIN);
      const values: unknown[] = [organization.id];
      const filters = ['application.organization_id = $1', 'application.archived_at IS NULL'];
      if (!isAdmin) {
        values.push(request.authUser!.userId);
        filters.push(
          `(application.application_type = 'JOIN' AND project.owner_user_id = $${values.length})`,
        );
      }
      if (query.status) {
        values.push(query.status);
        filters.push(`application.status = $${values.length}`);
      }
      if (query.type) {
        values.push(query.type);
        filters.push(`application.application_type = $${values.length}`);
      }
      values.push(query.limit ?? 200);
      const result = await app.pool.query(
        `SELECT application.id, application.application_type, application.status,
                application.applicant_person_id, applicant.canonical_full_name AS applicant_name,
                application.project_id, project.name AS project_name,
                application.proposed_name, application.proposed_description,
                application.requested_role, application.message,
                application.review_comment, application.reviewed_at,
                application.created_project_id, created_project.name AS created_project_name,
                application.created_at, application.updated_at,
                reviewer.display_name AS reviewed_by_user_name,
                person_reviewer.canonical_full_name AS reviewed_by_person_name
           FROM project_applications application
           JOIN persons applicant ON applicant.id = application.applicant_person_id
           LEFT JOIN projects project ON project.id = application.project_id
           LEFT JOIN projects created_project ON created_project.id = application.created_project_id
           LEFT JOIN app_users reviewer ON reviewer.id = application.reviewed_by_user_id
           LEFT JOIN persons person_reviewer ON person_reviewer.id = application.reviewed_by_person_id
          WHERE ${filters.join(' AND ')}
          ORDER BY (application.status = 'PENDING') DESC, application.created_at DESC
          LIMIT $${values.length}`,
        values,
      );
      return { items: result.rows.map(mapApplication) };
    },
  );

  app.post(
    '/project-applications/:id/decision',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Проекты'],
        summary: 'Принять решение по заявке на проект',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            decision: Type.Union(REVIEW_DECISIONS.map((decision) => Type.Literal(decision))),
            comment: Type.Optional(Type.String({ maxLength: 5_000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const applicationId = (request.params as { id: string }).id;
      const body = request.body as { decision: ReviewDecision; comment?: string };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, (client) =>
        reviewApplication(client, {
          organizationId: organization.id,
          applicationId,
          decision: body.decision,
          comment: body.comment?.trim() || null,
          reviewerUser: request.authUser!,
          requestId: request.id,
        }),
      );
    },
  );

  const lockerAuth = requireLockerIntegration(app.config.locker.integrationToken);

  app.get(
    '/integrations/locker/v1/projects/context',
    {
      preHandler: lockerAuth,
      schema: {
        tags: ['Интеграции', 'Проекты'],
        summary: 'Проекты и заявки пользователя Telegram',
        querystring: LockerIdentity,
      },
    },
    async (request) => {
      const identity = request.query as { lockerUserId: string; telegramUserId: string };
      const organization = await getOrganizationContext(app.pool);
      const personId = await resolveIntegrationPerson(
        app.pool,
        organization.id,
        identity.lockerUserId,
        identity.telegramUserId,
      );

      const [catalog, mine, applications, incoming] = await Promise.all([
        app.pool.query(
          `${projectContextSelect()}
            WHERE project.organization_id = $1
              AND project.archived_at IS NULL
              AND project.visible_in_bot = true
              AND project.status IN ('IDEA', 'ACTIVE', 'PAUSED')
            ORDER BY project.updated_at DESC, project.normalized_name`,
          [organization.id, personId],
        ),
        app.pool.query(
          `${projectContextSelect()}
            WHERE project.organization_id = $1
              AND project.archived_at IS NULL
              AND membership.role IS NOT NULL
            ORDER BY project.updated_at DESC, project.normalized_name`,
          [organization.id, personId],
        ),
        app.pool.query(
          `SELECT application.id, application.application_type, application.status,
                  application.applicant_person_id, applicant.canonical_full_name AS applicant_name,
                  application.project_id, project.name AS project_name,
                  application.proposed_name, application.proposed_description,
                  application.requested_role, application.message,
                  application.review_comment, application.reviewed_at,
                  application.created_project_id, created_project.name AS created_project_name,
                  application.created_at, application.updated_at,
                  reviewer.display_name AS reviewed_by_user_name,
                  person_reviewer.canonical_full_name AS reviewed_by_person_name
             FROM project_applications application
             JOIN persons applicant ON applicant.id = application.applicant_person_id
             LEFT JOIN projects project ON project.id = application.project_id
             LEFT JOIN projects created_project ON created_project.id = application.created_project_id
             LEFT JOIN app_users reviewer ON reviewer.id = application.reviewed_by_user_id
             LEFT JOIN persons person_reviewer ON person_reviewer.id = application.reviewed_by_person_id
            WHERE application.organization_id = $1
              AND application.applicant_person_id = $2
              AND application.archived_at IS NULL
            ORDER BY application.created_at DESC`,
          [organization.id, personId],
        ),
        app.pool.query(
          `SELECT application.id, application.application_type, application.status,
                  application.applicant_person_id, applicant.canonical_full_name AS applicant_name,
                  application.project_id, project.name AS project_name,
                  application.proposed_name, application.proposed_description,
                  application.requested_role, application.message,
                  application.review_comment, application.reviewed_at,
                  application.created_project_id, NULL::text AS created_project_name,
                  application.created_at, application.updated_at,
                  NULL::text AS reviewed_by_user_name,
                  NULL::text AS reviewed_by_person_name
             FROM project_applications application
             JOIN projects project ON project.id = application.project_id
             JOIN persons applicant ON applicant.id = application.applicant_person_id
            WHERE application.organization_id = $1
              AND application.application_type = 'JOIN'
              AND application.status = 'PENDING'
              AND application.archived_at IS NULL
              AND project.lead_person_id = $2
              AND project.archived_at IS NULL
            ORDER BY application.created_at`,
          [organization.id, personId],
        ),
      ]);
      return {
        schemaVersion: 1,
        personId,
        catalog: catalog.rows.map(mapProjectContext),
        mine: mine.rows.map(mapProjectContext),
        applications: applications.rows.map(mapApplication),
        incomingApplications: incoming.rows.map(mapApplication),
      };
    },
  );

  app.post(
    '/integrations/locker/v1/project-applications',
    {
      preHandler: lockerAuth,
      schema: {
        tags: ['Интеграции', 'Проекты'],
        summary: 'Подать заявку на создание проекта или участие',
        body: Type.Object(
          {
            lockerUserId: Type.String({ format: 'uuid' }),
            telegramUserId: Type.String({ pattern: '^[0-9]+$', maxLength: 32 }),
            type: Type.Union(APPLICATION_TYPES.map((type) => Type.Literal(type))),
            projectId: Type.Optional(Type.String({ format: 'uuid' })),
            proposedName: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
            proposedDescription: Type.Optional(Type.String({ maxLength: 10_000 })),
            requestedRole: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
            message: Type.Optional(Type.String({ maxLength: 5_000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        lockerUserId: string;
        telegramUserId: string;
        type: (typeof APPLICATION_TYPES)[number];
        projectId?: string;
        proposedName?: string;
        proposedDescription?: string;
        requestedRole?: string;
        message?: string;
      };
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        const personId = await resolveIntegrationPerson(
          client,
          organization.id,
          body.lockerUserId,
          body.telegramUserId,
        );
        if (body.type === 'CREATE' && !body.proposedName?.trim()) {
          throw new HttpProblem(400, 'Укажите название проекта');
        }
        if (body.type === 'JOIN' && !body.projectId) {
          throw new HttpProblem(400, 'Выберите проект');
        }
        if (body.type === 'JOIN') {
          const project = await client.query(
            `SELECT id FROM projects
              WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
                AND visible_in_bot = true AND status IN ('IDEA', 'ACTIVE', 'PAUSED')
              FOR UPDATE`,
            [body.projectId, organization.id],
          );
          if (!project.rows[0]) throw new HttpProblem(404, 'Проект недоступен для заявок');
          const member = await client.query(
            `SELECT 1 FROM project_memberships
              WHERE project_id = $1 AND person_id = $2 AND archived_at IS NULL`,
            [body.projectId, personId],
          );
          if (member.rows[0]) throw new HttpProblem(409, 'Вы уже состоите в этом проекте');
        }
        const duplicate = await client.query(
          `SELECT id FROM project_applications
            WHERE organization_id = $1 AND applicant_person_id = $2
              AND application_type = $3 AND status = 'PENDING' AND archived_at IS NULL
              AND ($3::text = 'CREATE' OR project_id = $4)`,
          [organization.id, personId, body.type, body.projectId ?? null],
        );
        if (duplicate.rows[0]) throw new HttpProblem(409, 'Такая заявка уже ожидает решения');

        const result = await client.query(
          `INSERT INTO project_applications
             (organization_id, application_type, applicant_person_id, project_id,
              proposed_name, proposed_description, requested_role, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, application_type, status, project_id, proposed_name,
                     proposed_description, requested_role, message, created_at`,
          [
            organization.id,
            body.type,
            personId,
            body.type === 'JOIN' ? body.projectId : null,
            body.type === 'CREATE' ? cleanProjectName(body.proposedName!) : null,
            body.proposedDescription?.trim() || null,
            body.requestedRole?.trim() || (body.type === 'CREATE' ? 'Инициатор' : 'Участник'),
            body.message?.trim() || null,
          ],
        );
        await writeAudit(client, {
          actor: LOCKER_ACTOR,
          requestId: request.id,
          action: 'project.application_created',
          entityType: 'project_application',
          entityId: result.rows[0]!.id,
          after: { ...result.rows[0], applicantPersonId: personId },
        });
        return result.rows[0];
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/integrations/locker/v1/project-applications/:id/decision',
    {
      preHandler: lockerAuth,
      schema: {
        tags: ['Интеграции', 'Проекты'],
        summary: 'Решение руководителя проекта по заявке',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          {
            lockerUserId: Type.String({ format: 'uuid' }),
            telegramUserId: Type.String({ pattern: '^[0-9]+$', maxLength: 32 }),
            decision: Type.Union(REVIEW_DECISIONS.map((decision) => Type.Literal(decision))),
            comment: Type.Optional(Type.String({ maxLength: 5_000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const applicationId = (request.params as { id: string }).id;
      const body = request.body as {
        lockerUserId: string;
        telegramUserId: string;
        decision: ReviewDecision;
        comment?: string;
      };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const reviewerPersonId = await resolveIntegrationPerson(
          client,
          organization.id,
          body.lockerUserId,
          body.telegramUserId,
        );
        return reviewApplication(client, {
          organizationId: organization.id,
          applicationId,
          decision: body.decision,
          comment: body.comment?.trim() || null,
          reviewerPersonId,
          requestId: request.id,
        });
      });
    },
  );
}

function projectContextSelect(): string {
  return `SELECT project.id, project.name, project.description, project.status,
                 project.visible_in_bot, project.lead_person_id,
                 lead.canonical_full_name AS lead_person_name,
                 membership.role AS membership_role,
                 (project.lead_person_id = $2) AS is_lead,
                 (SELECT count(*) FROM project_memberships member_count
                   WHERE member_count.project_id = project.id
                     AND member_count.archived_at IS NULL)::text AS member_count,
                 (SELECT application.id FROM project_applications application
                   WHERE application.project_id = project.id
                     AND application.applicant_person_id = $2
                     AND application.application_type = 'JOIN'
                     AND application.status = 'PENDING'
                     AND application.archived_at IS NULL LIMIT 1) AS pending_join_application_id
            FROM projects project
            LEFT JOIN persons lead ON lead.id = project.lead_person_id
            LEFT JOIN LATERAL (
              SELECT candidate.role
                FROM project_memberships candidate
               WHERE candidate.project_id = project.id
                 AND candidate.person_id = $2
                 AND candidate.archived_at IS NULL
               LIMIT 1
            ) membership ON true`;
}

async function resolveIntegrationPerson(
  client: Pick<PoolClient, 'query'>,
  organizationId: string,
  lockerUserId: string,
  telegramUserId: string,
): Promise<string> {
  const result = await client.query<{ person_id: string }>(
    `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
       FROM external_identities identity
       JOIN persons person ON person.id = identity.person_id
      WHERE identity.organization_id = $1
        AND identity.archived_at IS NULL
        AND person.archived_at IS NULL
        AND ((identity.source_namespace = 'locker.user' AND identity.external_id = $2)
          OR (identity.source_namespace = 'locker.telegram' AND identity.external_id = $3))`,
    [organizationId, lockerUserId, telegramUserId],
  );
  const personIds = [...new Set(result.rows.map((row) => row.person_id))];
  if (personIds.length === 0) {
    throw new HttpProblem(404, 'Профиль ещё не синхронизирован с CRM');
  }
  if (personIds.length > 1) {
    throw new HttpProblem(409, 'Идентификаторы связаны с разными участниками CRM');
  }
  return personIds[0]!;
}

async function reviewApplication(
  client: PoolClient,
  input: {
    organizationId: string;
    applicationId: string;
    decision: ReviewDecision;
    comment: string | null;
    reviewerUser?: AuthUser;
    reviewerPersonId?: string;
    requestId: string;
  },
) {
  const result = await client.query(
    `SELECT application.*, project.owner_user_id, project.lead_person_id,
            applicant.canonical_full_name AS applicant_name
       FROM project_applications application
       JOIN persons applicant ON applicant.id = application.applicant_person_id
       LEFT JOIN projects project ON project.id = application.project_id
      WHERE application.id = $1 AND application.organization_id = $2
        AND application.archived_at IS NULL
      FOR UPDATE OF application`,
    [input.applicationId, input.organizationId],
  );
  const application = result.rows[0];
  if (!application) throw new HttpProblem(404, 'Заявка не найдена');
  if (application.status !== 'PENDING') throw new HttpProblem(409, 'По заявке уже принято решение');

  if (input.reviewerUser) {
    const isAdmin = input.reviewerUser.roles.includes(Roles.ADMIN);
    const isResponsible =
      application.application_type === 'JOIN' &&
      application.owner_user_id === input.reviewerUser.userId;
    if (!isAdmin && !isResponsible) throw new HttpProblem(403, 'Нет права решать по этой заявке');
  } else {
    if (
      application.application_type !== 'JOIN' ||
      !input.reviewerPersonId ||
      application.lead_person_id !== input.reviewerPersonId
    ) {
      throw new HttpProblem(403, 'Только руководитель проекта может принять это решение');
    }
  }

  let createdProjectId: string | null = null;
  let participantsAddedToEvents = 0;
  if (input.decision === 'APPROVED' && application.application_type === 'CREATE') {
    const project = await client.query<{ id: string }>(
      `INSERT INTO projects
         (organization_id, name, normalized_name, description, status,
          owner_user_id, lead_person_id, visible_in_bot)
       VALUES ($1, $2, $3, $4, 'IDEA', $5, $6, true)
       RETURNING id`,
      [
        input.organizationId,
        application.proposed_name,
        normalizeFullName(application.proposed_name),
        application.proposed_description,
        input.reviewerUser?.userId ?? null,
        application.applicant_person_id,
      ],
    );
    createdProjectId = project.rows[0]!.id;
    await client.query(
      `INSERT INTO project_memberships (project_id, person_id, role, data_origin)
       VALUES ($1, $2, 'Инициатор', 'LIVE')`,
      [createdProjectId, application.applicant_person_id],
    );
  }
  if (input.decision === 'APPROVED' && application.application_type === 'JOIN') {
    const restored = await client.query(
      `UPDATE project_memberships
          SET archived_at = NULL, role = $3, joined_at = now(), data_origin = 'LIVE',
              updated_at = now(), version = version + 1
        WHERE id = (
          SELECT id FROM project_memberships
           WHERE project_id = $1 AND person_id = $2 AND archived_at IS NOT NULL
           ORDER BY archived_at DESC LIMIT 1
        ) RETURNING id`,
      [application.project_id, application.applicant_person_id, application.requested_role],
    );
    if (!restored.rows[0]) {
      await client.query(
        `INSERT INTO project_memberships (project_id, person_id, role, data_origin)
         VALUES ($1, $2, $3, 'LIVE')
         ON CONFLICT (project_id, person_id) WHERE archived_at IS NULL
         DO UPDATE SET role = EXCLUDED.role, updated_at = now(),
                       version = project_memberships.version + 1`,
        [application.project_id, application.applicant_person_id, application.requested_role],
      );
    }
    participantsAddedToEvents = await addPersonToProjectEvents(
      client,
      application.project_id,
      application.applicant_person_id,
    );
  }

  const reviewed = await client.query(
    `UPDATE project_applications
        SET status = $3, reviewed_by_user_id = $4, reviewed_by_person_id = $5,
            reviewed_at = now(), review_comment = $6, created_project_id = $7,
            updated_at = now(), version = version + 1
      WHERE id = $1 AND organization_id = $2
      RETURNING id, application_type, status, project_id, created_project_id,
                reviewed_at, review_comment`,
    [
      input.applicationId,
      input.organizationId,
      input.decision,
      input.reviewerUser?.userId ?? null,
      input.reviewerPersonId ?? null,
      input.comment,
      createdProjectId,
    ],
  );
  await writeAudit(client, {
    actor: input.reviewerUser ?? LOCKER_ACTOR,
    requestId: input.requestId,
    action: 'project.application_reviewed',
    entityType: 'project_application',
    entityId: input.applicationId,
    before: { status: application.status },
    after: { ...reviewed.rows[0], participantsAddedToEvents },
    ...(input.comment ? { reason: input.comment } : {}),
  });
  return { ...reviewed.rows[0], participantsAddedToEvents };
}

async function addPersonToProjectEvents(
  client: PoolClient,
  projectId: string,
  personId: string,
): Promise<number> {
  const result = await client.query(
    `INSERT INTO event_participations (person_id, event_id, registered_at, data_origin)
     SELECT $2, participation.event_id, now(), 'LIVE'
       FROM event_project_participations participation
      WHERE participation.project_id = $1 AND participation.archived_at IS NULL
     ON CONFLICT (person_id, event_id) WHERE archived_at IS NULL DO NOTHING`,
    [projectId, personId],
  );
  return result.rowCount ?? 0;
}

function cleanProjectName(value: string): string {
  const name = normalizeUnicode(value).replace(/\s+/gu, ' ').trim();
  if (!name) throw new HttpProblem(400, 'Название проекта не может быть пустым');
  return name;
}

function mapProjectContext(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    visibleInBot: Boolean(row.visible_in_bot),
    leadPersonId: row.lead_person_id,
    leadPersonName: row.lead_person_name,
    membershipRole: row.membership_role,
    isLead: Boolean(row.is_lead),
    memberCount: Number(row.member_count),
    pendingJoinApplicationId: row.pending_join_application_id,
  };
}

function mapApplication(row: Record<string, unknown>) {
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ?? null);
  return {
    id: row.id,
    type: row.application_type,
    status: row.status,
    applicantPersonId: row.applicant_person_id,
    applicantName: row.applicant_name,
    projectId: row.project_id,
    projectName: row.project_name,
    proposedName: row.proposed_name,
    proposedDescription: row.proposed_description,
    requestedRole: row.requested_role,
    message: row.message,
    reviewComment: row.review_comment,
    reviewedAt: iso(row.reviewed_at),
    reviewedByName: row.reviewed_by_user_name ?? row.reviewed_by_person_name ?? null,
    createdProjectId: row.created_project_id,
    createdProjectName: row.created_project_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
