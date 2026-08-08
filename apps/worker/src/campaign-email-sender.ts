import type { Pool } from 'pg';

import type { CampaignAttachment, CampaignAttachmentStore } from './campaign-attachments.js';
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
 * Отправка кампаний по email через Unisender Go.
 *
 * Провайдер взят вместо собственного SMTP по двум причинам: ящик Яндекса отдаёт
 * 300 писем в сутки, а главное — у SMTP нет обратной связи. Здесь же приходят
 * статусы доставки, и по ним база сама чистится от мёртвых адресов.
 *
 * `metadata.recipient_id` — ключ, по которому вебхук находит нашу запись: адрес
 * для этого не годится, один человек получает несколько рассылок.
 *
 * Отписку показывает сам провайдер: свою ссылку добавлять нельзя, иначе в письме
 * их окажется две.
 */

export interface CampaignEmailSenderOptions {
  /** Пустой ключ выключает email-канал: воркер не должен падать без рассылок. */
  readonly apiKey: string;
  readonly apiUrl: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly replyTo: string;
  readonly botLink: string;
  /** Предохранитель от случайной отправки всей базы: потолок за сутки. */
  readonly dailyLimit: number;
  readonly batchSize: number;
}

interface SendResponse {
  status?: string;
  job_id?: string;
  failed_emails?: Record<string, string>;
  code?: number;
  message?: string;
}

export class CampaignEmailSender {
  public constructor(
    private readonly pool: Pool,
    private readonly attachments: CampaignAttachmentStore,
    private readonly options: CampaignEmailSenderOptions,
  ) {}

  /** @returns сколько писем принял провайдер за проход */
  public async processOnce(): Promise<number> {
    if (!this.options.apiKey) return 0;
    const remaining = this.options.dailyLimit - (await this.sentLastDay());
    if (remaining <= 0) return 0;

    const queued = await claimQueue(
      this.pool,
      'EMAIL',
      Math.min(this.options.batchSize, remaining),
    );
    if (queued.length === 0) return 0;

    let sent = 0;
    try {
      for (const recipient of queued) {
        const outcome = await this.deliver(recipient);
        if (outcome === 'STOP_PASS') break;
        if (outcome === 'SENT') sent += 1;
        await sleep(Math.ceil(1000 / Math.max(1, recipient.messages_per_second)));
      }
    } finally {
      this.attachments.clear();
    }
    await finishCompletedCampaigns(this.pool);
    return sent;
  }

  /** Лимит считается за прошедшие сутки, а не с начала календарного дня. */
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
    const files = await this.attachments.load(recipient.campaign_id);
    const photos = files.filter((file) => file.kind === 'PHOTO');
    const documents = files.filter((file) => file.kind === 'DOCUMENT');

    try {
      const response = await fetch(`${this.options.apiUrl}/email/send.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-KEY': this.options.apiKey },
        body: JSON.stringify({
          message: {
            recipients: [
              { email: recipient.address, metadata: { recipient_id: recipient.id } },
            ],
            // Шаблонизатор выключен: подстановки уже сделаны на нашей стороне, а
            // текст письма пишет человек, и фигурные скобки в нём не команда.
            template_engine: 'none',
            body: {
              html: buildHtml(text, recipient, this.options.botLink, photos),
              plaintext: buildPlaintext(text, recipient, this.options.botLink),
            },
            subject: recipient.subject ?? 'Стартап-студия',
            from_email: this.options.fromEmail,
            from_name: this.options.fromName,
            reply_to: this.options.replyTo,
            track_read: 1,
            track_links: 1,
            ...(documents.length > 0 ? { attachments: documents.map(toApiAttachment) } : {}),
            ...(photos.length > 0 ? { inline_attachments: photos.map(toInlineAttachment) } : {}),
          },
        }),
      });
      const payload = (await response.json()) as SendResponse;

      if (response.ok && payload.status === 'success' && !payload.failed_emails) {
        await markSent(this.pool, recipient, payload.job_id);
        return 'SENT';
      }
      // Провайдер разделяет отказы: по конкретному адресу — его проблема, по
      // запросу целиком — наша, и дальше в этом проходе идти незачем.
      const addressError = payload.failed_emails?.[recipient.address];
      if (addressError) {
        await markFailed(this.pool, recipient, addressError);
        return 'FAILED';
      }
      if (response.status === 400 || response.status === 404) {
        await markFailed(this.pool, recipient, payload.message ?? `Ошибка ${String(payload.code)}`);
        return 'FAILED';
      }
      console.error('Unisender Go rejected a campaign email', {
        recipientId: recipient.id,
        httpStatus: response.status,
        code: payload.code,
        message: payload.message,
      });
      return 'STOP_PASS';
    } catch (caught) {
      // Сеть отвалилась: очередь ждёт следующего прохода, письмо не потеряно.
      console.error('Unisender Go request failed', {
        recipientId: recipient.id,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      return 'STOP_PASS';
    }
  }
}

function toApiAttachment(file: CampaignAttachment) {
  return { type: file.mimeType, name: file.fileName, content: file.bytes.toString('base64') };
}

/** Имя inline-вложения — это его cid в HTML. */
function toInlineAttachment(file: CampaignAttachment, index: number) {
  return {
    type: file.mimeType,
    name: inlineCid(index),
    content: file.bytes.toString('base64'),
  };
}

function inlineCid(index: number): string {
  return `photo${String(index + 1)}`;
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
  photos: readonly CampaignAttachment[],
): string {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((block) => `<p style="margin:0 0 16px">${block.replaceAll('\n', '<br>')}</p>`)
    .join('');
  const images = photos
    .map(
      (photo, index) =>
        `<p style="margin:0 0 16px"><img alt="${escapeAttribute(photo.fileName)}" ` +
        `src="cid:${inlineCid(index)}" style="max-width:100%;height:auto;border-radius:8px"></p>`,
    )
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
    `line-height:1.5;color:#111">${paragraphs}${images}${actions}</div>`
  );
}

function buildPlaintext(text: string, recipient: QueuedRecipient, botLink: string): string {
  const body = text.replaceAll(/<[^>]+>/gu, '');
  const actions = recipient.buttons
    .map((button) => `${button.text}: ${buildReplyLink(botLink, button, recipient.id)}`)
    .join('\n');
  return [body, actions].filter(Boolean).join('\n\n');
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
