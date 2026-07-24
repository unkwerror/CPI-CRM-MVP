import {
  CreateExpenseBody,
  PatchExpenseBody,
  type CreateExpenseInput,
  type PatchExpenseInput,
} from '@cpi-crm/contracts';
import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const idParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

type LinkColumn = 'event_id' | 'product_id' | 'deal_id' | 'project_id';

const LINK_CHECKS: readonly {
  key: 'eventId' | 'productId' | 'dealId' | 'projectId';
  column: LinkColumn;
  table: string;
  message: string;
}[] = [
  { key: 'eventId', column: 'event_id', table: 'events', message: 'Мероприятие не найдено' },
  { key: 'productId', column: 'product_id', table: 'products', message: 'Продукт не найден' },
  { key: 'dealId', column: 'deal_id', table: 'deals', message: 'Сделка не найдена' },
  { key: 'projectId', column: 'project_id', table: 'projects', message: 'Проект не найден' },
];

async function assertLinkExists(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> },
  table: string,
  id: string,
  message: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  if (!result.rows[0]) throw new HttpProblem(400, message);
}

/**
 * Расходы ЦПИ. Правило из документа метрик: расход привязан хотя бы к одному
 * уровню — периоду (дата обязательна), мероприятию, продукту, сделке или проекту.
 * Категории: переменные, операционные, бэк-офис, привлечение, активация.
 */
export async function registerExpenseRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/expenses',
    {
      preHandler: app.requirePermission(Permissions.EXPENSES_READ),
      schema: {
        tags: ['Расходы'],
        querystring: Type.Object({
          from: Type.Optional(Type.String({ format: 'date-time' })),
          to: Type.Optional(Type.String({ format: 'date-time' })),
          category: Type.Optional(Type.String({ maxLength: 30 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as { from?: string; to?: string; category?: string };
      const organization = await getOrganizationContext(app.pool);
      const [rows, totals] = await Promise.all([
        app.pool.query(
          `SELECT e.id, e.category, e.amount, e.currency, e.occurred_at, e.description,
                  e.version, e.created_at,
                  ev.id AS event_id, ev.name AS event_name,
                  pr.id AS product_id, pr.name AS product_name,
                  d.id AS deal_id, d.title AS deal_title,
                  pj.id AS project_id, pj.name AS project_name,
                  u.display_name AS owner_name
             FROM expenses e
             LEFT JOIN events ev ON ev.id = e.event_id
             LEFT JOIN products pr ON pr.id = e.product_id
             LEFT JOIN deals d ON d.id = e.deal_id
             LEFT JOIN projects pj ON pj.id = e.project_id
             LEFT JOIN app_users u ON u.id = e.owner_user_id
            WHERE e.organization_id = $1
              AND e.archived_at IS NULL
              AND ($2::timestamptz IS NULL OR e.occurred_at >= $2)
              AND ($3::timestamptz IS NULL OR e.occurred_at < $3)
              AND ($4::text IS NULL OR e.category = $4::expense_category)
            ORDER BY e.occurred_at DESC, e.created_at DESC
            LIMIT 500`,
          [organization.id, query.from ?? null, query.to ?? null, query.category ?? null],
        ),
        app.pool.query<{ category: string; total: string }>(
          `SELECT category, COALESCE(sum(amount), 0)::text AS total
             FROM expenses
            WHERE organization_id = $1
              AND archived_at IS NULL
              AND ($2::timestamptz IS NULL OR occurred_at >= $2)
              AND ($3::timestamptz IS NULL OR occurred_at < $3)
            GROUP BY category`,
          [organization.id, query.from ?? null, query.to ?? null],
        ),
      ]);
      return {
        items: rows.rows.map((row) => ({
          id: row.id,
          category: row.category,
          amount: Number(row.amount),
          currency: row.currency,
          occurredAt: row.occurred_at?.toISOString() ?? null,
          description: row.description,
          version: row.version,
          createdAt: row.created_at?.toISOString() ?? null,
          eventId: row.event_id,
          eventName: row.event_name,
          productId: row.product_id,
          productName: row.product_name,
          dealId: row.deal_id,
          dealTitle: row.deal_title,
          projectId: row.project_id,
          projectName: row.project_name,
          ownerName: row.owner_name,
        })),
        totalsByCategory: Object.fromEntries(
          totals.rows.map((row) => [row.category, Number(row.total)]),
        ),
      };
    },
  );

  app.post(
    '/expenses',
    {
      preHandler: app.requirePermission(Permissions.EXPENSES_WRITE),
      schema: { tags: ['Расходы'], body: CreateExpenseBody },
    },
    async (request, reply) => {
      const body = request.body as CreateExpenseInput;
      const description = body.description.replace(/\s+/gu, ' ').trim();
      if (description.length < 2) {
        throw new HttpProblem(400, 'Опишите расход (минимум 2 символа)');
      }
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        for (const link of LINK_CHECKS) {
          const value = body[link.key];
          if (value) await assertLinkExists(client, link.table, value, link.message);
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO expenses (organization_id, category, amount, occurred_at, description, event_id, product_id, deal_id, project_id, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            organization.id,
            body.category,
            body.amount,
            new Date(body.occurredAt),
            description,
            body.eventId ?? null,
            body.productId ?? null,
            body.dealId ?? null,
            body.projectId ?? null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'expense.created',
          entityType: 'expense',
          entityId: result.rows[0]!.id,
          after: {
            category: body.category,
            amount: body.amount,
            occurredAt: body.occurredAt,
            description,
          },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/expenses/:id',
    {
      preHandler: app.requirePermission(Permissions.EXPENSES_WRITE),
      schema: { tags: ['Расходы'], params: idParams, body: PatchExpenseBody },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as PatchExpenseInput;
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, category, amount, occurred_at, description, event_id, product_id,
                  deal_id, project_id, version
             FROM expenses WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new HttpProblem(404, 'Расход не найден');
        if (row.version !== body.version) throw new HttpProblem(409, 'Расход уже изменён');
        for (const link of LINK_CHECKS) {
          const value = body[link.key];
          if (value) await assertLinkExists(client, link.table, value, link.message);
        }
        const description =
          body.description === undefined
            ? null
            : body.description.replace(/\s+/gu, ' ').trim();
        if (description !== null && description.length < 2) {
          throw new HttpProblem(400, 'Опишите расход (минимум 2 символа)');
        }
        const updated = await client.query(
          `UPDATE expenses
              SET category = COALESCE($2::expense_category, category),
                  amount = COALESCE($3, amount),
                  occurred_at = COALESCE($4, occurred_at),
                  description = COALESCE($5, description),
                  event_id = CASE WHEN $6::boolean THEN $7 ELSE event_id END,
                  product_id = CASE WHEN $8::boolean THEN $9 ELSE product_id END,
                  deal_id = CASE WHEN $10::boolean THEN $11 ELSE deal_id END,
                  project_id = CASE WHEN $12::boolean THEN $13 ELSE project_id END,
                  archived_at = CASE WHEN $14::boolean THEN now() ELSE archived_at END,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, category, amount, occurred_at, description, version, archived_at`,
          [
            id,
            body.category ?? null,
            body.amount ?? null,
            body.occurredAt ? new Date(body.occurredAt) : null,
            description,
            body.eventId !== undefined,
            body.eventId ?? null,
            body.productId !== undefined,
            body.productId ?? null,
            body.dealId !== undefined,
            body.dealId ?? null,
            body.projectId !== undefined,
            body.projectId ?? null,
            body.archive === true,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: body.archive === true ? 'expense.archived' : 'expense.updated',
          entityType: 'expense',
          entityId: id,
          before: row,
          after: updated.rows[0],
        });
        return updated.rows[0];
      });
    },
  );
}
