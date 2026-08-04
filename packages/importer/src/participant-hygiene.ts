import { createHash, randomUUID } from 'node:crypto';

import { autoResolveDuplicateCandidatesInTransaction } from '@cpi-crm/db';
import {
  assessParticipantComment,
  normalizeEmail,
  normalizePhone,
  normalizeTelegramUsername,
  parseRussianFullName,
} from '@cpi-crm/domain';
import type { Pool, PoolClient } from 'pg';

export const STRICT_PARTICIPANT_HYGIENE_VERSION = 'STRICT_PARTICIPANT_HYGIENE_V1';

export interface ParticipantHygieneSnapshot {
  readonly activeCanonicalPeople: number;
  readonly validFio: number;
  readonly invalidFio: number;
  readonly repairableFio: number;
  readonly archiveCandidates: number;
  readonly exactNameDuplicateGroups: number;
  readonly strongDuplicatePairs: number;
  readonly duplicateContactsInsideEntities: number;
  readonly invalidContacts: number;
  readonly invalidComments: number;
  readonly telegramContacts: number;
  readonly telegramStableIds: number;
}

export interface ParticipantHygieneResult {
  readonly policyVersion: typeof STRICT_PARTICIPANT_HYGIENE_VERSION;
  readonly before: ParticipantHygieneSnapshot;
  readonly repairedPeople: number;
  readonly archivedCanonicalPeople: number;
  readonly archivedPersonRows: number;
  readonly archivedContacts: number;
  readonly archivedParticipations: number;
  readonly archivedExternalIdentities: number;
  readonly invalidContactsArchived: number;
  readonly duplicateContactsArchived: number;
  readonly commentsCleared: number;
  readonly duplicateProfilesMerged: number;
  readonly after: ParticipantHygieneSnapshot;
}

interface PersonRow {
  readonly id: string;
  readonly canonical_full_name: string;
  readonly notes: string | null;
}

interface VariantRow {
  readonly canonical_id: string;
  readonly candidate: string;
  readonly priority: number;
}

interface ContactRow {
  readonly id: string;
  readonly canonical_id: string;
  readonly type: string;
  readonly raw_value: string;
  readonly normalized_value: string;
  readonly messenger_stable_id: string | null;
  readonly is_primary: boolean;
  readonly is_verified: boolean;
  readonly created_at: Date;
}

async function activePeople(client: PoolClient, organizationId: string): Promise<PersonRow[]> {
  const result = await client.query<PersonRow>(
    `SELECT id, canonical_full_name, notes
       FROM persons
      WHERE organization_id = $1 AND archived_at IS NULL AND merged_into_person_id IS NULL
      ORDER BY id`,
    [organizationId],
  );
  return result.rows;
}

async function nameVariants(
  client: PoolClient,
  organizationId: string,
  canonicalIds: readonly string[],
): Promise<VariantRow[]> {
  if (canonicalIds.length === 0) return [];
  const result = await client.query<VariantRow>(
    `WITH roots AS (
       SELECT id FROM persons
        WHERE organization_id = $1 AND id = ANY($2::uuid[])
     ), members AS (
       SELECT root.id AS canonical_id, member.id AS member_id, member.canonical_full_name
         FROM roots root
         JOIN persons member ON member.id = root.id OR member.merged_into_person_id = root.id
     )
     SELECT canonical_id, canonical_full_name AS candidate, 10 AS priority FROM members
     UNION ALL
     SELECT member.canonical_id, alias.raw_value,
            CASE WHEN alias.is_preferred THEN 20 ELSE 30 END
       FROM members member
       JOIN person_aliases alias ON alias.person_id = member.member_id
      WHERE alias.archived_at IS NULL
     UNION ALL
     SELECT member.canonical_id, observation.raw_values ->> 'fullName', 40
       FROM members member
       JOIN person_observations observation ON observation.resolved_person_id = member.member_id
      WHERE nullif(btrim(observation.raw_values ->> 'fullName'), '') IS NOT NULL
     ORDER BY canonical_id, priority, candidate`,
    [organizationId, canonicalIds],
  );
  return result.rows;
}

function repairableNames(
  invalidPeople: readonly PersonRow[],
  variants: readonly VariantRow[],
): Map<string, NonNullable<ReturnType<typeof parseRussianFullName>>> {
  const invalidIds = new Set(invalidPeople.map((person) => person.id));
  const result = new Map<string, NonNullable<ReturnType<typeof parseRussianFullName>>>();
  for (const variant of variants) {
    if (!invalidIds.has(variant.canonical_id) || result.has(variant.canonical_id)) continue;
    const parsed = parseRussianFullName(variant.candidate);
    if (parsed) result.set(variant.canonical_id, parsed);
  }
  return result;
}

function validContact(contact: ContactRow): boolean {
  if (!contact.raw_value.trim() || !contact.normalized_value.trim()) return false;
  if (contact.type === 'EMAIL') {
    const normalized = normalizeEmail(contact.raw_value);
    return (
      normalized === contact.normalized_value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    );
  }
  if (contact.type === 'PHONE') {
    return normalizePhone(contact.raw_value)?.e164 === contact.normalized_value;
  }
  if (contact.type === 'TELEGRAM') {
    if (contact.messenger_stable_id !== null) {
      return /^[0-9]+$/u.test(contact.messenger_stable_id);
    }
    return normalizeTelegramUsername(contact.raw_value) === contact.normalized_value;
  }
  return contact.normalized_value.length <= 500;
}

function duplicateContactIds(contacts: readonly ContactRow[]): string[] {
  const grouped = new Map<string, ContactRow[]>();
  for (const contact of contacts) {
    const key = `${contact.canonical_id}\u0000${contact.type}\u0000${contact.normalized_value}`;
    const group = grouped.get(key) ?? [];
    group.push(contact);
    grouped.set(key, group);
  }
  const duplicateIds: string[] = [];
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => {
      const identity =
        Number(right.messenger_stable_id !== null) - Number(left.messenger_stable_id !== null);
      if (identity !== 0) return identity;
      const verified = Number(right.is_verified) - Number(left.is_verified);
      if (verified !== 0) return verified;
      const primary = Number(right.is_primary) - Number(left.is_primary);
      if (primary !== 0) return primary;
      return (
        left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id)
      );
    });
    duplicateIds.push(...group.slice(1).map((contact) => contact.id));
  }
  return duplicateIds;
}

async function activeContacts(client: PoolClient, organizationId: string): Promise<ContactRow[]> {
  const result = await client.query<ContactRow>(
    `SELECT contact.id, COALESCE(person.merged_into_person_id, person.id) AS canonical_id,
            contact.type, contact.raw_value, contact.normalized_value,
            contact.messenger_stable_id, contact.is_primary, contact.is_verified,
            contact.created_at
       FROM contact_points contact
       JOIN persons person ON person.id = contact.person_id
       JOIN persons canonical ON canonical.id = COALESCE(person.merged_into_person_id, person.id)
      WHERE canonical.organization_id = $1
        AND canonical.archived_at IS NULL AND canonical.merged_into_person_id IS NULL
        AND person.archived_at IS NULL AND contact.archived_at IS NULL
      ORDER BY canonical_id, contact.created_at, contact.id`,
    [organizationId],
  );
  return result.rows;
}

async function duplicateMetrics(client: PoolClient, organizationId: string) {
  const result = await client.query<{
    exact_groups: string;
    strong_pairs: string;
  }>(
    `WITH active AS (
       SELECT id, normalized_full_name
         FROM persons
        WHERE organization_id = $1 AND archived_at IS NULL AND merged_into_person_id IS NULL
     ), exact_groups AS (
       SELECT normalized_full_name FROM active GROUP BY normalized_full_name HAVING count(*) > 1
     ), strong_pairs AS (
       SELECT DISTINCT least(left_person.id, right_person.id) AS left_id,
                       greatest(left_person.id, right_person.id) AS right_id
         FROM active left_person
         JOIN active right_person
           ON right_person.id > left_person.id
          AND right_person.normalized_full_name = left_person.normalized_full_name
     )
     SELECT (SELECT count(*) FROM exact_groups)::text AS exact_groups,
            (SELECT count(*) FROM strong_pairs)::text AS strong_pairs`,
    [organizationId],
  );
  return {
    exactNameDuplicateGroups: Number(result.rows[0]?.exact_groups ?? 0),
    strongDuplicatePairs: Number(result.rows[0]?.strong_pairs ?? 0),
  };
}

export async function inspectParticipantHygiene(
  client: PoolClient,
  organizationId: string,
): Promise<ParticipantHygieneSnapshot> {
  const people = await activePeople(client, organizationId);
  const invalidPeople = people.filter(
    (person) => !parseRussianFullName(person.canonical_full_name),
  );
  const variants = await nameVariants(
    client,
    organizationId,
    invalidPeople.map((person) => person.id),
  );
  const repairs = repairableNames(invalidPeople, variants);
  const contacts = await activeContacts(client, organizationId);
  const duplicateMetricsResult = await duplicateMetrics(client, organizationId);
  return {
    activeCanonicalPeople: people.length,
    validFio: people.length - invalidPeople.length,
    invalidFio: invalidPeople.length,
    repairableFio: repairs.size,
    archiveCandidates: invalidPeople.length - repairs.size,
    exactNameDuplicateGroups: duplicateMetricsResult.exactNameDuplicateGroups,
    strongDuplicatePairs: duplicateMetricsResult.strongDuplicatePairs,
    duplicateContactsInsideEntities: duplicateContactIds(contacts).length,
    invalidContacts: contacts.filter((contact) => !validContact(contact)).length,
    invalidComments: people.filter(
      (person) => person.notes !== null && !assessParticipantComment(person.notes).accepted,
    ).length,
    telegramContacts: contacts.filter((contact) => contact.type === 'TELEGRAM').length,
    telegramStableIds: contacts.filter(
      (contact) => contact.type === 'TELEGRAM' && contact.messenger_stable_id !== null,
    ).length,
  };
}

async function archiveByPersonIds(
  client: PoolClient,
  table: string,
  personIds: readonly string[],
): Promise<number> {
  if (personIds.length === 0) return 0;
  const allowed = new Set([
    'contact_points',
    'person_aliases',
    'affiliations',
    'team_memberships',
    'event_participations',
    'external_identities',
    'tasks',
    'interactions',
  ]);
  if (!allowed.has(table)) throw new Error(`Unsupported hygiene table: ${table}`);
  const result = await client.query(
    `UPDATE ${table}
        SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL`,
    [personIds],
  );
  return result.rowCount ?? 0;
}

async function queueStrongDuplicatePairs(
  client: PoolClient,
  organizationId: string,
): Promise<void> {
  const pairs = await client.query<{ left_id: string; right_id: string }>(
    `WITH active AS (
       SELECT id, normalized_full_name
         FROM persons
        WHERE organization_id = $1 AND archived_at IS NULL AND merged_into_person_id IS NULL
     )
     SELECT DISTINCT left_person.id AS left_id, right_person.id AS right_id
       FROM active left_person
       JOIN active right_person
         ON right_person.id > left_person.id
        AND right_person.normalized_full_name = left_person.normalized_full_name
      ORDER BY left_id, right_id`,
    [organizationId],
  );
  for (const pair of pairs.rows) {
    const fingerprint = createHash('sha256')
      .update(`${STRICT_PARTICIPANT_HYGIENE_VERSION}:${pair.left_id}:${pair.right_id}:EXACT_FIO`)
      .digest('hex');
    await client.query(
      `INSERT INTO duplicate_candidates
         (person_a_id, person_b_id, confidence_basis_points, evidence_fingerprint,
          reasons, conflicts)
       VALUES ($1, $2, 9800, $3, $4::jsonb, '[]'::jsonb)
       ON CONFLICT (person_a_id, person_b_id, evidence_fingerprint) DO NOTHING`,
      [
        pair.left_id,
        pair.right_id,
        fingerprint,
        JSON.stringify(['Совпало строгое полное ФИО; конфликт стабильных ID отсутствует']),
      ],
    );
  }
}

export async function applyParticipantHygiene(
  pool: Pool,
  input: { readonly organizationId: string; readonly actorUserId: string },
): Promise<ParticipantHygieneResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('strict-participant-hygiene:' || $1, 0))`,
      [input.organizationId],
    );
    const before = await inspectParticipantHygiene(client, input.organizationId);
    const people = await client.query<PersonRow>(
      `SELECT id, canonical_full_name, notes
         FROM persons
        WHERE organization_id = $1 AND archived_at IS NULL AND merged_into_person_id IS NULL
        ORDER BY id FOR UPDATE`,
      [input.organizationId],
    );
    const invalidPeople = people.rows.filter(
      (person) => !parseRussianFullName(person.canonical_full_name),
    );
    const variants = await nameVariants(
      client,
      input.organizationId,
      invalidPeople.map((person) => person.id),
    );
    const repairs = repairableNames(invalidPeople, variants);
    for (const [personId, fio] of repairs) {
      await client.query(
        `UPDATE persons
            SET canonical_full_name = $2, normalized_full_name = $3,
                last_name = $4, first_name = $5, patronymic = $6,
                updated_at = now(), version = version + 1
          WHERE id = $1`,
        [
          personId,
          fio.canonicalFullName,
          fio.normalizedFullName,
          fio.lastName,
          fio.firstName,
          fio.patronymic,
        ],
      );
      await client.query(
        `UPDATE person_search_documents
            SET canonical_name = $2::text,
                search_text = trim(concat_ws(' ', $2::text, internal_ids, contacts)),
                rebuilt_at = now(), updated_at = now()
          WHERE person_id = $1`,
        [personId, fio.normalizedFullName],
      );
    }

    const archiveCanonicalIds = invalidPeople
      .filter((person) => !repairs.has(person.id))
      .map((person) => person.id);
    const clusterRows =
      archiveCanonicalIds.length === 0
        ? { rows: [] as Array<{ id: string }> }
        : await client.query<{ id: string }>(
            `SELECT id FROM persons
              WHERE id = ANY($1::uuid[]) OR merged_into_person_id = ANY($1::uuid[])
              ORDER BY id FOR UPDATE`,
            [archiveCanonicalIds],
          );
    const archivePersonIds = clusterRows.rows.map((row) => row.id);
    const archivedContacts = await archiveByPersonIds(client, 'contact_points', archivePersonIds);
    await archiveByPersonIds(client, 'person_aliases', archivePersonIds);
    await archiveByPersonIds(client, 'affiliations', archivePersonIds);
    await archiveByPersonIds(client, 'team_memberships', archivePersonIds);
    const archivedParticipations = await archiveByPersonIds(
      client,
      'event_participations',
      archivePersonIds,
    );
    const archivedExternalIdentities = await archiveByPersonIds(
      client,
      'external_identities',
      archivePersonIds,
    );
    await archiveByPersonIds(client, 'tasks', archivePersonIds);
    await archiveByPersonIds(client, 'interactions', archivePersonIds);
    if (archivePersonIds.length > 0) {
      await client.query(
        `UPDATE duplicate_candidates
            SET status = 'DISMISSED', decided_at = now(), decided_by_user_id = $2,
                decision_reason = $3, updated_at = now()
          WHERE status = 'OPEN'
            AND (person_a_id = ANY($1::uuid[]) OR person_b_id = ANY($1::uuid[]))`,
        [archivePersonIds, input.actorUserId, `${STRICT_PARTICIPANT_HYGIENE_VERSION}:INVALID_FIO`],
      );
    }
    const archivedPeople =
      archivePersonIds.length === 0
        ? { rowCount: 0 }
        : await client.query(
            `UPDATE persons
                SET archived_at = now(), updated_at = now(), version = version + 1
              WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
            [archivePersonIds],
          );

    let commentsCleared = 0;
    for (const person of people.rows) {
      if (archiveCanonicalIds.includes(person.id) || person.notes === null) continue;
      const assessment = assessParticipantComment(person.notes);
      if (!assessment.accepted) {
        const result = await client.query(
          `UPDATE persons SET notes = NULL, updated_at = now(), version = version + 1
            WHERE id = $1 AND notes IS NOT NULL`,
          [person.id],
        );
        commentsCleared += result.rowCount ?? 0;
      } else if (assessment.value !== person.notes) {
        await client.query(
          `UPDATE persons SET notes = $2, updated_at = now(), version = version + 1
            WHERE id = $1`,
          [person.id, assessment.value],
        );
      }
    }

    const contactsBeforeMerge = await activeContacts(client, input.organizationId);
    const invalidContactIds = contactsBeforeMerge
      .filter((contact) => !validContact(contact))
      .map((contact) => contact.id);
    const invalidContactsArchived =
      invalidContactIds.length === 0
        ? 0
        : ((
            await client.query(
              `UPDATE contact_points
                  SET archived_at = now(), is_primary = false,
                      updated_at = now(), version = version + 1
                WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
              [invalidContactIds],
            )
          ).rowCount ?? 0);

    await queueStrongDuplicatePairs(client, input.organizationId);
    const deduplication = await autoResolveDuplicateCandidatesInTransaction(client, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorSubject: 'participant-hygiene',
      requestId: `participant-hygiene:${randomUUID()}`,
    });

    const contactsAfterMerge = await activeContacts(client, input.organizationId);
    const repeatedContactIds = duplicateContactIds(contactsAfterMerge);
    const duplicateContactsArchived =
      repeatedContactIds.length === 0
        ? 0
        : ((
            await client.query(
              `UPDATE contact_points
                  SET archived_at = now(), is_primary = false,
                      updated_at = now(), version = version + 1
                WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
              [repeatedContactIds],
            )
          ).rowCount ?? 0);

    await client.query('ALTER TABLE persons VALIDATE CONSTRAINT persons_active_russian_fio_check');
    await client.query('ALTER TABLE persons VALIDATE CONSTRAINT persons_notes_valid_check');
    const after = await inspectParticipantHygiene(client, input.organizationId);
    const result: ParticipantHygieneResult = {
      policyVersion: STRICT_PARTICIPANT_HYGIENE_VERSION,
      before,
      repairedPeople: repairs.size,
      archivedCanonicalPeople: archiveCanonicalIds.length,
      archivedPersonRows: archivedPeople.rowCount ?? 0,
      archivedContacts,
      archivedParticipations,
      archivedExternalIdentities,
      invalidContactsArchived,
      duplicateContactsArchived,
      commentsCleared,
      duplicateProfilesMerged: deduplication.mergedProfiles,
      after,
    };
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
       VALUES ($1, 'participant-hygiene', $2, 'participants.hygiene_applied',
               'organization', $3, $4::jsonb, $5)`,
      [
        input.actorUserId,
        `participant-hygiene:${randomUUID()}`,
        input.organizationId,
        JSON.stringify(result),
        STRICT_PARTICIPANT_HYGIENE_VERSION,
      ],
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
