/**
 * Отбор аудитории кампании.
 *
 * Три правила действуют всегда и не отключаются сегментом: пишем только тем,
 * до кого канал реально дотягивается, никогда — тем, кто отписался, и никогда —
 * на адреса с окончательной недоставкой. Всё остальное — необязательные фильтры
 * поверх.
 */

export type CampaignChannel = 'TELEGRAM' | 'EMAIL';

export interface CampaignSegment {
  /** Есть принятый или хотя бы сданный артефакт. */
  hasArtifact?: boolean;
  /** Последний артефакт не старше N дней. */
  lastArtifactWithinDays?: number;
  /** Профиль без полного ФИО — аудитория служебной просьбы дозаполнить бота. */
  incompleteProfile?: boolean;
  /** Участвовал хотя бы в одном из мероприятий. */
  eventIds?: string[];
  /**
   * Включить карточки, спрятанные гигиеной ФИО. Именно им адресована просьба
   * дозаполнить профиль в боте: в реестре их не видно, но бот им писать может.
   */
  includeHidden?: boolean;
}

export const CONSENT_PURPOSE: Readonly<Record<CampaignChannel, string>> = {
  TELEGRAM: 'MARKETING_TELEGRAM',
  EMAIL: 'MARKETING_EMAIL',
};

export interface AudienceQuery {
  sql: string;
  params: unknown[];
}

/**
 * @param organizationId организация-владелец базы
 * @param channel канал: определяет и адрес, и цель согласия
 * @param segment необязательные фильтры поверх достижимости
 */
export function buildAudienceQuery(
  organizationId: string,
  channel: CampaignChannel,
  segment: CampaignSegment,
  options: { excludeCampaignId?: string; limit?: number } = {},
): AudienceQuery {
  const params: unknown[] = [organizationId, CONSENT_PURPOSE[channel]];
  const filters: string[] = [];

  // Повторная волна не должна задеть тех, кому уже поставили сообщение в очередь.
  if (options.excludeCampaignId) {
    params.push(options.excludeCampaignId);
    filters.push(`NOT EXISTS (
      SELECT 1 FROM campaign_recipients queued
       WHERE queued.campaign_id = $${params.length}::uuid AND queued.person_id = person.id
    )`);
  }

  if (segment.hasArtifact === true) filters.push('person.last_artifact_at IS NOT NULL');
  if (segment.hasArtifact === false) filters.push('person.last_artifact_at IS NULL');

  if (typeof segment.lastArtifactWithinDays === 'number') {
    params.push(segment.lastArtifactWithinDays);
    filters.push(
      `person.last_artifact_at > now() - make_interval(days => $${params.length}::int)`,
    );
  }

  if (segment.incompleteProfile === true) filters.push("person.lifecycle_data_state <> 'COMPLETE'");
  if (segment.incompleteProfile === false)
    filters.push("person.lifecycle_data_state = 'COMPLETE'");

  if (segment.eventIds?.length) {
    params.push(segment.eventIds);
    filters.push(`EXISTS (
      SELECT 1 FROM event_participations ep
       WHERE ep.person_id IN (SELECT id FROM persons WHERE id = person.id OR merged_into_person_id = person.id)
         AND ep.archived_at IS NULL
         AND ep.event_id = ANY($${params.length}::uuid[])
    )`);
  }

  const addressColumn = channel === 'TELEGRAM' ? 'telegram' : 'email';
  // Мёртвый адрес чинить нечем: провайдер уже сказал, что доставки не будет, а
  // повторные отправки на такие адреса портят репутацию домена целиком.
  if (channel === 'EMAIL') {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM campaign_recipients bounced
        JOIN campaign_events bounce ON bounce.recipient_id = bounced.id
       WHERE bounced.address = address.email
         AND bounce.type = 'BOUNCED'
         AND bounce.payload->>'permanent' = 'true'
    )`);
  }
  const sql = `
    WITH addresses AS (
      SELECT COALESCE(member.merged_into_person_id, member.id) AS person_id,
             min(contact.messenger_stable_id) FILTER (
               WHERE contact.type = 'TELEGRAM' AND contact.messenger_stable_id IS NOT NULL
             ) AS telegram,
             min(contact.normalized_value) FILTER (
               WHERE contact.type = 'EMAIL' AND contact.archived_at IS NULL
             ) AS email
        FROM contact_points contact
        JOIN persons member ON member.id = contact.person_id
       WHERE member.organization_id = $1
         -- Архивный Telegram ID всё равно достижим: контакт прячет гигиена ФИО,
         -- а не сам человек, и чат с ботом от этого никуда не девается. Удалить
         -- главный Telegram ID из карточки руками нельзя, так что других причин
         -- для архивации у него нет.
         AND (
           contact.archived_at IS NULL
           OR (contact.type = 'TELEGRAM' AND contact.messenger_stable_id IS NOT NULL)
         )
       GROUP BY 1
    ),
    consent AS (
      SELECT DISTINCT ON (person_id) person_id, status
        FROM (
          SELECT COALESCE(member.merged_into_person_id, member.id) AS person_id,
                 record.status, record.recorded_at
            FROM consent_records record
            JOIN persons member ON member.id = record.person_id
           WHERE member.organization_id = $1 AND record.purpose = $2
        ) ranked
       ORDER BY person_id, recorded_at DESC
    )
    SELECT person.id AS person_id,
           person.canonical_full_name,
           person.first_name,
           address.${addressColumn} AS address
      FROM persons person
      JOIN addresses address ON address.person_id = person.id
      LEFT JOIN consent ON consent.person_id = person.id
     WHERE person.organization_id = $1
       ${segment.includeHidden === true ? '' : 'AND person.archived_at IS NULL'}
       AND person.merged_into_person_id IS NULL
       AND address.${addressColumn} IS NOT NULL
       AND (consent.status IS NULL OR consent.status NOT IN ('WITHDRAWN', 'DENIED'))
       ${filters.map((filter) => `AND ${filter}`).join('\n       ')}
     ORDER BY person.last_artifact_at DESC NULLS LAST, person.id`;

  if (options.limit === undefined) return { sql, params };
  params.push(options.limit);
  return { sql: `${sql}\n     LIMIT $${params.length}::int`, params };
}

/** Подстановки в тексте: пустые значения заменяются нейтральным обращением. */
export function renderCampaignBody(
  body: string,
  person: { canonicalFullName: string; firstName: string | null },
): string {
  const first = person.firstName?.trim() || person.canonicalFullName.split(' ')[1] || 'коллега';
  return body
    .replaceAll('{{имя}}', first)
    .replaceAll('{{firstName}}', first)
    .replaceAll('{{фио}}', person.canonicalFullName)
    .replaceAll('{{fullName}}', person.canonicalFullName);
}
