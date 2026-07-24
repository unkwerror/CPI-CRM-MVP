import {
  CreateDealBody,
  PatchDealBody,
  type CreateDealInput,
  type PatchDealInput,
} from '@cpi-crm/contracts';
import { Permissions, normalizeUnicode } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const idParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

const CLOSED_STATUSES = new Set(['WON', 'LOST']);

function cleanTitle(raw: string): string {
  const title = normalizeUnicode(raw).replace(/\s+/gu, ' ').trim();
  if (title.length < 2) throw new HttpProblem(400, 'Название должно содержать минимум 2 символа');
  return title;
}

export async function registerDealRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deals',
    {
      preHandler: app.requirePermission(Permissions.DEALS_READ),
      schema: {
        tags: ['Продажи'],
        querystring: Type.Object({
          status: Type.Optional(Type.String({ maxLength: 50 })),
          dealType: Type.Optional(Type.String({ maxLength: 50 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as { status?: string; dealType?: string };
      const organization = await getOrganizationContext(app.pool);
      const result = await app.pool.query(
        `SELECT d.id, d.title, d.deal_type, d.status, d.amount, d.currency,
                d.expected_close_at, d.closed_at, d.paid_at, d.paid_amount,
                d.comment, d.version, d.created_at,
                pt.id AS partner_id, pt.name AS partner_name,
                pr.name AS product_name, u.display_name AS owner_name,
                ps.id AS person_id, ps.canonical_full_name AS person_name
           FROM deals d
           LEFT JOIN partners pt ON pt.id = d.partner_id
           LEFT JOIN products pr ON pr.id = d.product_id
           LEFT JOIN app_users u ON u.id = d.owner_user_id
           LEFT JOIN persons ps ON ps.id = d.person_id
          WHERE d.organization_id = $1
            AND d.archived_at IS NULL
            AND ($2::text IS NULL OR d.status = $2::deal_status)
            AND ($3::text IS NULL OR d.deal_type = $3::deal_type)
          ORDER BY d.status IN ('LEAD', 'NEGOTIATION') DESC, d.closed_at DESC NULLS FIRST, d.created_at DESC
          LIMIT 200`,
        [organization.id, query.status ?? null, query.dealType ?? null],
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          dealType: row.deal_type,
          status: row.status,
          amount: Number(row.amount),
          currency: row.currency,
          expectedCloseAt: row.expected_close_at?.toISOString() ?? null,
          closedAt: row.closed_at?.toISOString() ?? null,
          paidAt: row.paid_at?.toISOString() ?? null,
          paidAmount: row.paid_amount === null ? null : Number(row.paid_amount),
          comment: row.comment,
          version: row.version,
          createdAt: row.created_at?.toISOString() ?? null,
          partnerId: row.partner_id,
          partnerName: row.partner_name,
          productName: row.product_name,
          ownerName: row.owner_name,
          personId: row.person_id,
          personName: row.person_name,
        })),
      };
    },
  );

  app.post(
    '/deals',
    {
      preHandler: app.requirePermission(Permissions.DEALS_WRITE),
      schema: { tags: ['Продажи'], body: CreateDealBody },
    },
    async (request, reply) => {
      const body = request.body as CreateDealInput;
      const title = cleanTitle(body.title);
      const status = body.status ?? 'LEAD';
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        if (body.partnerId) {
          const partner = await client.query(
            'SELECT 1 FROM partners WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL',
            [body.partnerId, organization.id],
          );
          if (!partner.rows[0]) throw new HttpProblem(400, 'Партнёр не найден');
        }
        if (body.agreementId) {
          const agreement = await client.query(
            'SELECT 1 FROM partner_agreements WHERE id = $1 AND partner_id = $2 AND archived_at IS NULL',
            [body.agreementId, body.partnerId ?? null],
          );
          if (!agreement.rows[0]) {
            throw new HttpProblem(400, 'Соглашение выбранного партнёра не найдено');
          }
        }
        if (body.productId) {
          const product = await client.query(
            'SELECT 1 FROM products WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL',
            [body.productId, organization.id],
          );
          if (!product.rows[0]) throw new HttpProblem(400, 'Продукт не найден');
        }
        if (body.projectId) {
          const project = await client.query(
            'SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL',
            [body.projectId, organization.id],
          );
          if (!project.rows[0]) throw new HttpProblem(400, 'Проект не найден');
        }
        if (body.personId) {
          const person = await client.query(
            'SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL AND merged_into_person_id IS NULL',
            [body.personId],
          );
          if (!person.rows[0]) throw new HttpProblem(400, 'Участник не найден');
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO deals (organization_id, partner_id, agreement_id, product_id, project_id, person_id, title, deal_type, status, amount, expected_close_at, closed_at, comment, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [
            organization.id,
            body.partnerId ?? null,
            body.agreementId ?? null,
            body.productId ?? null,
            body.projectId ?? null,
            body.personId ?? null,
            title,
            body.dealType,
            status,
            body.amount,
            body.expectedCloseAt ? new Date(body.expectedCloseAt) : null,
            CLOSED_STATUSES.has(status) ? new Date() : null,
            body.comment?.trim() || null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'deal.created',
          entityType: 'deal',
          entityId: result.rows[0]!.id,
          after: {
            title,
            dealType: body.dealType,
            status,
            amount: body.amount,
            partnerId: body.partnerId ?? null,
            productId: body.productId ?? null,
          },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/deals/:id',
    {
      preHandler: app.requirePermission(Permissions.DEALS_WRITE),
      schema: { tags: ['Продажи'], params: idParams, body: PatchDealBody },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as PatchDealInput;
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, title, status, amount, expected_close_at, closed_at,
                  paid_at, paid_amount, person_id, comment, version
             FROM deals WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new HttpProblem(404, 'Сделка не найдена');
        if (row.version !== body.version) throw new HttpProblem(409, 'Сделка уже изменена');
        const nextStatus = body.status ?? row.status;
        const nowClosed = CLOSED_STATUSES.has(nextStatus);
        if (body.personId) {
          const person = await client.query(
            'SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL AND merged_into_person_id IS NULL',
            [body.personId],
          );
          if (!person.rows[0]) throw new HttpProblem(400, 'Участник не найден');
        }
        // Оплата: paid_at и paid_amount меняются вместе (выручка «по факту оплаты»).
        const paidTouched = body.paidAt !== undefined || body.paidAmount !== undefined;
        let nextPaidAt: Date | null = row.paid_at;
        let nextPaidAmount: number | null =
          row.paid_amount === null ? null : Number(row.paid_amount);
        if (paidTouched) {
          if (body.paidAt === null) {
            nextPaidAt = null;
            nextPaidAmount = null;
          } else {
            nextPaidAt = body.paidAt !== undefined ? new Date(body.paidAt) : (row.paid_at ?? new Date());
            nextPaidAmount =
              body.paidAmount !== undefined && body.paidAmount !== null
                ? body.paidAmount
                : (nextPaidAmount ?? Number(body.amount ?? row.amount));
          }
        }
        const updated = await client.query(
          `UPDATE deals
              SET title = COALESCE($2, title),
                  status = $3,
                  amount = CASE WHEN $4::boolean THEN $5 ELSE amount END,
                  expected_close_at = CASE WHEN $6::boolean THEN $7 ELSE expected_close_at END,
                  comment = CASE WHEN $8::boolean THEN $9 ELSE comment END,
                  closed_at = CASE WHEN $10::boolean AND closed_at IS NULL THEN now()
                                   WHEN NOT $10::boolean THEN NULL
                                   ELSE closed_at END,
                  paid_at = CASE WHEN $11::boolean THEN $12 ELSE paid_at END,
                  paid_amount = CASE WHEN $11::boolean THEN $13 ELSE paid_amount END,
                  person_id = CASE WHEN $14::boolean THEN $15 ELSE person_id END,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, title, status, amount, expected_close_at, closed_at, paid_at, paid_amount, person_id, comment, version`,
          [
            id,
            body.title === undefined ? null : cleanTitle(body.title),
            nextStatus,
            body.amount !== undefined,
            body.amount ?? null,
            body.expectedCloseAt !== undefined,
            body.expectedCloseAt ? new Date(body.expectedCloseAt) : null,
            body.comment !== undefined,
            body.comment?.trim() || null,
            nowClosed,
            paidTouched,
            nextPaidAt,
            nextPaidAmount,
            body.personId !== undefined,
            body.personId ?? null,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'deal.updated',
          entityType: 'deal',
          entityId: id,
          before: row,
          after: updated.rows[0],
        });
        return updated.rows[0];
      });
    },
  );
}
