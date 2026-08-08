import { Permissions } from '@cpi-crm/domain';
import type { FastifyInstance } from 'fastify';

import { getOrganizationContext } from '../../lib/organization.js';

/**
 * Достижимость базы — что вообще можно отправить до того, как писать текст.
 *
 * Ключевая развилка: Telegram-бот умеет писать только тем, кто сам нажал
 * /start, то есть у кого сохранён числовой ID. Контакт вида «@ник» из старого
 * импорта для бота бесполезен: превратить ник в ID Bot API не умеет.
 */

interface ReachabilityRow {
  total: string;
  telegram_bot: string;
  telegram_username_only: string;
  email: string;
  phone: string;
  unreachable: string;
  bot_or_email: string;
  bot_active: string;
  opted_out_telegram: string;
  opted_out_email: string;
  deleted_forever: string;
}

export async function registerAudienceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/audience/reachability',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Аудитория'],
        summary: 'Достижимость базы по каналам',
      },
    },
    async () => {
      const organization = await getOrganizationContext(app.pool);
      const result = await app.pool.query<ReachabilityRow>(
        `WITH canonical AS (
           SELECT p.id, p.last_artifact_at
             FROM persons p
            WHERE p.organization_id = $1
              AND p.archived_at IS NULL
              AND p.merged_into_person_id IS NULL
         ),
         -- Контакты слитых карточек тоже наши: берём весь кластер участника.
         cluster_contacts AS (
           SELECT COALESCE(member.merged_into_person_id, member.id) AS person_id,
                  contact.type, contact.messenger_stable_id
             FROM contact_points contact
             JOIN persons member ON member.id = contact.person_id
            WHERE member.organization_id = $1
              AND contact.archived_at IS NULL
         ),
         flags AS (
           SELECT canonical.id,
                  canonical.last_artifact_at,
                  COALESCE(bool_or(cc.type = 'TELEGRAM' AND cc.messenger_stable_id IS NOT NULL), false) AS bot,
                  COALESCE(bool_or(cc.type = 'TELEGRAM' AND cc.messenger_stable_id IS NULL), false) AS tg_username,
                  COALESCE(bool_or(cc.type = 'EMAIL'), false) AS email,
                  COALESCE(bool_or(cc.type = 'PHONE'), false) AS phone
             FROM canonical
             LEFT JOIN cluster_contacts cc ON cc.person_id = canonical.id
            GROUP BY canonical.id, canonical.last_artifact_at
         ),
         -- Действует последняя по времени запись согласия для каждой цели.
         latest_consent AS (
           SELECT DISTINCT ON (cr.person_id, cr.purpose)
                  COALESCE(member.merged_into_person_id, member.id) AS person_id,
                  cr.purpose, cr.status
             FROM consent_records cr
             JOIN persons member ON member.id = cr.person_id
            WHERE member.organization_id = $1
            ORDER BY cr.person_id, cr.purpose, cr.recorded_at DESC
         )
         SELECT
           (SELECT count(*) FROM flags)::text AS total,
           (SELECT count(*) FROM flags WHERE bot)::text AS telegram_bot,
           (SELECT count(*) FROM flags WHERE tg_username AND NOT bot)::text AS telegram_username_only,
           (SELECT count(*) FROM flags WHERE email)::text AS email,
           (SELECT count(*) FROM flags WHERE phone)::text AS phone,
           (SELECT count(*) FROM flags WHERE NOT bot AND NOT email)::text AS unreachable,
           (SELECT count(*) FROM flags WHERE bot OR email)::text AS bot_or_email,
           (SELECT count(*) FROM flags
             WHERE bot AND last_artifact_at > now() - interval '180 days')::text AS bot_active,
           (SELECT count(*) FROM latest_consent
             WHERE purpose = 'MARKETING_TELEGRAM'
               AND status IN ('DENIED', 'WITHDRAWN'))::text AS opted_out_telegram,
           (SELECT count(*) FROM latest_consent
             WHERE purpose = 'MARKETING_EMAIL'
               AND status IN ('DENIED', 'WITHDRAWN'))::text AS opted_out_email,
           (SELECT count(*) FROM person_deletion_tombstones
             WHERE organization_id = $1)::text AS deleted_forever`,
        [organization.id],
      );
      const row = result.rows[0]!;
      const total = Number(row.total);
      const telegramBot = Number(row.telegram_bot);
      const email = Number(row.email);
      return {
        total,
        channels: {
          telegramBot,
          telegramUsernameOnly: Number(row.telegram_username_only),
          email,
          phone: Number(row.phone),
          unreachable: Number(row.unreachable),
        },
        coverage: {
          botOrEmail: Number(row.bot_or_email),
          botShare: total > 0 ? (telegramBot / total) * 100 : null,
          emailShare: total > 0 ? (email / total) * 100 : null,
        },
        pilotCandidates: Number(row.bot_active),
        optedOut: {
          telegram: Number(row.opted_out_telegram),
          email: Number(row.opted_out_email),
        },
        deletedForever: Number(row.deleted_forever),
      };
    },
  );
}
