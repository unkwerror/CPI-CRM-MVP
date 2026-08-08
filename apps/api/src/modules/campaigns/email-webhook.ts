import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import { CONSENT_PURPOSE } from './audience.js';

/**
 * Статусы писем от Unisender Go.
 *
 * Провайдер знает про письмо то, чего не знает отправитель: дошло ли оно, открыли
 * ли его, пожаловались ли на спам и существует ли вообще адрес. Без этого канала
 * база не чистится, поэтому вебхук — не украшение статистики, а условие того,
 * что мы перестанем писать на мёртвые адреса.
 *
 * Маршрут публичный: провайдер не умеет ни сессий, ни заголовка Origin. Защита —
 * секрет в самом адресе вебхука, который знают только CRM и Unisender Go.
 */

interface StatusEvent {
  readonly email?: string;
  readonly status?: string;
  readonly job_id?: string;
  readonly event_time?: string;
  readonly metadata?: Record<string, string>;
  readonly delivery_info?: { delivery_status?: string; destination_response?: string };
}

const WebhookBody = Type.Object(
  {
    events_by_user: Type.Array(
      Type.Object(
        {
          events: Type.Array(
            Type.Object(
              {
                event_name: Type.Optional(Type.String()),
                event_data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
              },
              { additionalProperties: true },
            ),
            { maxItems: 500 },
          ),
        },
        { additionalProperties: true },
      ),
      { maxItems: 10 },
    ),
  },
  { additionalProperties: true },
);

export function registerCampaignEmailWebhook(app: FastifyInstance): void {
  const secret = app.config.email.webhookSecret;

  app.post(
    '/public/campaigns/unisender/:secret',
    {
      config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
      schema: {
        hide: true,
        params: Type.Object({ secret: Type.String({ minLength: 16, maxLength: 200 }) }),
        body: WebhookBody,
      },
    },
    async (request) => {
      const params = request.params as { secret: string };
      if (params.secret !== secret) throw new HttpProblem(404, 'Не найдено');

      const body = request.body as {
        events_by_user: { events: { event_name?: string; event_data?: StatusEvent }[] }[];
      };
      let applied = 0;
      for (const group of body.events_by_user) {
        for (const event of group.events) {
          if (event.event_name !== 'transactional_email_status') continue;
          if (!event.event_data) continue;
          if (await applyStatus(app, event.event_data)) applied += 1;
        }
      }
      // Провайдер повторяет доставку вебхука, пока не увидит 200, поэтому даже
      // неопознанные события подтверждаем: иначе очередь встанет на них.
      return { applied };
    },
  );
}

async function applyStatus(app: FastifyInstance, data: StatusEvent): Promise<boolean> {
  const recipientId = data.metadata?.recipient_id;
  const status = data.status;
  if (!recipientId || !status) return false;

  return transaction(app.pool, async (client) => {
    const recipient = await client.query<{ id: string; person_id: string }>(
      `SELECT id, person_id FROM campaign_recipients WHERE id = $1 FOR UPDATE`,
      [recipientId],
    );
    const row = recipient.rows[0];
    if (!row) return false;

    const detail = data.delivery_info?.destination_response ?? data.delivery_info?.delivery_status;
    switch (status) {
      case 'delivered':
        await client.query(
          `UPDATE campaign_recipients
              SET status = 'DELIVERED', delivered_at = COALESCE(delivered_at, now()),
                  updated_at = now()
            WHERE id = $1 AND status = 'SENT'`,
          [row.id],
        );
        await recordEvent(client, row.id, 'DELIVERED', status);
        return true;
      case 'opened':
        await recordEvent(client, row.id, 'OPENED', status);
        return true;
      case 'clicked':
        await recordEvent(client, row.id, 'CLICKED', status, { url: data.delivery_info ?? {} });
        return true;
      case 'unsubscribed':
        await recordReply(client, row.id, 'UNSUBSCRIBED');
        await recordEvent(client, row.id, 'UNSUBSCRIBED', status);
        await withdrawConsent(client, row.person_id, 'EMAIL_UNSUBSCRIBE');
        return true;
      case 'spam':
        await recordEvent(client, row.id, 'SPAM', status);
        // Жалоба на спам хуже отписки: писать этому человеку больше нельзя.
        await withdrawConsent(client, row.person_id, 'EMAIL_SPAM_COMPLAINT');
        return true;
      case 'soft_bounced':
        await recordEvent(client, row.id, 'BOUNCED', status, {
          permanent: false,
          reason: detail ?? null,
        });
        return true;
      case 'hard_bounced':
        await client.query(
          `UPDATE campaign_recipients
              SET status = 'FAILED', error = $2, updated_at = now()
            WHERE id = $1 AND status <> 'FAILED'`,
          [row.id, (detail ?? 'Адрес недоступен').slice(0, 500)],
        );
        await recordEvent(client, row.id, 'BOUNCED', status, {
          permanent: true,
          reason: detail ?? null,
        });
        return true;
      default:
        // accepted и sent уже отмечены при отправке, subscribed возвращает
        // человека в рассылку — согласие мы записываем только по его действию в CRM.
        return false;
    }
  });
}

async function recordEvent(
  client: PoolClient,
  recipientId: string,
  type: string,
  providerStatus: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  // Одно событие каждого вида на получателя: письмо перечитывают, а метрика
  // считает людей, и вебхук приходит повторно после каждого сбоя доставки.
  await client.query(
    `INSERT INTO campaign_events (recipient_id, type, payload, external_event_id)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (external_event_id) DO NOTHING`,
    [
      recipientId,
      type,
      JSON.stringify({ ...payload, providerStatus }),
      `unisender:${providerStatus}:${recipientId}`,
    ],
  );
}

async function recordReply(
  client: PoolClient,
  recipientId: string,
  reply: 'UNSUBSCRIBED',
): Promise<void> {
  await client.query(
    `UPDATE campaign_recipients
        SET reply = $2, replied_at = now(), updated_at = now()
      WHERE id = $1 AND reply IS NULL`,
    [recipientId, reply],
  );
}

/** Отписка — отзыв согласия, а не архивация: человек остаётся участником. */
async function withdrawConsent(
  client: PoolClient,
  personId: string,
  source: string,
): Promise<void> {
  await client.query(
    `INSERT INTO consent_records (person_id, purpose, status, evidence, data_origin)
     VALUES ($1, $2, 'WITHDRAWN', jsonb_build_object('source', $3::text), 'LIVE')`,
    [personId, CONSENT_PURPOSE.EMAIL, source],
  );
}
