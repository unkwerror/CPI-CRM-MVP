import { verifyCampaignLink } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import { CONSENT_PURPOSE } from './audience.js';

/**
 * Открытия и отписки для писем, отправленных своим SMTP.
 *
 * Маршруты публичные: их открывают из почтового клиента, где нет ни сессии, ни
 * заголовка Origin. Единственная защита — подпись в ссылке, поэтому по чужому
 * адресу нельзя ни отписать соседа, ни накрутить открытия.
 */

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const TokenParams = Type.Object({ token: Type.String({ minLength: 8, maxLength: 200 }) });

export function registerCampaignEmailTracking(app: FastifyInstance): void {
  const secret = app.config.email.linkSecret;

  app.get(
    '/public/campaigns/pixel/:token',
    {
      config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
      schema: { hide: true, params: TokenParams },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const recipientId = verifyCampaignLink(secret, 'OPEN', token);
      // Битую ссылку отдаём картинкой без ошибки: в письме это невидимый пиксель.
      if (recipientId) await recordOpen(app, recipientId);
      return reply
        .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
        .type('image/gif')
        .send(PIXEL);
    },
  );

  /**
   * Ссылка отписки открывается страницей с подтверждением, а не отписывает
   * сразу: почтовые антивирусы и предпросмотр открывают ссылки из писем сами.
   */
  app.get(
    '/public/campaigns/unsubscribe/:token',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { hide: true, params: TokenParams },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      if (!verifyCampaignLink(secret, 'UNSUBSCRIBE', token))
        throw new HttpProblem(404, 'Ссылка недействительна');
      return reply.type('text/html; charset=utf-8').send(confirmationPage(token));
    },
  );

  app.post(
    '/public/campaigns/unsubscribe/:token',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { hide: true, params: TokenParams },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const recipientId = verifyCampaignLink(secret, 'UNSUBSCRIBE', token);
      if (!recipientId) throw new HttpProblem(404, 'Ссылка недействительна');
      await recordUnsubscribe(app, recipientId);
      // One-Click из почтового клиента ждёт простой 200, человек — страницу.
      if (request.headers.accept?.includes('text/html'))
        return reply.type('text/html; charset=utf-8').send(farewellPage());
      return reply.send({ unsubscribed: true });
    },
  );
}

async function recordOpen(app: FastifyInstance, recipientId: string): Promise<void> {
  // Одно открытие на получателя: письмо перечитывают, а метрика считает людей.
  await app.pool.query(
    `INSERT INTO campaign_events (recipient_id, type, external_event_id)
     SELECT $1, 'OPENED', $2
      WHERE EXISTS (SELECT 1 FROM campaign_recipients WHERE id = $1)
     ON CONFLICT (external_event_id) DO NOTHING`,
    [recipientId, `open:${recipientId}`],
  );
}

async function recordUnsubscribe(app: FastifyInstance, recipientId: string): Promise<void> {
  await transaction(app.pool, async (client) => {
    const recipient = await client.query<{ person_id: string }>(
      `SELECT person_id FROM campaign_recipients WHERE id = $1 FOR UPDATE`,
      [recipientId],
    );
    const row = recipient.rows[0];
    if (!row) throw new HttpProblem(404, 'Ссылка недействительна');

    await client.query(
      `UPDATE campaign_recipients
          SET reply = 'UNSUBSCRIBED', replied_at = now(), updated_at = now()
        WHERE id = $1 AND reply IS NULL`,
      [recipientId],
    );
    await client.query(
      `INSERT INTO campaign_events (recipient_id, type, external_event_id)
       VALUES ($1, 'UNSUBSCRIBED', $2)
       ON CONFLICT (external_event_id) DO NOTHING`,
      [recipientId, `unsubscribe:${recipientId}`],
    );
    // Отписка — отзыв согласия, а не архивация: человек остаётся участником.
    await client.query(
      `INSERT INTO consent_records (person_id, purpose, status, evidence, data_origin)
       VALUES ($1, $2, 'WITHDRAWN', jsonb_build_object('source', 'EMAIL_UNSUBSCRIBE'), 'LIVE')`,
      [row.person_id, CONSENT_PURPOSE.EMAIL],
    );
  });
}

function page(body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Рассылка стартап-студии</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;
margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
main{max-width:26rem}button{font:inherit;padding:10px 18px;border:0;border-radius:6px;
background:#1f6feb;color:#fff;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;
}

function confirmationPage(token: string): string {
  return page(
    `<h1>Отписаться от рассылки?</h1><p>Мы перестанем присылать письма. Ваши материалы
     и участие в мероприятиях останутся в системе.</p>
     <form method="post" action="/api/public/campaigns/unsubscribe/${token}">
     <button type="submit">Отписаться</button></form>`,
  );
}

function farewellPage(): string {
  return page('<h1>Готово</h1><p>Больше писем не будет. Спасибо, что сказали.</p>');
}
