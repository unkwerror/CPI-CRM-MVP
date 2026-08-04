import { createHash } from 'node:crypto';

import {
  createContentFingerprint,
  normalizeFullName,
  normalizePhone,
  normalizeTelegramUsername,
  normalizeUnicode,
  parseRussianFullName,
} from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { writeAudit } from '../../lib/audit.js';
import { requireLockerIntegration } from '../../lib/locker-auth.js';
import { getOrganizationContext, type OrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import type { AuthUser } from '../../types.js';
import { recalculatePersonLifecycle } from '../artifacts/lifecycle-service.js';

const LOCKER_ACTOR: AuthUser = {
  sub: 'locker-integration',
  userId: '00000000-0000-4000-8000-000000000002',
  name: 'Интеграция Locker',
  email: 'locker-integration@cpi.local',
  roles: [],
  permissions: [],
};

const nullableText = (maximum: number) =>
  Type.Optional(Type.Union([Type.String({ maxLength: maximum }), Type.Null()]));

const LockerUser = Type.Object(
  {
    lockerUserId: Type.String({ format: 'uuid' }),
    telegramUserId: Type.String({ pattern: '^[0-9]+$', maxLength: 32 }),
    telegramUsername: nullableText(64),
    fullName: Type.String({ minLength: 1, maxLength: 500 }),
    phone: nullableText(100),
    organization: nullableText(500),
    position: nullableText(500),
    consentAt: nullableText(64),
    crmPersonId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
);

const LockerEvent = Type.Object(
  {
    lockerEventId: Type.String({ format: 'uuid' }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    status: Type.Union([
      Type.Literal('draft'),
      Type.Literal('published'),
      Type.Literal('running'),
      Type.Literal('finished'),
      Type.Literal('archived'),
    ]),
    startsAt: Type.String({ format: 'date-time' }),
    endsAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

const LockerFile = Type.Object(
  {
    lockerArtifactId: Type.String({ format: 'uuid' }),
    originalName: Type.String({ minLength: 1, maxLength: 500 }),
    mimeType: Type.String({ minLength: 1, maxLength: 200 }),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 10 * 1024 ** 3 }),
    checksumSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    readyAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

const LockerSubmission = Type.Object(
  {
    lockerSubmissionId: Type.String({ format: 'uuid' }),
    title: nullableText(300),
    text: nullableText(50_000),
    link: nullableText(2_000),
    createdAt: Type.String({ format: 'date-time' }),
    submittedAt: Type.String({ format: 'date-time' }),
    files: Type.Array(LockerFile, { maxItems: 100 }),
  },
  { additionalProperties: false },
);

const SyncBody = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    user: LockerUser,
    event: LockerEvent,
    submission: LockerSubmission,
  },
  { additionalProperties: false },
);

type LockerUserInput = {
  lockerUserId: string;
  telegramUserId: string;
  telegramUsername?: string | null;
  fullName: string;
  phone?: string | null;
  organization?: string | null;
  position?: string | null;
  consentAt?: string | null;
  crmPersonId?: string;
};

type LockerEventInput = {
  lockerEventId: string;
  title: string;
  status: 'draft' | 'published' | 'running' | 'finished' | 'archived';
  startsAt: string;
  endsAt: string;
};

type LockerFileInput = {
  lockerArtifactId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  readyAt: string;
};

type LockerSubmissionInput = {
  lockerSubmissionId: string;
  title?: string | null;
  text?: string | null;
  link?: string | null;
  createdAt: string;
  submittedAt: string;
  files: LockerFileInput[];
};

type LockerSyncInput = {
  schemaVersion: 1;
  user: LockerUserInput;
  event: LockerEventInput;
  submission: LockerSubmissionInput;
};

export async function registerLockerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const authorize = requireLockerIntegration(app.config.locker.integrationToken);

  app.post(
    '/integrations/locker/v1/users/resolve',
    {
      preHandler: authorize,
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: { tags: ['Интеграции'], body: LockerUser },
    },
    async (request) => {
      const user = request.body as LockerUserInput;
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        await lockLockerUser(client, user.telegramUserId);
        return resolveLockerPerson(client, organization, user, request.id);
      });
    },
  );

  app.post(
    '/integrations/locker/v1/submissions',
    {
      preHandler: authorize,
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: { tags: ['Интеграции'], body: SyncBody },
    },
    async (request, reply) => {
      const body = request.body as LockerSyncInput;
      const organization = await getOrganizationContext(app.pool);
      const result = await transaction(app.pool, async (client) => {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('locker-submission:' || $1, 0))`,
          [body.submission.lockerSubmissionId],
        );
        const payloadHash = hashLockerSubmissionPayload(body);
        const existing = await client.query<{
          person_id: string;
          event_id: string;
          artifact_id: string;
          artifact_version_id: string;
          payload_hash: string;
        }>(
          `SELECT person_id, event_id, artifact_id, artifact_version_id, payload_hash
             FROM locker_submission_links
            WHERE locker_submission_id = $1`,
          [body.submission.lockerSubmissionId],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].payload_hash !== payloadHash) {
            throw new HttpProblem(409, 'Отправка Locker уже синхронизирована с другим содержимым');
          }
          return { ...mapExisting(existing.rows[0]), replayed: true };
        }

        await lockLockerUser(client, body.user.telegramUserId);
        const person = await resolveLockerPerson(client, organization, body.user, request.id);
        const eventId = await resolveLockerEvent(client, organization, body.event, request.id);
        await client.query(
          `INSERT INTO event_participations
             (person_id, event_id, registered_at, decision, attendance, data_origin)
           VALUES ($1, $2, $3, 'UNKNOWN', 'UNKNOWN', 'LIVE')
           ON CONFLICT (person_id, event_id) WHERE archived_at IS NULL
           DO UPDATE SET registered_at = COALESCE(event_participations.registered_at, EXCLUDED.registered_at),
                         updated_at = now()`,
          [person.personId, eventId, new Date(body.submission.createdAt)],
        );
        const artifact = await createLockerArtifact(
          client,
          organization,
          person.personId,
          eventId,
          body,
          payloadHash,
          request.id,
        );
        return {
          personId: person.personId,
          personResolution: person.resolution,
          eventId,
          ...artifact,
          replayed: false,
        };
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    },
  );
}

async function lockLockerUser(client: PoolClient, telegramUserId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('locker-user:' || $1, 0))`, [
    telegramUserId,
  ]);
}

async function resolveLockerPerson(
  client: PoolClient,
  organization: OrganizationContext,
  user: LockerUserInput,
  requestId: string,
): Promise<{ personId: string; resolution: 'EXTERNAL_ID' | 'CONTACT' | 'CREATED' }> {
  const linked = await client.query<{ person_id: string }>(
    `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
       FROM external_identities identity
       JOIN persons person ON person.id = identity.person_id
      WHERE identity.organization_id = $1
        AND identity.archived_at IS NULL
        AND person.archived_at IS NULL
        AND ((identity.source_namespace = 'locker.user' AND identity.external_id = $2)
          OR (identity.source_namespace = 'locker.telegram' AND identity.external_id = $3))`,
    [organization.id, user.lockerUserId, user.telegramUserId],
  );
  const hinted = user.crmPersonId
    ? await client.query<{ person_id: string }>(
        `SELECT COALESCE(person.merged_into_person_id, person.id) AS person_id
           FROM persons person
          WHERE person.organization_id = $1
            AND person.id = $2
            AND person.archived_at IS NULL`,
        [organization.id, user.crmPersonId],
      )
    : { rows: [] as Array<{ person_id: string }> };
  const externallyLinkedIds = [
    ...new Set([...linked.rows, ...hinted.rows].map((row) => row.person_id)),
  ];
  if (externallyLinkedIds.length > 1) {
    throw new HttpProblem(409, 'Идентификаторы Locker связаны с разными участниками CRM');
  }

  const fio = parseRussianFullName(user.fullName);
  const normalizedName = fio?.normalizedFullName ?? normalizeFullName(user.fullName);
  const phone = user.phone?.trim() ? normalizePhone(user.phone) : null;
  const hadExternalLink = externallyLinkedIds.length === 1;
  let personId = externallyLinkedIds[0];
  let resolution: 'EXTERNAL_ID' | 'CONTACT' | 'CREATED' = 'EXTERNAL_ID';

  if (!personId) {
    const telegramMatch = await client.query<{ person_id: string }>(
      `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
         FROM contact_points contact
         JOIN persons person ON person.id = contact.person_id
        WHERE person.organization_id = $1
          AND person.archived_at IS NULL
          AND contact.archived_at IS NULL
          AND contact.type = 'TELEGRAM'
          AND contact.messenger_stable_id = $2`,
      [organization.id, user.telegramUserId],
    );
    const ids = [...new Set(telegramMatch.rows.map((row) => row.person_id))];
    if (ids.length > 1)
      throw new HttpProblem(409, 'Telegram ID указан у нескольких участников CRM');
    personId = ids[0];
  }

  if (!personId && phone && fio) {
    const phoneMatch = await client.query<{ person_id: string }>(
      `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
         FROM contact_points contact
         JOIN persons person ON person.id = contact.person_id
        WHERE person.organization_id = $1
          AND person.archived_at IS NULL
          AND contact.archived_at IS NULL
          AND contact.type = 'PHONE'
          AND contact.normalized_value = $2
          AND person.normalized_full_name = $3`,
      [organization.id, phone.e164, normalizedName],
    );
    const ids = [...new Set(phoneMatch.rows.map((row) => row.person_id))];
    if (ids.length === 1) personId = ids[0];
  }

  if (!personId && fio) {
    const exactNameMatch = await client.query<{ person_id: string }>(
      `WITH candidates AS (
         SELECT person.id AS person_id
           FROM persons person
          WHERE person.organization_id = $1
            AND person.archived_at IS NULL AND person.merged_into_person_id IS NULL
            AND person.normalized_full_name = $2
         UNION
         SELECT canonical.id
           FROM person_aliases alias
           JOIN persons member ON member.id = alias.person_id
           JOIN persons canonical
             ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
          WHERE canonical.organization_id = $1
            AND canonical.archived_at IS NULL AND canonical.merged_into_person_id IS NULL
            AND alias.archived_at IS NULL AND alias.normalized_value = $2
       )
       SELECT DISTINCT person_id FROM candidates ORDER BY person_id`,
      [organization.id, fio.normalizedFullName],
    );
    const ids = [...new Set(exactNameMatch.rows.map((row) => row.person_id))];
    if (ids.length > 1) {
      throw new HttpProblem(
        409,
        'ФИО соответствует нескольким участникам CRM',
        'Свяжите карточку вручную через crmPersonId, не объединяя разные Telegram ID.',
      );
    }
    personId = ids[0];
  }

  if (!personId) {
    if (!fio) {
      throw new HttpProblem(
        422,
        'Для участника требуется полное ФИО',
        'Укажите в боте фамилию, имя и отчество русскими буквами.',
      );
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO persons
         (organization_id, canonical_full_name, normalized_full_name,
          last_name, first_name, patronymic, lifecycle_data_state,
          activation_state, activity_status, applied_lifecycle_rule_set_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETE', 'NOT_ACTIVATED', 'UNKNOWN', $7)
       RETURNING id`,
      [
        organization.id,
        fio.canonicalFullName,
        fio.normalizedFullName,
        fio.lastName,
        fio.firstName,
        fio.patronymic,
        organization.ruleSetId,
      ],
    );
    personId = created.rows[0]!.id;
    resolution = 'CREATED';
    await client.query(
      `INSERT INTO person_aliases
         (person_id, raw_value, normalized_value, alias_type, data_origin, is_preferred)
       VALUES ($1, $2, $3, 'SOURCE_VARIANT', 'LIVE', true)`,
      [personId, fio.canonicalFullName, fio.normalizedFullName],
    );
    await client.query(
      `INSERT INTO person_search_documents
         (person_id, internal_ids, canonical_name, search_text)
       VALUES ($1::uuid, $1::uuid::text, $2, $2 || ' ' || $1::uuid::text)`,
      [personId, fio.normalizedFullName],
    );
    await writeAudit(client, {
      actor: LOCKER_ACTOR,
      requestId,
      action: 'locker.person_created',
      entityType: 'person',
      entityId: personId,
      after: { lockerUserId: user.lockerUserId, telegramUserId: user.telegramUserId },
    });
  } else if (!hadExternalLink) {
    resolution = 'CONTACT';
  }

  const conflictingTelegramIdentity = await client.query<{ telegram_user_id: string }>(
    `WITH cluster AS (
       SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
     ), identities AS (
       SELECT contact.messenger_stable_id AS telegram_user_id
         FROM contact_points contact
        WHERE contact.person_id IN (SELECT id FROM cluster)
          AND contact.type = 'TELEGRAM' AND contact.archived_at IS NULL
          AND contact.messenger_stable_id IS NOT NULL
       UNION
       SELECT identity.external_id
         FROM external_identities identity
        WHERE identity.person_id IN (SELECT id FROM cluster)
          AND identity.source_namespace = 'locker.telegram'
          AND identity.archived_at IS NULL
     )
     SELECT telegram_user_id FROM identities
      WHERE telegram_user_id <> $2
      ORDER BY telegram_user_id LIMIT 1`,
    [personId, user.telegramUserId],
  );
  if (conflictingTelegramIdentity.rows[0]) {
    throw new HttpProblem(
      409,
      'Участник CRM уже связан с другим Telegram ID',
      'Разные стабильные Telegram ID нельзя объединять в одну сущность участника.',
    );
  }

  await upsertLockerIdentities(client, organization.id, personId, user);
  await upsertLockerContacts(client, personId, user, phone?.e164 ?? null);
  await rebuildSearchDocument(client, personId);
  await writeAudit(client, {
    actor: LOCKER_ACTOR,
    requestId,
    action: 'locker.person_linked',
    entityType: 'person',
    entityId: personId,
    after: {
      lockerUserId: user.lockerUserId,
      telegramUserId: user.telegramUserId,
      resolution,
    },
  });
  return { personId, resolution };
}

async function upsertLockerIdentities(
  client: PoolClient,
  organizationId: string,
  personId: string,
  user: LockerUserInput,
): Promise<void> {
  for (const [namespace, externalId] of [
    ['locker.user', user.lockerUserId],
    ['locker.telegram', user.telegramUserId],
  ] as const) {
    await client.query(
      `INSERT INTO external_identities
         (organization_id, source_namespace, external_id, person_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, source_namespace, external_id)
         WHERE archived_at IS NULL
       DO UPDATE SET person_id = EXCLUDED.person_id, updated_at = now()`,
      [organizationId, namespace, externalId, personId],
    );
  }
}

async function upsertLockerContacts(
  client: PoolClient,
  personId: string,
  user: LockerUserInput,
  normalizedPhone: string | null,
): Promise<void> {
  const username = user.telegramUsername ? normalizeTelegramUsername(user.telegramUsername) : null;
  const telegramRaw = username ? `@${username}` : `Telegram ID ${user.telegramUserId}`;
  const telegramNormalized = username ?? `id:${user.telegramUserId}`;
  await client.query(
    `UPDATE contact_points
        SET is_primary = false, updated_at = now()
      WHERE person_id IN (
              SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
            )
        AND type = 'TELEGRAM' AND archived_at IS NULL
        AND messenger_stable_id IS DISTINCT FROM $2`,
    [personId, user.telegramUserId],
  );
  const telegram = await client.query<{ id: string }>(
    `SELECT id FROM contact_points
      WHERE person_id IN (
              SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
            )
        AND type = 'TELEGRAM'
        AND (
          messenger_stable_id = $2
          OR (messenger_stable_id IS NULL AND normalized_value = $3)
        )
        AND archived_at IS NULL
      ORDER BY (messenger_stable_id = $2) DESC, is_verified DESC,
               is_primary DESC, created_at, id
      LIMIT 1`,
    [personId, user.telegramUserId, telegramNormalized],
  );
  if (telegram.rows[0]) {
    await client.query(
      `UPDATE contact_points
          SET archived_at = now(), is_primary = false,
              updated_at = now(), version = version + 1
        WHERE person_id IN (
                SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
              )
          AND type = 'TELEGRAM' AND normalized_value = $2
          AND messenger_stable_id IS NULL AND archived_at IS NULL AND id <> $3`,
      [personId, telegramNormalized, telegram.rows[0].id],
    );
    await client.query(
      `UPDATE contact_points
          SET raw_value = $2, normalized_value = $3, messenger_stable_id = $4,
              is_primary = true, is_verified = true,
              updated_at = now(), version = version + 1
        WHERE id = $1`,
      [telegram.rows[0].id, telegramRaw, telegramNormalized, user.telegramUserId],
    );
  } else {
    await client.query(
      `INSERT INTO contact_points
         (person_id, type, raw_value, normalized_value, messenger_stable_id,
          is_primary, is_verified, data_origin)
       VALUES ($1, 'TELEGRAM', $2, $3, $4, true, true, 'LIVE')`,
      [personId, telegramRaw, telegramNormalized, user.telegramUserId],
    );
  }
  if (normalizedPhone && user.phone) {
    await client.query(
      `INSERT INTO contact_points
         (person_id, type, raw_value, normalized_value, is_primary, is_verified, data_origin)
       SELECT $1, 'PHONE', $2, $3, false, false, 'LIVE'
        WHERE NOT EXISTS (
          SELECT 1 FROM contact_points
           WHERE person_id IN (
                   SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
                 )
             AND type = 'PHONE' AND normalized_value = $3
             AND archived_at IS NULL
        )`,
      [personId, cleanText(user.phone, 100), normalizedPhone],
    );
    await queuePhoneDuplicateCandidates(client, personId, normalizedPhone);
  }
}

async function queuePhoneDuplicateCandidates(
  client: PoolClient,
  personId: string,
  normalizedPhone: string,
): Promise<void> {
  const matches = await client.query<{ person_id: string }>(
    `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
       FROM contact_points contact
       JOIN persons person ON person.id = contact.person_id
      WHERE contact.type = 'PHONE' AND contact.normalized_value = $1
        AND contact.archived_at IS NULL AND person.archived_at IS NULL
        AND COALESCE(person.merged_into_person_id, person.id) <> $2`,
    [normalizedPhone, personId],
  );
  for (const match of matches.rows) {
    const [personA, personB] = [personId, match.person_id].sort();
    const fingerprint = createHash('sha256')
      .update(`PHONE:${normalizedPhone}:${personA}:${personB}`)
      .digest('hex');
    await client.query(
      `INSERT INTO duplicate_candidates
         (person_a_id, person_b_id, confidence_basis_points, evidence_fingerprint,
          reasons, conflicts)
       VALUES ($1, $2, 9000, $3, '["Совпал телефон"]'::jsonb, '[]'::jsonb)
       ON CONFLICT (person_a_id, person_b_id, evidence_fingerprint) DO NOTHING`,
      [personA, personB, fingerprint],
    );
  }
}

async function rebuildSearchDocument(client: PoolClient, personId: string): Promise<void> {
  await client.query(
    `INSERT INTO person_search_documents
       (person_id, internal_ids, canonical_name, contacts, search_text)
     SELECT canonical.id,
            string_agg(DISTINCT member.id::text, ' ' ORDER BY member.id::text),
            canonical.normalized_full_name,
            COALESCE(string_agg(DISTINCT contact.raw_value, ' ' ORDER BY contact.raw_value), ''),
            trim(concat_ws(' ', canonical.normalized_full_name, canonical.id::text,
                 string_agg(DISTINCT member.id::text, ' ' ORDER BY member.id::text),
                 string_agg(DISTINCT contact.raw_value, ' ' ORDER BY contact.raw_value)))
       FROM persons requested
       JOIN persons canonical ON canonical.id = COALESCE(requested.merged_into_person_id, requested.id)
       LEFT JOIN persons member
         ON member.id = canonical.id OR member.merged_into_person_id = canonical.id
       LEFT JOIN contact_points contact
         ON contact.person_id = member.id AND contact.archived_at IS NULL
      WHERE requested.id = $1
      GROUP BY canonical.id, canonical.normalized_full_name
     ON CONFLICT (person_id) DO UPDATE
       SET internal_ids = EXCLUDED.internal_ids,
           canonical_name = EXCLUDED.canonical_name,
           contacts = EXCLUDED.contacts,
           search_text = EXCLUDED.search_text,
           rebuilt_at = now(), updated_at = now()`,
    [personId],
  );
}

async function resolveLockerEvent(
  client: PoolClient,
  organization: OrganizationContext,
  event: LockerEventInput,
  requestId: string,
): Promise<string> {
  const linked = await client.query<{ event_id: string }>(
    `SELECT event_id FROM locker_event_links WHERE locker_event_id = $1`,
    [event.lockerEventId],
  );
  if (linked.rows[0]) return linked.rows[0].event_id;

  const name = cleanText(event.title, 500);
  const normalizedName = normalizeFullName(name);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM events
      WHERE organization_id = $1 AND normalized_name = $2 AND archived_at IS NULL
      LIMIT 1`,
    [organization.id, normalizedName],
  );
  let eventId = existing.rows[0]?.id;
  const startsAt = new Date(event.startsAt);
  const rawEndsAt = new Date(event.endsAt);
  const endsAt = rawEndsAt > startsAt ? rawEndsAt : null;
  if (!eventId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO events
         (organization_id, name, normalized_name, status, starts_at, ends_at, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, normalized_name) WHERE archived_at IS NULL
       DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        organization.id,
        name,
        normalizedName,
        mapLockerEventStatus(event.status),
        startsAt,
        endsAt,
        LOCKER_ACTOR.userId,
      ],
    );
    eventId = inserted.rows[0]!.id;
    await writeAudit(client, {
      actor: LOCKER_ACTOR,
      requestId,
      action: 'locker.event_created',
      entityType: 'event',
      entityId: eventId,
      after: { lockerEventId: event.lockerEventId, name },
    });
  } else {
    await client.query(
      `UPDATE events
          SET starts_at = COALESCE(starts_at, $2), ends_at = COALESCE(ends_at, $3),
              status = CASE WHEN status IN ('UNKNOWN', 'PLANNED') THEN $4 ELSE status END,
              updated_at = now()
        WHERE id = $1`,
      [eventId, startsAt, endsAt, mapLockerEventStatus(event.status)],
    );
  }
  await client.query(
    `INSERT INTO locker_event_links (locker_event_id, event_id)
     VALUES ($1, $2)
     ON CONFLICT (locker_event_id) DO NOTHING`,
    [event.lockerEventId, eventId],
  );
  return eventId;
}

async function createLockerArtifact(
  client: PoolClient,
  organization: OrganizationContext,
  personId: string,
  eventId: string,
  body: LockerSyncInput,
  payloadHash: string,
  requestId: string,
): Promise<{ artifactId: string; artifactVersionId: string }> {
  const type = await client.query<{ id: string }>(
    `SELECT id FROM artifact_types WHERE code = 'OTHER' AND archived_at IS NULL`,
  );
  if (!type.rows[0]) throw new HttpProblem(503, 'Тип артефакта OTHER не настроен');
  const title = cleanText(body.submission.title || `Материалы: ${body.event.title}`, 500);
  const artifact = await client.query<{ id: string }>(
    `INSERT INTO artifacts
       (organization_id, type_id, title, description, event_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [organization.id, type.rows[0].id, title, 'Получено из Locker', eventId, LOCKER_ACTOR.userId],
  );
  const artifactId = artifact.rows[0]!.id;
  const normalizedLink = body.submission.link?.trim() || null;
  const textContent =
    body.submission.text?.trim() ||
    (!normalizedLink && body.submission.files.length === 0
      ? body.submission.title?.trim() || title
      : null);
  const contentType = artifactContentType(
    Boolean(textContent),
    Boolean(normalizedLink),
    body.submission.files.length > 0,
  );
  const fingerprint = createContentFingerprint({
    text: textContent,
    urls: normalizedLink ? [normalizedLink] : [],
    fileSha256s: body.submission.files.map((file) => file.checksumSha256),
  });
  const version = await client.query<{ id: string }>(
    `INSERT INTO artifact_versions
       (artifact_id, version_number, content_type, text_content, content_fingerprint,
        uploaded_by_user_id, data_origin)
     VALUES ($1, 1, $2, $3, $4, $5, 'LIVE')
     RETURNING id`,
    [artifactId, contentType, textContent, fingerprint, LOCKER_ACTOR.userId],
  );
  const artifactVersionId = version.rows[0]!.id;
  await client.query(
    `INSERT INTO artifact_version_contributors
       (artifact_version_id, person_id, contribution_role, authorship_source)
     VALUES ($1, $2, 'AUTHOR', 'LOCKER_TELEGRAM')`,
    [artifactVersionId, personId],
  );

  let displayOrder = 0;
  const files = [...body.submission.files].sort((left, right) =>
    left.lockerArtifactId.localeCompare(right.lockerArtifactId),
  );
  for (const file of files) {
    const fileObject = await client.query<{ id: string }>(
      `INSERT INTO file_objects
         (bucket, object_key, original_filename, declared_mime_type, detected_mime_type,
          size_bytes, sha256, status, scan_result, storage_provider, external_id,
          uploaded_by_user_id, available_at)
       VALUES ('locker', $1, $2, $3, $3, $4, $5, 'AVAILABLE', $6::jsonb,
               'LOCKER', $1, $7, $8)
       ON CONFLICT (storage_provider, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET original_filename = EXCLUDED.original_filename,
                     declared_mime_type = EXCLUDED.declared_mime_type,
                     detected_mime_type = EXCLUDED.detected_mime_type,
                     size_bytes = EXCLUDED.size_bytes,
                     sha256 = EXCLUDED.sha256,
                     status = 'AVAILABLE', scan_result = EXCLUDED.scan_result,
                     available_at = EXCLUDED.available_at, updated_at = now()
       RETURNING id`,
      [
        file.lockerArtifactId,
        cleanText(file.originalName, 500),
        file.mimeType,
        file.sizeBytes,
        file.checksumSha256,
        JSON.stringify({ source: 'LOCKER', verifiedAt: file.readyAt }),
        LOCKER_ACTOR.userId,
        new Date(file.readyAt),
      ],
    );
    await client.query(
      `INSERT INTO artifact_assets
         (artifact_version_id, asset_type, file_object_id, display_order)
       VALUES ($1, 'FILE', $2, $3)`,
      [artifactVersionId, fileObject.rows[0]!.id, displayOrder++],
    );
  }
  if (normalizedLink) {
    await client.query(
      `INSERT INTO artifact_assets
         (artifact_version_id, asset_type, external_url, display_order)
       VALUES ($1, 'EXTERNAL_URL', $2, $3)`,
      [artifactVersionId, normalizedLink, displayOrder++],
    );
  }
  await client.query(
    `UPDATE artifact_versions
        SET status = 'SUBMITTED', submitted_at = $2, recorded_at = now(),
            qualifies_for_activation = true, qualifies_for_activity = true,
            countability_reasons = '{"countable":true,"source":"LOCKER","storage":"REMOTE"}'::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [artifactVersionId, new Date(body.submission.submittedAt)],
  );
  await client.query(
    `INSERT INTO locker_submission_links
       (locker_submission_id, locker_user_id, telegram_user_id, person_id,
        locker_event_id, event_id, artifact_id, artifact_version_id, payload_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      body.submission.lockerSubmissionId,
      body.user.lockerUserId,
      body.user.telegramUserId,
      personId,
      body.event.lockerEventId,
      eventId,
      artifactId,
      artifactVersionId,
      payloadHash,
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ('artifact_version_became_countable', 'artifact_version', $1, $2::jsonb)`,
    [
      artifactVersionId,
      JSON.stringify({
        versionId: artifactVersionId,
        authorIds: [personId],
        submittedAt: body.submission.submittedAt,
        source: 'LOCKER',
      }),
    ],
  );
  await recalculatePersonLifecycle(
    client,
    personId,
    'ARTIFACT_BECAME_COUNTABLE',
    artifactVersionId,
  );
  await writeAudit(client, {
    actor: LOCKER_ACTOR,
    requestId,
    action: 'locker.submission_synced',
    entityType: 'artifact_version',
    entityId: artifactVersionId,
    after: {
      lockerSubmissionId: body.submission.lockerSubmissionId,
      lockerUserId: body.user.lockerUserId,
      personId,
      eventId,
      remoteFileCount: files.length,
    },
  });
  return { artifactId, artifactVersionId };
}

function mapExisting(row: {
  person_id: string;
  event_id: string;
  artifact_id: string;
  artifact_version_id: string;
}) {
  return {
    personId: row.person_id,
    personResolution: 'EXTERNAL_ID' as const,
    eventId: row.event_id,
    artifactId: row.artifact_id,
    artifactVersionId: row.artifact_version_id,
  };
}

export function mapLockerEventStatus(
  status: LockerEventInput['status'],
): 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' {
  if (status === 'running') return 'ACTIVE';
  if (status === 'finished') return 'COMPLETED';
  if (status === 'archived') return 'COMPLETED';
  return 'PLANNED';
}

export function artifactContentType(
  hasText: boolean,
  hasUrl: boolean,
  hasFiles: boolean,
): 'FILE' | 'EXTERNAL_URL' | 'TEXT' | 'MIXED' {
  const count = Number(hasText) + Number(hasUrl) + Number(hasFiles);
  if (count > 1) return 'MIXED';
  if (hasFiles) return 'FILE';
  if (hasUrl) return 'EXTERNAL_URL';
  return 'TEXT';
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function hashLockerSubmissionPayload(body: LockerSyncInput): string {
  return hashPayload({
    schemaVersion: body.schemaVersion,
    lockerUserId: body.user.lockerUserId,
    telegramUserId: body.user.telegramUserId,
    lockerEventId: body.event.lockerEventId,
    submission: body.submission,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function cleanText(value: string, maximum: number): string {
  return normalizeUnicode(value).replace(/\s+/gu, ' ').trim().slice(0, maximum);
}
