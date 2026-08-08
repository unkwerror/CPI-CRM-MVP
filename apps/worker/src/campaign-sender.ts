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
 * Отправка кампаний в Telegram.
 *
 * Бот может написать только тем, кто сам нажал /start, поэтому адресом служит
 * числовой Telegram ID. Скорость ограничена настройкой кампании: Telegram
 * начинает отдавать 429 примерно после 30 сообщений в секунду, а при массовой
 * рассылке безопасный потолок ниже.
 */

export interface CampaignSenderOptions {
  readonly telegramBotToken: string;
  readonly telegramApiUrl: string;
  readonly batchSize: number;
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
  parameters?: { retry_after?: number };
}

export class CampaignSender {
  public constructor(
    private readonly pool: Pool,
    private readonly options: CampaignSenderOptions,
  ) {}

  /** @returns сколько сообщений удалось отправить за проход */
  public async processOnce(): Promise<number> {
    if (!this.options.telegramBotToken) return 0;
    const queued = await claimQueue(this.pool, 'TELEGRAM', this.options.batchSize);
    if (queued.length === 0) return 0;

    let sent = 0;
    for (const recipient of queued) {
      const delay = Math.ceil(1000 / Math.max(1, recipient.messages_per_second));
      const outcome = await this.deliver(recipient);
      if (outcome.sent) sent += 1;
      await sleep(delay);
    }
    await finishCompletedCampaigns(this.pool);
    return sent;
  }

  private async deliver(recipient: QueuedRecipient): Promise<{ sent: boolean }> {
    const text = renderBody(recipient.body, recipient);
    try {
      const response = await fetch(
        `${this.options.telegramApiUrl}/bot${this.options.telegramBotToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: recipient.address,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: false,
            ...buildKeyboard(recipient.buttons, recipient.id),
          }),
        },
      );
      const payload = (await response.json()) as TelegramResponse;
      if (payload.ok) {
        const messageId = payload.result?.message_id;
        await markSent(this.pool, recipient, messageId === undefined ? undefined : String(messageId));
        return { sent: true };
      }
      // 429 — временная просадка: возвращаем в очередь, следующий проход повторит.
      if (payload.parameters?.retry_after) {
        await sleep(payload.parameters.retry_after * 1000);
        return { sent: false };
      }
      await markFailed(this.pool, recipient, payload.description ?? 'Telegram отклонил сообщение');
      return { sent: false };
    } catch (error) {
      await markFailed(this.pool, recipient, error instanceof Error ? error.message : String(error));
      return { sent: false };
    }
  }
}

/**
 * Отклик нужно собирать кнопками: свободный ответ в чат бота никто не прочитает
 * и в CRM он не попадёт. callback_data несёт id получателя, чтобы бот сообщил,
 * кто именно нажал.
 */
export function buildKeyboard(
  buttons: readonly CampaignButton[],
  recipientId: string,
): { reply_markup?: { inline_keyboard: unknown[][] } } {
  if (!buttons.length) return {};
  return {
    reply_markup: {
      inline_keyboard: buttons.map((button) => [
        button.action === 'URL'
          ? { text: button.text, url: button.url }
          : { text: button.text, callback_data: `cmp:${recipientId}:${button.action}` },
      ]),
    },
  };
}

export type { CampaignButton };
