import {
  CreatePartnerAgreementBody,
  CreatePartnerBody,
  CreatePartnerContactBody,
  CreatePartnerInteractionBody,
  PatchPartnerAgreementBody,
  PatchPartnerBody,
  type CreatePartnerAgreementInput,
  type CreatePartnerContactInput,
  type CreatePartnerInput,
  type CreatePartnerInteractionInput,
  type PatchPartnerAgreementInput,
  type PatchPartnerInput,
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

export async function registerPartnerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/partners',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_READ),
      schema: {
        tags: ['Партнёры'],
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 500 })),
          status: Type.Optional(Type.String({ maxLength: 50 })),
          kind: Type.Optional(Type.String({ maxLength: 50 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as { q?: string; status?: string; kind?: string };
      const organization = await getOrganizationContext(app.pool);
      const result = await app.pool.query(
        `SELECT pt.id, pt.name, pt.kind, pt.status, pt.inn, pt.website, pt.version,
                u.display_name AS owner_name,
                (SELECT count(*) FROM partner_agreements pa
                  WHERE pa.partner_id = pt.id AND pa.status = 'ACTIVE' AND pa.archived_at IS NULL) AS active_agreements,
                (SELECT count(*) FROM partner_contacts pc
                  WHERE pc.partner_id = pt.id AND pc.archived_at IS NULL) AS contact_count,
                (SELECT max(pi.occurred_at) FROM partner_interactions pi
                  WHERE pi.partner_id = pt.id AND pi.archived_at IS NULL) AS last_interaction_at,
                (SELECT COALESCE(sum(d.amount), 0) FROM deals d
                  WHERE d.partner_id = pt.id AND d.status = 'WON' AND d.archived_at IS NULL) AS won_amount
           FROM partners pt
           LEFT JOIN app_users u ON u.id = pt.owner_user_id
          WHERE pt.organization_id = $1
            AND pt.archived_at IS NULL
            AND ($2::text IS NULL OR pt.normalized_name LIKE '%' || $2 || '%')
            AND ($3::text IS NULL OR pt.status = $3::partner_status)
            AND ($4::text IS NULL OR pt.kind = $4::partner_kind)
          ORDER BY pt.status = 'ACTIVE' DESC, last_interaction_at DESC NULLS LAST, pt.name
          LIMIT 200`,
        [
          organization.id,
          query.q ? normalizeFullName(query.q) : null,
          query.status ?? null,
          query.kind ?? null,
        ],
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          status: row.status,
          inn: row.inn,
          website: row.website,
          version: row.version,
          ownerName: row.owner_name,
          activeAgreements: Number(row.active_agreements),
          contactCount: Number(row.contact_count),
          lastInteractionAt: row.last_interaction_at?.toISOString() ?? null,
          wonAmount: Number(row.won_amount),
        })),
      };
    },
  );

  app.post(
    '/partners',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_WRITE),
      schema: { tags: ['Партнёры'], body: CreatePartnerBody },
    },
    async (request, reply) => {
      const body = request.body as CreatePartnerInput;
      const name = cleanName(body.name);
      const normalizedName = normalizeFullName(name);
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `cpi-partner:${organization.id}:${normalizedName}`,
        ]);
        const duplicate = await client.query(
          `SELECT 1 FROM partners
            WHERE organization_id = $1 AND normalized_name = $2 AND archived_at IS NULL LIMIT 1`,
          [organization.id, normalizedName],
        );
        if (duplicate.rows[0]) {
          throw new HttpProblem(409, 'Партнёр с таким названием уже существует');
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO partners (organization_id, name, normalized_name, kind, status, inn, website, notes, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            organization.id,
            name,
            normalizedName,
            body.kind ?? 'OTHER',
            body.status ?? 'PROSPECT',
            body.inn?.trim() || null,
            body.website?.trim() || null,
            body.notes?.trim() || null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'partner.created',
          entityType: 'partner',
          entityId: result.rows[0]!.id,
          after: { name, kind: body.kind ?? 'OTHER', status: body.status ?? 'PROSPECT' },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );

  app.get(
    '/partners/:id',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_READ),
      schema: { tags: ['Партнёры'], params: idParams },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const partner = await app.pool.query(
        `SELECT pt.id, pt.name, pt.kind, pt.status, pt.inn, pt.website, pt.notes, pt.version,
                pt.created_at, u.display_name AS owner_name
           FROM partners pt
           LEFT JOIN app_users u ON u.id = pt.owner_user_id
          WHERE pt.id = $1 AND pt.archived_at IS NULL`,
        [id],
      );
      if (!partner.rows[0]) throw new HttpProblem(404, 'Партнёр не найден');
      const [contacts, agreements, interactions, partnerDeals] = await Promise.all([
        app.pool.query(
          `SELECT id, full_name, position, is_decision_maker, email, phone, telegram, notes
             FROM partner_contacts
            WHERE partner_id = $1 AND archived_at IS NULL
            ORDER BY is_decision_maker DESC, full_name`,
          [id],
        ),
        app.pool.query(
          `SELECT id, title, agreement_type, status, amount, signed_at, starts_at, ends_at, comment, version
             FROM partner_agreements
            WHERE partner_id = $1 AND archived_at IS NULL
            ORDER BY status = 'ACTIVE' DESC, created_at DESC`,
          [id],
        ),
        app.pool.query(
          `SELECT pi.id, pi.channel, pi.direction, pi.occurred_at, pi.outcome, pi.comment,
                  pc.full_name AS contact_name, u.display_name AS author_name
             FROM partner_interactions pi
             LEFT JOIN partner_contacts pc ON pc.id = pi.contact_id
             LEFT JOIN app_users u ON u.id = pi.created_by_user_id
            WHERE pi.partner_id = $1 AND pi.archived_at IS NULL
            ORDER BY pi.occurred_at DESC
            LIMIT 100`,
          [id],
        ),
        app.pool.query(
          `SELECT d.id, d.title, d.deal_type, d.status, d.amount, d.closed_at, pr.name AS product_name
             FROM deals d
             LEFT JOIN products pr ON pr.id = d.product_id
            WHERE d.partner_id = $1 AND d.archived_at IS NULL
            ORDER BY d.created_at DESC
            LIMIT 100`,
          [id],
        ),
      ]);
      const row = partner.rows[0];
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        status: row.status,
        inn: row.inn,
        website: row.website,
        notes: row.notes,
        version: row.version,
        ownerName: row.owner_name,
        createdAt: row.created_at?.toISOString() ?? null,
        contacts: contacts.rows.map((contact) => ({
          id: contact.id,
          fullName: contact.full_name,
          position: contact.position,
          isDecisionMaker: contact.is_decision_maker,
          email: contact.email,
          phone: contact.phone,
          telegram: contact.telegram,
          notes: contact.notes,
        })),
        agreements: agreements.rows.map((agreement) => ({
          id: agreement.id,
          title: agreement.title,
          agreementType: agreement.agreement_type,
          status: agreement.status,
          amount: agreement.amount === null ? null : Number(agreement.amount),
          signedAt: agreement.signed_at?.toISOString() ?? null,
          startsAt: agreement.starts_at?.toISOString() ?? null,
          endsAt: agreement.ends_at?.toISOString() ?? null,
          comment: agreement.comment,
          version: agreement.version,
        })),
        interactions: interactions.rows.map((interaction) => ({
          id: interaction.id,
          channel: interaction.channel,
          direction: interaction.direction,
          occurredAt: interaction.occurred_at.toISOString(),
          outcome: interaction.outcome,
          comment: interaction.comment,
          contactName: interaction.contact_name,
          authorName: interaction.author_name,
        })),
        deals: partnerDeals.rows.map((deal) => ({
          id: deal.id,
          title: deal.title,
          dealType: deal.deal_type,
          status: deal.status,
          amount: Number(deal.amount),
          closedAt: deal.closed_at?.toISOString() ?? null,
          productName: deal.product_name,
        })),
      };
    },
  );

  app.patch(
    '/partners/:id',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_WRITE),
      schema: { tags: ['Партнёры'], params: idParams, body: PatchPartnerBody },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as PatchPartnerInput;
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, organization_id, name, kind, status, inn, website, notes, version
             FROM partners WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new HttpProblem(404, 'Партнёр не найден');
        if (row.version !== body.version) throw new HttpProblem(409, 'Карточка уже изменена');
        const name = body.name === undefined ? row.name : cleanName(body.name);
        const normalizedName = normalizeFullName(name);
        if (body.name !== undefined && normalizedName !== normalizeFullName(row.name)) {
          const duplicate = await client.query(
            `SELECT 1 FROM partners
              WHERE organization_id = $1 AND normalized_name = $2 AND id <> $3 AND archived_at IS NULL LIMIT 1`,
            [row.organization_id, normalizedName, id],
          );
          if (duplicate.rows[0]) {
            throw new HttpProblem(409, 'Партнёр с таким названием уже существует');
          }
        }
        const updated = await client.query(
          `UPDATE partners
              SET name = $2, normalized_name = $3,
                  kind = COALESCE($4, kind),
                  status = COALESCE($5, status),
                  inn = CASE WHEN $6::boolean THEN $7 ELSE inn END,
                  website = CASE WHEN $8::boolean THEN $9 ELSE website END,
                  notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, name, kind, status, inn, website, notes, version`,
          [
            id,
            name,
            normalizedName,
            body.kind ?? null,
            body.status ?? null,
            body.inn !== undefined,
            body.inn?.trim() || null,
            body.website !== undefined,
            body.website?.trim() || null,
            body.notes !== undefined,
            body.notes?.trim() || null,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'partner.updated',
          entityType: 'partner',
          entityId: id,
          before: row,
          after: updated.rows[0],
        });
        return updated.rows[0];
      });
    },
  );

  app.post(
    '/partners/:id/contacts',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_WRITE),
      schema: { tags: ['Партнёры'], params: idParams, body: CreatePartnerContactBody },
    },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as CreatePartnerContactInput;
      const created = await transaction(app.pool, async (client) => {
        const partner = await client.query(
          'SELECT 1 FROM partners WHERE id = $1 AND archived_at IS NULL',
          [id],
        );
        if (!partner.rows[0]) throw new HttpProblem(404, 'Партнёр не найден');
        const result = await client.query<{ id: string }>(
          `INSERT INTO partner_contacts (partner_id, full_name, position, is_decision_maker, email, phone, telegram, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            id,
            cleanName(body.fullName),
            body.position?.trim() || null,
            body.isDecisionMaker ?? false,
            body.email?.trim() || null,
            body.phone?.trim() || null,
            body.telegram?.trim() || null,
            body.notes?.trim() || null,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'partner_contact.created',
          entityType: 'partner_contact',
          entityId: result.rows[0]!.id,
          after: { partnerId: id, fullName: body.fullName, isDecisionMaker: body.isDecisionMaker },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/partners/:id/agreements',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_WRITE),
      schema: { tags: ['Партнёры'], params: idParams, body: CreatePartnerAgreementBody },
    },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as CreatePartnerAgreementInput;
      const startsAt = body.startsAt ? new Date(body.startsAt) : null;
      const endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (startsAt && endsAt && endsAt <= startsAt) {
        throw new HttpProblem(400, 'Дата окончания должна быть позже начала');
      }
      const created = await transaction(app.pool, async (client) => {
        const partner = await client.query(
          'SELECT 1 FROM partners WHERE id = $1 AND archived_at IS NULL',
          [id],
        );
        if (!partner.rows[0]) throw new HttpProblem(404, 'Партнёр не найден');
        const result = await client.query<{ id: string }>(
          `INSERT INTO partner_agreements (partner_id, title, agreement_type, status, amount, signed_at, starts_at, ends_at, comment, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            id,
            cleanName(body.title),
            body.agreementType,
            body.status ?? 'DRAFT',
            body.amount ?? null,
            body.signedAt ? new Date(body.signedAt) : null,
            startsAt,
            endsAt,
            body.comment?.trim() || null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'partner_agreement.created',
          entityType: 'partner_agreement',
          entityId: result.rows[0]!.id,
          after: {
            partnerId: id,
            title: body.title,
            agreementType: body.agreementType,
            status: body.status ?? 'DRAFT',
            amount: body.amount ?? null,
          },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/partner-agreements/:id',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_WRITE),
      schema: { tags: ['Партнёры'], params: idParams, body: PatchPartnerAgreementBody },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as PatchPartnerAgreementInput;
      return transaction(app.pool, async (client) => {
        const current = await client.query(
          `SELECT id, status, amount, comment, version FROM partner_agreements
            WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new HttpProblem(404, 'Соглашение не найдено');
        if (row.version !== body.version) throw new HttpProblem(409, 'Соглашение уже изменено');
        const updated = await client.query(
          `UPDATE partner_agreements
              SET status = COALESCE($2, status),
                  amount = CASE WHEN $3::boolean THEN $4 ELSE amount END,
                  comment = CASE WHEN $5::boolean THEN $6 ELSE comment END,
                  version = version + 1, updated_at = now()
            WHERE id = $1
            RETURNING id, status, amount, comment, version`,
          [
            id,
            body.status ?? null,
            body.amount !== undefined,
            body.amount ?? null,
            body.comment !== undefined,
            body.comment?.trim() || null,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'partner_agreement.updated',
          entityType: 'partner_agreement',
          entityId: id,
          before: row,
          after: updated.rows[0],
        });
        return updated.rows[0];
      });
    },
  );

  app.post(
    '/partners/:id/interactions',
    {
      preHandler: app.requirePermission(Permissions.PARTNERS_WRITE),
      schema: { tags: ['Партнёры'], params: idParams, body: CreatePartnerInteractionBody },
    },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as CreatePartnerInteractionInput;
      const created = await transaction(app.pool, async (client) => {
        const partner = await client.query(
          'SELECT 1 FROM partners WHERE id = $1 AND archived_at IS NULL',
          [id],
        );
        if (!partner.rows[0]) throw new HttpProblem(404, 'Партнёр не найден');
        if (body.contactId) {
          const contact = await client.query(
            'SELECT 1 FROM partner_contacts WHERE id = $1 AND partner_id = $2 AND archived_at IS NULL',
            [body.contactId, id],
          );
          if (!contact.rows[0]) throw new HttpProblem(400, 'ЛПР этого партнёра не найден');
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO partner_interactions (partner_id, contact_id, channel, direction, occurred_at, outcome, comment, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            id,
            body.contactId ?? null,
            body.channel,
            body.direction,
            new Date(body.occurredAt),
            body.outcome?.trim() || null,
            body.comment?.trim() || null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'partner_interaction.created',
          entityType: 'partner_interaction',
          entityId: result.rows[0]!.id,
          after: { partnerId: id, channel: body.channel, occurredAt: body.occurredAt },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(created);
    },
  );
}
