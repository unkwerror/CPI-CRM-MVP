import { signCampaignLink } from '@cpi-crm/domain';
import { createTransport, type Transporter } from 'nodemailer';
import type { Pool } from 'pg';

import {
  claimQueue,
  finishCompletedCampaigns,
  markFailed,
  markSent,
  renderBody,
  sleep,
  type CampaignButton,
  type QueuedRecipient,
} from './campaign-delivery.js';

/**
 * Отправка кампаний по email через собственный SMTP (Яндекс 360).
 *
 * Ящик Яндекса пропускает 300 писем в сутки, и превышение не просто отбивается:
 * отправка блокируется на сутки, а каждая новая попытка продлевает блокировку.
 * Поэтому дневная квота считается до отправки, а на отказ сервера воркер
 * останавливает весь проход, вместо того чтобы перебирать очередь дальше.
 *
 * Статусов доставки у SMTP нет: открытие собирается пикселем, отписка — своей
 * ссылкой, а недоставленные письма падают отчётами в ящик отправителя.
 */

export interface CampaignEmailSenderOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly replyTo: string;
  readonly botLink: string;
  readonly publicUrl: string;
  readonly linkSecret: string;
  readonly dailyLimit: number;
  readonly batchSize: number;
}

/** Ответ SMTP: 4xx — «попробуйте позже», 5xx — окончательный отказ. */
interface SmtpError {
  responseCode?: number;
  message: string;
}

export class CampaignEmailSender {
  #transport: Transporter | undefined;

  public constructor(
    private readonly pool: Pool,
    private readonly options: CampaignEmailSenderOptions,
  ) {}

  /** @returns сколько писем принял SMTP-сервер за проход */
  public async processOnce(): Promise<number> {
    if (!this.options.host || !this.options.user) return 0;
    const remaining = this.options.dailyLimit - (await this.sentLastDay());
    if (remaining <= 0) return 0;

    const queued = await claimQueue(
      this.pool,
      'EMAIL',
      Math.min(this.options.batchSize, remaining),
    );
    if (queued.length === 0) return 0;

    let sent = 0;
    for (const recipient of queued) {
      const outcome = await this.deliver(recipient);
      if (outcome === 'STOP_PASS') break;
      if (outcome === 'SENT') sent += 1;
      await sleep(Math.ceil(1000 / Math.max(1, recipient.messages_per_second)));
    }
    await finishCompletedCampaigns(this.pool);
    return sent;
  }

  /**
   * Лимит Яндекса скользящий, поэтому считаем именно за прошедшие сутки, а не
   * с начала календарного дня.
   */
  private async sentLastDay(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text
         FROM campaign_recipients recipient
         JOIN campaigns campaign ON campaign.id = recipient.campaign_id
        WHERE campaign.channel = 'EMAIL'
          AND recipient.sent_at > now() - interval '24 hours'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  private async deliver(recipient: QueuedRecipient): Promise<'SENT' | 'FAILED' | 'STOP_PASS'> {
    const text = renderBody(recipient.body, recipient);
    const unsubscribeUrl = this.link('UNSUBSCRIBE', recipient.id);
    try {
      const info = await this.transport().sendMail({
        from: { name: this.options.fromName, address: this.options.fromEmail },
        to: recipient.address,
        replyTo: this.options.replyTo,
        subject: recipient.subject ?? 'Стартап-студия',
        text: buildPlaintext(text, recipient, this.options.botLink, unsubscribeUrl),
        html: buildHtml(text, recipient, this.options.botLink, unsubscribeUrl, {
          pixelUrl: this.link('OPEN', recipient.id),
        }),
        headers: {
          // Почтовые клиенты показывают свою кнопку отписки: без неё письма
          // чаще помечают спамом, чем ищут ссылку в тексте.
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      await markSent(this.pool, recipient, info.messageId);
      return 'SENT';
    } catch (caught) {
      const error = caught as SmtpError;
      const code = error.responseCode ?? 0;
      if (code >= 500 && code < 600) {
        await markFailed(this.pool, recipient, error.message);
        return 'FAILED';
      }
      // 4xx, обрыв соединения или исчерпанная квота — очередь ждёт следующего
      // прохода. Долбиться дальше нельзя: Яндекс продлевает блокировку.
      console.error('SMTP rejected a campaign email', {
        recipientId: recipient.id,
        code,
        error: error.message,
      });
      return 'STOP_PASS';
    }
  }

  private transport(): Transporter {
    this.#transport ??= createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.port === 465,
      auth: { user: this.options.user, pass: this.options.password },
      pool: true,
      maxConnections: 1,
    });
    return this.#transport;
  }

  private link(purpose: 'OPEN' | 'UNSUBSCRIBE', recipientId: string): string {
    const token = signCampaignLink(this.options.linkSecret, purpose, recipientId);
    const path = purpose === 'OPEN' ? 'pixel' : 'unsubscribe';
    return `${this.options.publicUrl}/public/campaigns/${path}/${token}`;
  }

  public async close(): Promise<void> {
    this.#transport?.close();
    return Promise.resolve();
  }
}

/**
 * Кнопка отклика в письме — ссылка в бота с payload. Так нажатие и попадает в
 * CRM через уже существующий обработчик бота, и приводит человека в Telegram.
 */
export function buildReplyLink(
  botLink: string,
  button: CampaignButton,
  recipientId: string,
): string {
  if (button.action === 'URL') return button.url ?? botLink;
  const url = new URL(botLink);
  url.searchParams.set('start', `cmp_${recipientId}_${button.action}`);
  return url.toString();
}

function buildHtml(
  text: string,
  recipient: QueuedRecipient,
  botLink: string,
  unsubscribeUrl: string,
  tracking: { pixelUrl: string },
): string {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((block) => `<p style="margin:0 0 16px">${block.replaceAll('\n', '<br>')}</p>`)
    .join('');
  const actions = recipient.buttons
    .map(
      (button) =>
        `<p style="margin:0 0 8px"><a href="${escapeAttribute(
          buildReplyLink(botLink, button, recipient.id),
        )}" style="display:inline-block;padding:10px 18px;background:#1f6feb;color:#fff;` +
        `border-radius:6px;text-decoration:none">${button.text}</a></p>`,
    )
    .join('');
  return (
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;' +
    `line-height:1.5;color:#111">${paragraphs}${actions}` +
    `<p style="margin:24px 0 0;font-size:13px;color:#666">Не хотите получать письма — ` +
    `<a href="${escapeAttribute(unsubscribeUrl)}" style="color:#666">отпишитесь</a>.</p>` +
    `<img alt="" height="1" src="${escapeAttribute(tracking.pixelUrl)}" width="1"></div>`
  );
}

function buildPlaintext(
  text: string,
  recipient: QueuedRecipient,
  botLink: string,
  unsubscribeUrl: string,
): string {
  const body = text.replaceAll(/<[^>]+>/gu, '');
  const actions = recipient.buttons
    .map((button) => `${button.text}: ${buildReplyLink(botLink, button, recipient.id)}`)
    .join('\n');
  return [body, actions, `Отписаться: ${unsubscribeUrl}`].filter(Boolean).join('\n\n');
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
