import {
  CreateProductBody,
  PatchProductBody,
  type CreateProductInput,
  type PatchProductInput,
} from '@cpi-crm/contracts';
import { Permissions, normalizeFullName, normalizeUnicode } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const idParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

function cleanName(raw: string): string {
  const name = normalizeUnicode(raw).replace(/\s+/gu, ' ').trim();
  if (name.length < 2) throw new HttpProblem(400, 'Название должно содержать минимум 2 символа');
  return name;
}

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/products',
    {
      preHandler: app.requirePermission(Permissions.PRODUCTS_READ),
      schema: {
        tags: ['Продукты'],
        querystring: Type.Object({
          status: Type.Optional(Type.String({ maxLength: 50 })),
        }),
      },
    },
    async (request) => {
      const status = (request.query as { status?: string }).status;
      const organization = await getOrganizationContext(app.pool);
      const result = await app.pool.query(
        `SELECT p.id, p.name, p.description, p.delivery_model, p.documentation_url, p.status,
                p.price, p.closed_at, p.close_reason, p.version, u.display_name AS owner_name,
                (SELECT count(*) FROM deals d
                  WHERE d.product_id = p.id AND d.archived_at IS NULL) AS deal_count,
                (SELECT COALESCE(sum(d.amount), 0) FROM deals d
                  WHERE d.product_id = p.id AND d.status = 'WON' AND d.archived_at IS NULL) AS won_amount
           FROM products p
           LEFT JOIN app_users u ON u.id = p.owner_user_id
          WHERE p.organization_id = $1
            AND p.archived_at IS NULL
            AND ($2::text IS NULL OR p.status = $2::product_status)
          ORDER BY p.status = 'ON_SALE' DESC, p.name
          LIMIT 200`,
        [organization.id, status ?? null],
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          deliveryModel: row.delivery_model,
          documentationUrl: row.documentation_url,
          status: row.status,
          price: row.price === null ? null : Number(row.price),
          closedAt: row.closed_at?.toISOString() ?? null,
          closeReason: row.close_reason,
          version: row.version,
          ownerName: row.owner_name,
          dealCount: Number(row.deal_count),
          wonAmount: Number(row.won_amount),
        })),
      };
    },
  );

  app.post(
    '/products',
    {
      preHandler: app.requirePermission(Permissions.PRODUCTS_WRITE),
      schema: { tags: ['Продукты'], body: CreateProductBody },
    },
    async (request, reply) => {
      const body = request.body as CreateProductInput;
      const name = cleanName(body.name);
      const normalizedName = normalizeFullName(name);
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `cpi-product:${organization.id}:${normalizedName}`,
        ]);
        const duplicate = await client.query(
          `SELECT 1 FROM products
            WHERE organization_id = $1 AND normalized_name = $2 AND archived_at IS NULL LIMIT 1`,
          [organization.id, normalizedName],
        );
        if (duplicate.rows[0]) {
          throw new HttpProblem(409, 'Продукт с таким названием уже существует');
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO products (organization_id, name, normalized_name, description, delivery_model, documentation_url, status, price, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            organization.id,
            name,
            normalizedName,
            body.description?.trim() || null,
            body.deliveryModel?.trim() || null,
            body.documentationUrl?.trim() || null,
            body.status ?? 'IDEA',
            body.price ?? null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'product.created',
          entityType: 'product',
          entityId: result.rows[0]!.id,
          after: { name, status: body.status ?? 'IDEA', price: body.price ?? null },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/products/:id',
    {
      preHandler: app.requirePermission(Permissions.PRODUCTS_WRITE),
      schema: { tags: ['Продукты'], params: idParams, body: PatchProductBody },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as PatchProductInput;
      if (body.status === 'CLOSED' && !body.closeReason) {
        throw new HttpProblem(
          400,
          'Укажите причину закрытия',
          'Продукт, который не продаётся, закрывается с зафиксированной причиной.',
        );
      }
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, organization_id, name, description, delivery_model, documentation_url,
                  status, price, closed_at, close_reason, version
             FROM products WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new HttpProblem(404, 'Продукт не найден');
        if (row.version !== body.version) throw new HttpProblem(409, 'Продукт уже изменён');
        const name = body.name === undefined ? row.name : cleanName(body.name);
        const normalizedName = normalizeFullName(name);
        if (body.name !== undefined && normalizedName !== normalizeFullName(row.name)) {
          const duplicate = await client.query(
            `SELECT 1 FROM products
              WHERE organization_id = $1 AND normalized_name = $2 AND id <> $3 AND archived_at IS NULL LIMIT 1`,
            [row.organization_id, normalizedName, id],
          );
          if (duplicate.rows[0]) {
            throw new HttpProblem(409, 'Продукт с таким названием уже существует');
          }
        }
        const closing = body.status === 'CLOSED' && row.status !== 'CLOSED';
        const reopening = body.status !== undefined && body.status !== 'CLOSED';
        const updated = await client.query(
          `UPDATE products
              SET name = $2, normalized_name = $3,
                  description = CASE WHEN $4::boolean THEN $5 ELSE description END,
                  delivery_model = CASE WHEN $6::boolean THEN $7 ELSE delivery_model END,
                  documentation_url = CASE WHEN $8::boolean THEN $9 ELSE documentation_url END,
                  status = COALESCE($10, status),
                  price = CASE WHEN $11::boolean THEN $12 ELSE price END,
                  closed_at = CASE WHEN $13::boolean THEN now() WHEN $14::boolean THEN NULL ELSE closed_at END,
                  close_reason = CASE WHEN $13::boolean THEN $15 WHEN $14::boolean THEN NULL ELSE close_reason END,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, name, status, price, closed_at, close_reason, version`,
          [
            id,
            name,
            normalizedName,
            body.description !== undefined,
            body.description?.trim() || null,
            body.deliveryModel !== undefined,
            body.deliveryModel?.trim() || null,
            body.documentationUrl !== undefined,
            body.documentationUrl?.trim() || null,
            body.status ?? null,
            body.price !== undefined,
            body.price ?? null,
            closing,
            reopening,
            body.closeReason?.trim() || null,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: closing ? 'product.closed' : 'product.updated',
          entityType: 'product',
          entityId: id,
          before: row,
          after: updated.rows[0],
          ...(closing ? { reason: body.closeReason } : {}),
        });
        return updated.rows[0];
      });
    },
  );
}
