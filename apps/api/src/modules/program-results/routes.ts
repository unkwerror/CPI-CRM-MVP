import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const ProgramCodeSchema = Type.Union([Type.Literal('SVYA'), Type.Literal('BI_ACADEMPARK')]);

const ProgramStatusSchema = Type.Union([
  Type.Literal('PLANNED'),
  Type.Literal('APPLIED'),
  Type.Literal('INTERVIEW'),
  Type.Literal('PARTICIPATED'),
  Type.Literal('FINALIST'),
  Type.Literal('WINNER'),
  Type.Literal('RESIDENT'),
  Type.Literal('NOT_SELECTED'),
  Type.Literal('REJECTED'),
  Type.Literal('WITHDRAWN'),
]);

type ProgramCode = 'SVYA' | 'BI_ACADEMPARK';
type ProgramStatus =
  | 'PLANNED'
  | 'APPLIED'
  | 'INTERVIEW'
  | 'PARTICIPATED'
  | 'FINALIST'
  | 'WINNER'
  | 'RESIDENT'
  | 'NOT_SELECTED'
  | 'REJECTED'
  | 'WITHDRAWN';

const allowedStatuses: Readonly<Record<ProgramCode, ReadonlySet<ProgramStatus>>> = {
  SVYA: new Set(['PLANNED', 'PARTICIPATED', 'FINALIST', 'WINNER', 'NOT_SELECTED', 'WITHDRAWN']),
  BI_ACADEMPARK: new Set(['PLANNED', 'APPLIED', 'INTERVIEW', 'RESIDENT', 'REJECTED', 'WITHDRAWN']),
};

export async function registerProgramResultRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/people/:id/program-results',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Участники'],
        summary: 'Результаты участия в СВЯ и отборе резидентов БИ Академпарка',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const organization = await getOrganizationContext(app.pool);
      const personId = await canonicalPersonId(
        app,
        (request.params as { id: string }).id,
        organization.id,
      );
      const rows = await app.pool.query(
        `SELECT DISTINCT ON (result.program_code)
                result.id, result.program_code, result.status, result.result,
                result.occurred_at, result.version, result.created_at, result.updated_at,
                author.display_name AS recorded_by_name
           FROM person_program_results result
           LEFT JOIN app_users author ON author.id = result.recorded_by_user_id
          WHERE result.person_id IN (
                  SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
                )
            AND result.archived_at IS NULL
          ORDER BY result.program_code, result.updated_at DESC, result.id DESC`,
        [personId],
      );
      return {
        items: rows.rows.map((row) => ({
          id: row.id,
          programCode: row.program_code,
          status: row.status,
          result: row.result,
          occurredAt: row.occurred_at?.toISOString() ?? null,
          version: row.version,
          recordedByName: row.recorded_by_name,
          updatedAt: row.updated_at.toISOString(),
        })),
      };
    },
  );

  app.put(
    '/people/:id/program-results/:programCode',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Участники'],
        summary: 'Зафиксировать или обновить результат внешней программы',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          programCode: ProgramCodeSchema,
        }),
        body: Type.Object(
          {
            status: ProgramStatusSchema,
            result: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
            occurredAt: Type.Optional(
              Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { id, programCode } = request.params as { id: string; programCode: ProgramCode };
      const body = request.body as {
        status: ProgramStatus;
        result?: string | null;
        occurredAt?: string | null;
      };
      if (!allowedStatuses[programCode].has(body.status)) {
        throw new HttpProblem(400, 'Статус не подходит выбранной программе');
      }
      const cleanResult = body.result?.trim() || null;
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const person = await client.query<{ id: string }>(
          `SELECT canonical.id
             FROM persons requested
             JOIN persons canonical
               ON canonical.id = COALESCE(requested.merged_into_person_id, requested.id)
            WHERE requested.id = $1 AND requested.organization_id = $2
              AND requested.archived_at IS NULL AND canonical.archived_at IS NULL
            FOR UPDATE OF canonical`,
          [id, organization.id],
        );
        const personId = person.rows[0]?.id;
        if (!personId) throw new HttpProblem(404, 'Участник не найден');
        const current = await client.query(
          `SELECT id, status, result, occurred_at, version
             FROM person_program_results
            WHERE person_id = $1 AND program_code = $2 AND archived_at IS NULL
            FOR UPDATE`,
          [personId, programCode],
        );
        const saved = await client.query(
          `INSERT INTO person_program_results
             (person_id, program_code, status, result, occurred_at, recorded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (person_id, program_code) WHERE archived_at IS NULL
           DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result,
                         occurred_at = EXCLUDED.occurred_at,
                         recorded_by_user_id = EXCLUDED.recorded_by_user_id,
                         version = person_program_results.version + 1, updated_at = now()
           RETURNING id, version, updated_at`,
          [
            personId,
            programCode,
            body.status,
            cleanResult,
            body.occurredAt ? new Date(body.occurredAt) : null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: current.rows[0]
            ? 'person_program_result.updated'
            : 'person_program_result.created',
          entityType: 'person_program_result',
          entityId: saved.rows[0]!.id,
          before: current.rows[0]
            ? {
                status: current.rows[0].status,
                result: current.rows[0].result,
                occurredAt: current.rows[0].occurred_at?.toISOString() ?? null,
              }
            : undefined,
          after: {
            personId,
            programCode,
            status: body.status,
            result: cleanResult,
            occurredAt: body.occurredAt ?? null,
          },
        });
        return {
          id: saved.rows[0]!.id,
          programCode,
          status: body.status,
          result: cleanResult,
          occurredAt: body.occurredAt ?? null,
          version: saved.rows[0]!.version,
          updatedAt: saved.rows[0]!.updated_at.toISOString(),
        };
      });
    },
  );

  app.delete(
    '/people/:id/program-results/:programCode',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_WRITE),
      schema: {
        tags: ['Участники'],
        summary: 'Убрать ошибочно внесённый результат без удаления истории',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          programCode: ProgramCodeSchema,
        }),
      },
    },
    async (request, reply) => {
      const { id, programCode } = request.params as { id: string; programCode: ProgramCode };
      const organization = await getOrganizationContext(app.pool);
      const personId = await canonicalPersonId(app, id, organization.id);
      await transaction(app.pool, async (client) => {
        const archived = await client.query<{ id: string }>(
          `UPDATE person_program_results
              SET archived_at = now(), updated_at = now(), version = version + 1
            WHERE person_id IN (
                    SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
                  )
              AND program_code = $2 AND archived_at IS NULL
            RETURNING id`,
          [personId, programCode],
        );
        if (!archived.rows[0]) throw new HttpProblem(404, 'Результат не найден');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'person_program_result.archived',
          entityType: 'person_program_result',
          entityId: archived.rows[0].id,
          after: { personId, programCode, archived: true },
        });
      });
      return reply.code(204).send();
    },
  );
}

async function canonicalPersonId(
  app: FastifyInstance,
  requestedId: string,
  organizationId: string,
): Promise<string> {
  const result = await app.pool.query<{ id: string }>(
    `SELECT COALESCE(merged_into_person_id, id) AS id
       FROM persons
      WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
    [requestedId, organizationId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new HttpProblem(404, 'Участник не найден');
  return id;
}
