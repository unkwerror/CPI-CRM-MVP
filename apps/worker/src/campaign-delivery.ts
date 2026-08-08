import type { Pool } from 'pg';

/**
 * Общая часть доставки кампаний: очередь, отметки об отправке и завершение.
 *
 * Каналы различаются только транспортом, а учёт получателей должен совпадать —
 * иначе статистика Telegram и email не сойдётся между собой.
 */

export interface QueuedRecipient {
  id: string;
  campaign_id: string;
  address: string;
  subject: string | null;
  body: string;
  buttons: CampaignButton[];
  messages_per_second: number;
  canonical_full_name: string;
  first_name: string | null;
}

export interface CampaignButton {
  text: string;
  action: 'INTERESTED' | 'MORE_INFO' | 'UNSUBSCRIBED' | 'URL';
  url?: string;
}

const QUEUE_SQL = `SELECT recipient.id, recipient.campaign_id, recipient.address,
        campaign.subject, campaign.body, campaign.buttons, campaign.messages_per_second,
        person.canonical_full_name, person.first_name
   FROM campaign_recipients recipient
   JOIN campaigns campaign ON campaign.id = recipient.campaign_id
   JOIN persons person ON person.id = recipient.person_id
  WHERE recipient.status = 'QUEUED'
    AND campaign.channel = $1
    AND campaign.status = 'SENDING'
  ORDER BY recipient.wave, recipient.created_at
  LIMIT $2`;

export async function claimQueue(
  pool: Pool,
  channel: 'TELEGRAM' | 'EMAIL',
  batchSize: number,
): Promise<QueuedRecipient[]> {
  const result = await pool.query<QueuedRecipient>(QUEUE_SQL, [channel, batchSize]);
  return result.rows;
}

export async function markSent(
  pool: Pool,
  recipient: QueuedRecipient,
  externalMessageId?: string,
): Promise<void> {
  await pool.query(
    `UPDATE campaign_recipients
        SET status = 'SENT', sent_at = now(), external_message_id = $2, updated_at = now()
      WHERE id = $1`,
    [recipient.id, externalMessageId ?? null],
  );
  await pool.query(`INSERT INTO campaign_events (recipient_id, type) VALUES ($1, 'SENT')`, [
    recipient.id,
  ]);
  await pool.query(
    `UPDATE campaigns SET sent_count = sent_count + 1, updated_at = now() WHERE id = $1`,
    [recipient.campaign_id],
  );
}

export async function markFailed(
  pool: Pool,
  recipient: QueuedRecipient,
  reason: string,
): Promise<void> {
  const short = reason.slice(0, 500);
  await pool.query(
    `UPDATE campaign_recipients
        SET status = 'FAILED', error = $2, updated_at = now()
      WHERE id = $1`,
    [recipient.id, short],
  );
  await pool.query(
    `INSERT INTO campaign_events (recipient_id, type, payload)
     VALUES ($1, 'FAILED', jsonb_build_object('reason', $2::text))`,
    [recipient.id, short],
  );
  await pool.query(
    `UPDATE campaigns SET failed_count = failed_count + 1, updated_at = now() WHERE id = $1`,
    [recipient.campaign_id],
  );
}

export async function finishCompletedCampaigns(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE campaigns
        SET status = 'SENT', finished_at = now(), updated_at = now()
      WHERE status = 'SENDING'
        AND NOT EXISTS (
              SELECT 1 FROM campaign_recipients
               WHERE campaign_id = campaigns.id AND status = 'QUEUED'
            )`,
  );
}

export function renderBody(
  body: string,
  person: { canonical_full_name: string; first_name: string | null },
): string {
  const first = person.first_name?.trim() || person.canonical_full_name.split(' ')[1] || 'коллега';
  return body
    .replaceAll('{{имя}}', first)
    .replaceAll('{{firstName}}', first)
    .replaceAll('{{фио}}', person.canonical_full_name)
    .replaceAll('{{fullName}}', person.canonical_full_name);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
