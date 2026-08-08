import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import { requireLockerIntegration } from '../../lib/locker-auth.js';
import {
  buildAudienceQuery,
  renderCampaignBody,
  CONSENT_PURPOSE,
  type CampaignChannel,
  type CampaignSegment,
} from './audience.js';
import { registerCampaignEmailWebhook } from './email-webhook.js';

/**
 * Рассылки активации базы.
 *
 * Порядок жёсткий: черновик → проба на себе → утверждение → отправка волнами.
 * Текст правится только в черновике: иначе половина базы получит одно письмо,
 * а половина — другое, и сравнить отклик будет не с чем.
 */

const SegmentSchema = Type.Object({
  hasArtifact: Type.Optional(Type.Boolean()),
  lastArtifactWithinDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
  incompleteProfile: Type.Optional(Type.Boolean()),
  eventIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 50 })),
  includeHidden: Type.Optional(Type.Boolean()),
});

const ButtonSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 64 }),
  action: Type.Union([
    Type.Literal('INTERESTED'),
    Type.Literal('MORE_INFO'),
    Type.Literal('UNSUBSCRIBED'),
    Type.Literal('URL'),
  ]),
  url: Type.Optional(Type.String({ maxLength: 500 })),
});

interface CampaignRow {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: string;
  goal: string | null;
  subject: string | null;
  body: string;
  buttons: unknown;
  segment: CampaignSegment;
  wave_size: number;
  messages_per_second: number;
  sent_count: number;
  failed_count: number;
  approved_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  version: number;
}

function mapCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    status: row.status,
    goal: row.goal,
    subject: row.subject,
    body: row.body,
    buttons: row.buttons,
    segment: row.segment,
    waveSize: row.wave_size,
    messagesPerSecond: row.messages_per_second,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    approvedAt: row.approved_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    version: row.version,
  };
}

const CAMPAIGN_COLUMNS = `id, name, channel, status, goal, subject, body, buttons, segment,
  wave_size, messages_per_second, sent_count, failed_count, approved_at, started_at,
  finished_at, created_at, version`;

export async function registerCampaignRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/campaigns',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_READ),
      schema: { tags: ['Рассылки'], summary: 'Список рассылок' },
    },
    async () => {
      const organization = await getOrganizationContext(app.pool);
      const result = await app.pool.query<CampaignRow>(
        `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
          WHERE organization_id = $1 AND archived_at IS NULL
          ORDER BY created_at DESC`,
        [organization.id],
      );
      return { items: result.rows.map(mapCampaign) };
    },
  );

  app.post(
    '/campaigns',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_WRITE),
      schema: {
        tags: ['Рассылки'],
        summary: 'Создать черновик рассылки',
        body: Type.Object({
          name: Type.String({ minLength: 3, maxLength: 200 }),
          channel: Type.Union([Type.Literal('TELEGRAM'), Type.Literal('EMAIL')]),
          goal: Type.Optional(Type.String({ maxLength: 500 })),
          subject: Type.Optional(Type.String({ maxLength: 300 })),
          body: Type.String({ minLength: 1, maxLength: 4000 }),
          buttons: Type.Optional(Type.Array(ButtonSchema, { maxItems: 4 })),
          segment: Type.Optional(SegmentSchema),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        name: string;
        channel: CampaignChannel;
        goal?: string;
        subject?: string;
        body: string;
        buttons?: unknown[];
        segment?: CampaignSegment;
      };
      if (body.channel === 'EMAIL' && !body.subject?.trim())
        throw new HttpProblem(400, 'У письма должна быть тема');
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        const result = await client.query<CampaignRow>(
          `INSERT INTO campaigns
             (organization_id, name, channel, goal, subject, body, buttons, segment, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
           RETURNING ${CAMPAIGN_COLUMNS}`,
          [
            organization.id,
            body.name.trim(),
            body.channel,
            body.goal?.trim() ?? null,
            body.subject?.trim() ?? null,
            body.body,
            JSON.stringify(body.buttons ?? []),
            JSON.stringify(body.segment ?? {}),
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.created',
          entityType: 'campaign',
          entityId: result.rows[0]!.id,
          after: { name: body.name, channel: body.channel },
        });
        return result.rows[0]!;
      });
      return reply.code(201).send(mapCampaign(created));
    },
  );

  app.get(
    '/campaigns/:id',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_READ),
      schema: {
        tags: ['Рассылки'],
        summary: 'Рассылка со статистикой',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const organization = await getOrganizationContext(app.pool);
      const [campaign, stats, attachments] = await Promise.all([
        app.pool.query<CampaignRow>(
          `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
          [id, organization.id],
        ),
        app.pool.query<{
          queued: string;
          sent: string;
          delivered: string;
          failed: string;
          interested: string;
          more_info: string;
          unsubscribed: string;
          opened: string;
          clicked: string;
          bounced: string;
        }>(
          // Открытие и переход — события, а не статусы получателя: статус говорит
          // только о том, приняли ли письмо у нас.
          `SELECT
             count(*) FILTER (WHERE recipient.status = 'QUEUED')::text AS queued,
             count(*) FILTER (WHERE recipient.status IN ('SENT', 'DELIVERED'))::text AS sent,
             count(*) FILTER (WHERE recipient.status = 'DELIVERED')::text AS delivered,
             count(*) FILTER (WHERE recipient.status = 'FAILED')::text AS failed,
             count(*) FILTER (WHERE recipient.reply = 'INTERESTED')::text AS interested,
             count(*) FILTER (WHERE recipient.reply = 'MORE_INFO')::text AS more_info,
             count(*) FILTER (WHERE recipient.reply = 'UNSUBSCRIBED')::text AS unsubscribed,
             count(*) FILTER (WHERE events.opened)::text AS opened,
             count(*) FILTER (WHERE events.clicked)::text AS clicked,
             count(*) FILTER (WHERE events.bounced)::text AS bounced
           FROM campaign_recipients recipient
           LEFT JOIN LATERAL (
             SELECT bool_or(type = 'OPENED') AS opened,
                    bool_or(type = 'CLICKED') AS clicked,
                    bool_or(type = 'BOUNCED' AND payload->>'permanent' = 'true') AS bounced
               FROM campaign_events WHERE recipient_id = recipient.id
           ) events ON true
          WHERE recipient.campaign_id = $1`,
          [id],
        ),
        loadAttachments(app, id),
      ]);
      if (!campaign.rows[0]) throw new HttpProblem(404, 'Рассылка не найдена');
      const row = stats.rows[0]!;
      return {
        ...mapCampaign(campaign.rows[0]),
        attachments,
        stats: {
          queued: Number(row.queued),
          sent: Number(row.sent),
          delivered: Number(row.delivered),
          failed: Number(row.failed),
          interested: Number(row.interested),
          moreInfo: Number(row.more_info),
          unsubscribed: Number(row.unsubscribed),
          opened: Number(row.opened),
          clicked: Number(row.clicked),
          bounced: Number(row.bounced),
        },
      };
    },
  );

  app.patch(
    '/campaigns/:id',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_WRITE),
      schema: {
        tags: ['Рассылки'],
        summary: 'Изменить черновик',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          version: Type.Integer({ minimum: 0 }),
          name: Type.Optional(Type.String({ minLength: 3, maxLength: 200 })),
          goal: Type.Optional(Type.String({ maxLength: 500 })),
          subject: Type.Optional(Type.String({ maxLength: 300 })),
          body: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
          buttons: Type.Optional(Type.Array(ButtonSchema, { maxItems: 4 })),
          segment: Type.Optional(SegmentSchema),
          waveSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
          messagesPerSecond: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
        }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown> & { version: number };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const current = await client.query<CampaignRow>(
          `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
          [id, organization.id],
        );
        const campaign = current.rows[0];
        if (!campaign) throw new HttpProblem(404, 'Рассылка не найдена');
        if (campaign.status !== 'DRAFT')
          throw new HttpProblem(
            409,
            'Изменить можно только черновик',
            'Утверждённую рассылку нельзя править: часть аудитории уже получила текущий текст.',
          );
        if (campaign.version !== body.version)
          throw new HttpProblem(409, 'Рассылка уже изменена', 'Обновите страницу.');

        const updated = await client.query<CampaignRow>(
          `UPDATE campaigns
              SET name = COALESCE($3, name),
                  goal = COALESCE($4, goal),
                  subject = COALESCE($5, subject),
                  body = COALESCE($6, body),
                  buttons = COALESCE($7::jsonb, buttons),
                  segment = COALESCE($8::jsonb, segment),
                  wave_size = COALESCE($9, wave_size),
                  messages_per_second = COALESCE($10, messages_per_second),
                  updated_at = now(), version = version + 1
            WHERE id = $1 AND organization_id = $2
            RETURNING ${CAMPAIGN_COLUMNS}`,
          [
            id,
            organization.id,
            body.name ?? null,
            body.goal ?? null,
            body.subject ?? null,
            body.body ?? null,
            body.buttons ? JSON.stringify(body.buttons) : null,
            body.segment ? JSON.stringify(body.segment) : null,
            body.waveSize ?? null,
            body.messagesPerSecond ?? null,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.updated',
          entityType: 'campaign',
          entityId: id,
        });
        return mapCampaign(updated.rows[0]!);
      });
    },
  );

  app.get(
    '/campaigns/:id/audience',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_READ),
      schema: {
        tags: ['Рассылки'],
        summary: 'Размер аудитории и примеры сообщений',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const organization = await getOrganizationContext(app.pool);
      const campaign = await loadCampaign(app, organization.id, id);
      const audience = buildAudienceQuery(organization.id, campaign.channel, campaign.segment);
      const [total, sample] = await Promise.all([
        app.pool.query<{ count: string }>(
          `SELECT count(*)::text FROM (${audience.sql}) audience`,
          audience.params,
        ),
        app.pool.query<{ canonical_full_name: string; first_name: string | null; address: string }>(
          `${audience.sql} LIMIT 5`,
          audience.params,
        ),
      ]);
      return {
        total: Number(total.rows[0]!.count),
        alreadyQueued: campaign.sent_count,
        sample: sample.rows.map((row) => ({
          name: row.canonical_full_name,
          address: maskAddress(campaign.channel, row.address),
          preview: renderCampaignBody(campaign.body, {
            canonicalFullName: row.canonical_full_name,
            firstName: row.first_name,
          }),
        })),
      };
    },
  );

  app.post(
    '/campaigns/:id/approve',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_SEND),
      schema: {
        tags: ['Рассылки'],
        summary: 'Утвердить текст и открыть отправку',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ version: Type.Integer({ minimum: 0 }) }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { version } = request.body as { version: number };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const result = await client.query<CampaignRow>(
          `UPDATE campaigns
              SET status = 'APPROVED', approved_at = now(), approved_by_user_id = $3,
                  updated_at = now(), version = version + 1
            WHERE id = $1 AND organization_id = $2 AND status = 'DRAFT' AND version = $4
            RETURNING ${CAMPAIGN_COLUMNS}`,
          [id, organization.id, request.authUser!.userId, version],
        );
        if (!result.rows[0])
          throw new HttpProblem(409, 'Утвердить можно только актуальный черновик');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.approved',
          entityType: 'campaign',
          entityId: id,
        });
        return mapCampaign(result.rows[0]);
      });
    },
  );

  app.post(
    '/campaigns/:id/wave',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_SEND),
      schema: {
        tags: ['Рассылки'],
        summary: 'Поставить в очередь следующую волну',
        description:
          'Волна фиксирует список получателей на момент запуска. Отправку выполняет ' +
          'воркер с ограничением скорости; повторно один человек в кампанию не попадёт.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const current = await client.query<CampaignRow>(
          `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
          [id, organization.id],
        );
        const campaign = current.rows[0];
        if (!campaign) throw new HttpProblem(404, 'Рассылка не найдена');
        if (!['APPROVED', 'SENDING', 'PAUSED'].includes(campaign.status))
          throw new HttpProblem(409, 'Рассылка не утверждена к отправке');

        const waveResult = await client.query<{ wave: number | null }>(
          `SELECT max(wave) AS wave FROM campaign_recipients WHERE campaign_id = $1`,
          [id],
        );
        const wave = (waveResult.rows[0]?.wave ?? 0) + 1;

        const audience = buildAudienceQuery(organization.id, campaign.channel, campaign.segment, {
          excludeCampaignId: id,
          limit: campaign.wave_size,
        });
        const params = [...audience.params, id, wave];
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO campaign_recipients (campaign_id, person_id, address, wave)
           SELECT $${params.length - 1}::uuid, audience.person_id, audience.address, $${params.length}::int
             FROM (${audience.sql}) audience
           ON CONFLICT (campaign_id, person_id) DO NOTHING
           RETURNING id`,
          params,
        );

        await client.query(
          `UPDATE campaigns
              SET status = 'SENDING', started_at = COALESCE(started_at, now()),
                  updated_at = now(), version = version + 1
            WHERE id = $1`,
          [id],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.wave_queued',
          entityType: 'campaign',
          entityId: id,
          after: { wave, queued: inserted.rowCount },
        });
        return { wave, queued: inserted.rowCount ?? 0 };
      });
    },
  );

  app.post(
    '/campaigns/:id/pause',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_SEND),
      schema: {
        tags: ['Рассылки'],
        summary: 'Остановить отправку',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const result = await client.query<CampaignRow>(
          `UPDATE campaigns SET status = 'PAUSED', updated_at = now(), version = version + 1
            WHERE id = $1 AND organization_id = $2 AND status = 'SENDING'
            RETURNING ${CAMPAIGN_COLUMNS}`,
          [id, organization.id],
        );
        if (!result.rows[0]) throw new HttpProblem(409, 'Останавливать нечего');
        // Неотправленные письма снимаем с очереди: пауза должна действовать сразу.
        await client.query(
          `UPDATE campaign_recipients
              SET status = 'SKIPPED', error = 'Отправка остановлена', updated_at = now()
            WHERE campaign_id = $1 AND status = 'QUEUED'`,
          [id],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.paused',
          entityType: 'campaign',
          entityId: id,
        });
        return mapCampaign(result.rows[0]);
      });
    },
  );

  await registerCampaignReplyRoute(app);
  registerAttachmentRoutes(app);
  registerCampaignEmailWebhook(app);
}

/**
 * Вложения рассылки.
 *
 * Файл сначала загружается общим механизмом (`/files/upload-intents`), проходит
 * антивирус и только потом прикладывается сюда — иначе рассылка стала бы способом
 * разослать по базе непроверенный файл.
 */
function registerAttachmentRoutes(app: FastifyInstance): void {
  app.post(
    '/campaigns/:id/attachments',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_WRITE),
      schema: {
        tags: ['Рассылки'],
        summary: 'Приложить файл к черновику',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          fileObjectId: Type.String({ format: 'uuid' }),
          kind: Type.Union([Type.Literal('PHOTO'), Type.Literal('DOCUMENT')]),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { fileObjectId: string; kind: AttachmentKind };
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        const campaign = await client.query<{ status: string }>(
          `SELECT status FROM campaigns
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
          [id, organization.id],
        );
        if (!campaign.rows[0]) throw new HttpProblem(404, 'Рассылка не найдена');
        if (campaign.rows[0].status !== 'DRAFT')
          throw new HttpProblem(
            409,
            'Вложения меняются только в черновике',
            'Часть аудитории уже получила письмо с текущим набором файлов.',
          );

        const file = await client.query<{
          status: string;
          size_bytes: string | null;
          declared_mime_type: string | null;
          detected_mime_type: string | null;
        }>(
          `SELECT status, size_bytes, declared_mime_type, detected_mime_type
             FROM file_objects WHERE id = $1`,
          [body.fileObjectId],
        );
        const stored = file.rows[0];
        if (!stored) throw new HttpProblem(404, 'Файл не найден');
        if (stored.status !== 'AVAILABLE')
          throw new HttpProblem(
            409,
            'Файл ещё не проверен',
            'Вложение появится, когда антивирус закончит проверку.',
          );
        const size = Number(stored.size_bytes ?? '0');
        if (size > MAX_ATTACHMENT_BYTES)
          throw new HttpProblem(
            400,
            'Файл слишком большой для письма',
            'Unisender Go принимает вложения до 7 МБ. Крупные файлы лучше отдавать ссылкой.',
          );
        const mime = stored.detected_mime_type ?? stored.declared_mime_type ?? '';
        if (body.kind === 'PHOTO' && !mime.startsWith('image/'))
          throw new HttpProblem(400, 'Фотографией может быть только изображение');

        const total = await client.query<{ count: string; bytes: string }>(
          `SELECT count(*)::text, COALESCE(sum(file.size_bytes), 0)::text AS bytes
             FROM campaign_attachments attachment
             JOIN file_objects file ON file.id = attachment.file_object_id
            WHERE attachment.campaign_id = $1`,
          [id],
        );
        const counters = total.rows[0]!;
        if (Number(counters.count) >= MAX_ATTACHMENTS)
          throw new HttpProblem(409, `Больше ${String(MAX_ATTACHMENTS)} вложений не поместится`);
        if (Number(counters.bytes) + size > MAX_TOTAL_BYTES)
          throw new HttpProblem(
            400,
            'Письмо получится слишком тяжёлым',
            'Суммарный вес вложений не должен превышать 10 МБ, иначе письма начнут отбиваться.',
          );

        const inserted = await client.query<AttachmentRow>(
          `INSERT INTO campaign_attachments
             (campaign_id, file_object_id, kind, position, created_by_user_id)
           SELECT $1, $2, $3,
                  COALESCE((SELECT max(position) FROM campaign_attachments WHERE campaign_id = $1), 0) + 1,
                  $4
           ON CONFLICT (campaign_id, file_object_id) DO NOTHING
           RETURNING id, kind, position, file_object_id`,
          [id, body.fileObjectId, body.kind, request.authUser!.userId],
        );
        if (!inserted.rows[0]) throw new HttpProblem(409, 'Этот файл уже приложен');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.attachment_added',
          entityType: 'campaign',
          entityId: id,
          after: { fileObjectId: body.fileObjectId, kind: body.kind },
        });
        return inserted.rows[0];
      });
      const attachments = await loadAttachments(app, id);
      return reply
        .code(201)
        .send(attachments.find((item) => item.id === created.id) ?? attachments[0]);
    },
  );

  app.delete(
    '/campaigns/:id/attachments/:attachmentId',
    {
      preHandler: app.requirePermission(Permissions.CAMPAIGNS_WRITE),
      schema: {
        tags: ['Рассылки'],
        summary: 'Убрать вложение из черновика',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          attachmentId: Type.String({ format: 'uuid' }),
        }),
      },
    },
    async (request, reply) => {
      const { id, attachmentId } = request.params as { id: string; attachmentId: string };
      const organization = await getOrganizationContext(app.pool);
      await transaction(app.pool, async (client) => {
        const campaign = await client.query<{ status: string }>(
          `SELECT status FROM campaigns
            WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
          [id, organization.id],
        );
        if (!campaign.rows[0]) throw new HttpProblem(404, 'Рассылка не найдена');
        if (campaign.rows[0].status !== 'DRAFT')
          throw new HttpProblem(409, 'Вложения меняются только в черновике');
        const deleted = await client.query(
          `DELETE FROM campaign_attachments WHERE id = $1 AND campaign_id = $2`,
          [attachmentId, id],
        );
        if (deleted.rowCount === 0) throw new HttpProblem(404, 'Вложение не найдено');
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'campaign.attachment_removed',
          entityType: 'campaign',
          entityId: id,
          before: { attachmentId },
        });
      });
      return reply.code(204).send();
    },
  );
}

type AttachmentKind = 'PHOTO' | 'DOCUMENT';

interface AttachmentRow {
  id: string;
  kind: AttachmentKind;
  position: number;
  file_object_id: string;
  original_filename?: string | null;
  size_bytes?: string | null;
  mime_type?: string | null;
}

/** Потолки провайдера: письмо с вложением тяжелее 7 МБ он не примет. */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

async function loadAttachments(app: FastifyInstance, campaignId: string) {
  const result = await app.pool.query<AttachmentRow>(
    `SELECT attachment.id, attachment.kind, attachment.position, attachment.file_object_id,
            file.original_filename,
            file.size_bytes::text AS size_bytes,
            COALESCE(file.detected_mime_type, file.declared_mime_type) AS mime_type
       FROM campaign_attachments attachment
       JOIN file_objects file ON file.id = attachment.file_object_id
      WHERE attachment.campaign_id = $1
      ORDER BY attachment.position`,
    [campaignId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    position: row.position,
    fileObjectId: row.file_object_id,
    fileName: row.original_filename ?? 'файл',
    mimeType: row.mime_type ?? 'application/octet-stream',
    sizeBytes: Number(row.size_bytes ?? '0'),
  }));
}

/**
 * Отклик из Telegram. Кнопки нажимаются в чате с ботом, а обновления получает
 * только процесс бота, поэтому он пересылает нажатие сюда общим секретом.
 */
async function registerCampaignReplyRoute(app: FastifyInstance): Promise<void> {
  const authorize = requireLockerIntegration(app.config.locker.integrationToken);

  app.post(
    '/integrations/campaigns/v1/replies',
    {
      preHandler: authorize,
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['Интеграции'],
        summary: 'Отклик участника на сообщение рассылки',
        body: Type.Object({
          recipientId: Type.String({ format: 'uuid' }),
          action: Type.Union([
            Type.Literal('INTERESTED'),
            Type.Literal('MORE_INFO'),
            Type.Literal('UNSUBSCRIBED'),
          ]),
        }),
      },
    },
    async (request) => {
      const body = request.body as {
        recipientId: string;
        action: 'INTERESTED' | 'MORE_INFO' | 'UNSUBSCRIBED';
      };
      return transaction(app.pool, async (client) => {
        const recipient = await client.query<{ person_id: string; campaign_channel: string }>(
          `SELECT recipient.person_id, campaign.channel AS campaign_channel
             FROM campaign_recipients recipient
             JOIN campaigns campaign ON campaign.id = recipient.campaign_id
            WHERE recipient.id = $1
            FOR UPDATE OF recipient`,
          [body.recipientId],
        );
        const row = recipient.rows[0];
        if (!row) throw new HttpProblem(404, 'Получатель не найден');

        await client.query(
          `UPDATE campaign_recipients
              SET reply = $2, replied_at = now(), updated_at = now()
            WHERE id = $1`,
          [body.recipientId, body.action],
        );
        await client.query(
          `INSERT INTO campaign_events (recipient_id, type)
           VALUES ($1, $2)`,
          [body.recipientId, body.action === 'UNSUBSCRIBED' ? 'UNSUBSCRIBED' : 'REPLIED'],
        );
        // Отписка — отзыв согласия, а не архивация: человек остаётся участником.
        if (body.action === 'UNSUBSCRIBED') {
          await client.query(
            `INSERT INTO consent_records
               (person_id, purpose, status, evidence, data_origin)
             VALUES ($1, $2, 'WITHDRAWN', jsonb_build_object('source', 'CAMPAIGN_BUTTON'), 'LIVE')`,
            [row.person_id, CONSENT_PURPOSE[row.campaign_channel as CampaignChannel]],
          );
        }
        return { recorded: true };
      });
    },
  );
}

async function loadCampaign(
  app: FastifyInstance,
  organizationId: string,
  id: string,
): Promise<CampaignRow> {
  const result = await app.pool.query<CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
      WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
    [id, organizationId],
  );
  if (!result.rows[0]) throw new HttpProblem(404, 'Рассылка не найдена');
  return result.rows[0];
}

/** В предпросмотре адрес не нужен целиком: это контактные данные участника. */
function maskAddress(channel: CampaignChannel, address: string): string {
  if (channel === 'TELEGRAM') return `Telegram ID …${address.slice(-4)}`;
  const [local, domain] = address.split('@');
  if (!domain) return '…';
  return `${local!.slice(0, 2)}…@${domain}`;
}
