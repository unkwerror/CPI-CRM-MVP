import type { PoolClient } from 'pg';

import type { JsonValue, PersonObservation, WorkbookImportPlan } from './types.js';

export const PERSON_NAME_HYGIENE_POLICY_VERSION = 'PERSON_NAME_HYGIENE_V1';

export type InvalidPersonNameReason =
  | 'MISSING_OR_GENERATED_PLACEHOLDER'
  | 'TEST_PLACEHOLDER'
  | 'GIBBERISH_PLACEHOLDER'
  | 'SERVICE_PLACEHOLDER'
  | 'URL_IN_NAME'
  | 'EMAIL_IN_NAME'
  | 'PHONE_OR_NUMERIC_IN_NAME'
  | 'NO_LETTERS'
  | 'TOO_SHORT'
  | 'REPEATED_CHARACTER';

export type PersonNameAssessment =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: InvalidPersonNameReason };

export interface PersonNameHygieneSummary {
  readonly policyVersion: typeof PERSON_NAME_HYGIENE_POLICY_VERSION;
  readonly acceptedObservations: number;
  readonly rejectedObservations: number;
  readonly ignoredSourceRows: number;
  readonly reasons: Readonly<Record<InvalidPersonNameReason, number>>;
}

export interface PersonNameHygieneCleanupResult {
  readonly policyVersion: typeof PERSON_NAME_HYGIENE_POLICY_VERSION;
  readonly archivedPersons: number;
  readonly archivedContacts: number;
  readonly archivedEventParticipations: number;
  readonly archivedExternalIdentities: number;
  readonly detachedProvenanceLinks: number;
  readonly rejectedExistingObservations: number;
  readonly dismissedDuplicateCandidates: number;
  readonly protectedPersons: number;
}

const EMPTY_REASON_COUNTS: Record<InvalidPersonNameReason, number> = {
  MISSING_OR_GENERATED_PLACEHOLDER: 0,
  TEST_PLACEHOLDER: 0,
  GIBBERISH_PLACEHOLDER: 0,
  SERVICE_PLACEHOLDER: 0,
  URL_IN_NAME: 0,
  EMAIL_IN_NAME: 0,
  PHONE_OR_NUMERIC_IN_NAME: 0,
  NO_LETTERS: 0,
  TOO_SHORT: 0,
  REPEATED_CHARACTER: 0,
};

const SERVICE_PLACEHOLDER =
  /^(?:неизвестно|неизвестный|не\s+указано|не\s+указан|не\s+задано|нет\s+данных|отсутствует|без\s+имени|без\s+команды|аноним|участник|participant|пользователь|user|контактное\s+лицо|представитель|организатор|команда|фио|fio|имя|name|none|null|undefined|n\/?a)$/iu;

function normalizedInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Deliberately conservative: it rejects deterministic placeholders and impossible
 * names, but accepts uncommon, one-token and mixed-script names for later human use.
 */
export function assessPersonName(value: unknown): PersonNameAssessment {
  const name = normalizedInput(value);
  const lowered = name.toLocaleLowerCase('ru');
  if (name.length === 0 || /^неизвестный участник(?:\s*\(|$)/u.test(lowered)) {
    return { accepted: false, reason: 'MISSING_OR_GENERATED_PLACEHOLDER' };
  }
  if (/^(?:https?:\/\/|www\.)/iu.test(name)) {
    return { accepted: false, reason: 'URL_IN_NAME' };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(name)) {
    return { accepted: false, reason: 'EMAIL_IN_NAME' };
  }

  const letters = [...lowered.matchAll(/\p{L}/gu)].map((match) => match[0]);
  if (letters.length === 0) {
    const digits = name.replace(/\D/gu, '');
    return {
      accepted: false,
      reason: digits.length >= 7 ? 'PHONE_OR_NUMERIC_IN_NAME' : 'NO_LETTERS',
    };
  }
  if (letters.length < 2) return { accepted: false, reason: 'TOO_SHORT' };

  if (/^(?:(?:test|тест)[\s._#№-]*)+[0-9]*$/iu.test(lowered)) {
    return { accepted: false, reason: 'TEST_PLACEHOLDER' };
  }
  if (
    /^(?:(?:abracadabra|абракадабра|qwerty|asdfgh?|zxcvbn|йцукен|фывапр|ячсмит|dummy|fake)[\s._#№-]*)+[0-9]*$/iu.test(
      lowered,
    )
  ) {
    return { accepted: false, reason: 'GIBBERISH_PLACEHOLDER' };
  }
  if (SERVICE_PLACEHOLDER.test(lowered)) {
    return { accepted: false, reason: 'SERVICE_PLACEHOLDER' };
  }

  const compactLetters = letters.join('');
  if (
    (compactLetters.length >= 3 && new Set(compactLetters).size === 1) ||
    /(.)\1{4,}/u.test(lowered)
  ) {
    return { accepted: false, reason: 'REPEATED_CHARACTER' };
  }
  return { accepted: true };
}

function rawObservedName(observation: PersonObservation): JsonValue | undefined {
  return observation.rawValues.fullName;
}

export function assessPersonObservation(observation: PersonObservation): PersonNameAssessment {
  return assessPersonName(rawObservedName(observation));
}

export function summarizePersonNameHygiene(
  plan: Pick<WorkbookImportPlan, 'observations'>,
): PersonNameHygieneSummary {
  const reasons = { ...EMPTY_REASON_COUNTS };
  const rows = new Map<string, { accepted: number; rejected: number }>();
  let acceptedObservations = 0;
  let rejectedObservations = 0;

  for (const observation of plan.observations) {
    const assessment = assessPersonObservation(observation);
    const key = `${observation.sheetName}\u0000${observation.rowNumber}`;
    const row = rows.get(key) ?? { accepted: 0, rejected: 0 };
    if (assessment.accepted) {
      acceptedObservations += 1;
      row.accepted += 1;
    } else {
      rejectedObservations += 1;
      row.rejected += 1;
      reasons[assessment.reason] += 1;
    }
    rows.set(key, row);
  }

  return Object.freeze({
    policyVersion: PERSON_NAME_HYGIENE_POLICY_VERSION,
    acceptedObservations,
    rejectedObservations,
    ignoredSourceRows: [...rows.values()].filter((row) => row.accepted === 0 && row.rejected > 0)
      .length,
    reasons: Object.freeze(reasons),
  });
}

function observationName(rawValues: unknown): unknown {
  if (rawValues === null || typeof rawValues !== 'object' || Array.isArray(rawValues)) return null;
  return (rawValues as Record<string, unknown>).fullName;
}

/**
 * Archives importer-created garbage cards while retaining every source, field and
 * entity-provenance row. Live-edited cards and invalid masters with valid children
 * are protected rather than guessed about.
 */
export async function archiveInvalidImportedPeopleInTransaction(
  client: PoolClient,
  input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly importRunId: string;
  },
): Promise<PersonNameHygieneCleanupResult> {
  const people = await client.query<{
    id: string;
    canonical_full_name: string;
    merged_into_person_id: string | null;
  }>(
    `SELECT id, canonical_full_name, merged_into_person_id
       FROM persons
      WHERE organization_id = $1 AND archived_at IS NULL
      FOR UPDATE`,
    [input.organizationId],
  );
  const invalidById = new Map<string, InvalidPersonNameReason>();
  const validIds = new Set<string>();
  for (const person of people.rows) {
    const assessment = assessPersonName(person.canonical_full_name);
    if (assessment.accepted) validIds.add(person.id);
    else invalidById.set(person.id, assessment.reason);
  }
  if (invalidById.size === 0) {
    return {
      policyVersion: PERSON_NAME_HYGIENE_POLICY_VERSION,
      archivedPersons: 0,
      archivedContacts: 0,
      archivedEventParticipations: 0,
      archivedExternalIdentities: 0,
      detachedProvenanceLinks: 0,
      rejectedExistingObservations: 0,
      dismissedDuplicateCandidates: 0,
      protectedPersons: 0,
    };
  }

  const candidateIds = [...invalidById.keys()];
  const observations = await client.query<{
    resolved_person_id: string;
    raw_values: unknown;
  }>(
    `SELECT resolved_person_id, raw_values
       FROM person_observations
      WHERE resolved_person_id = ANY($1::uuid[])`,
    [candidateIds],
  );
  const observationState = new Map<string, { count: number; hasValidName: boolean }>();
  for (const row of observations.rows) {
    const state = observationState.get(row.resolved_person_id) ?? {
      count: 0,
      hasValidName: false,
    };
    state.count += 1;
    if (assessPersonName(observationName(row.raw_values)).accepted) state.hasValidName = true;
    observationState.set(row.resolved_person_id, state);
  }

  const dependencies = await client.query<{ person_id: string }>(
    `SELECT DISTINCT person_id
       FROM (
         SELECT person_id FROM artifact_version_contributors WHERE person_id = ANY($1::uuid[])
         UNION ALL SELECT person_id FROM tasks
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL
         UNION ALL SELECT person_id FROM interactions
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL
         UNION ALL SELECT person_id FROM person_tags WHERE person_id = ANY($1::uuid[])
         UNION ALL SELECT person_id FROM consent_records WHERE person_id = ANY($1::uuid[])
         UNION ALL SELECT person_id FROM person_aliases
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LIVE'
         UNION ALL SELECT person_id FROM contact_points
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LIVE'
         UNION ALL SELECT person_id FROM affiliations
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LIVE'
         UNION ALL SELECT person_id FROM event_participations
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LIVE'
         UNION ALL SELECT person_id FROM team_memberships
           WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LIVE'
       ) protected`,
    [candidateIds],
  );
  const protectedIds = new Set(dependencies.rows.map((row) => row.person_id));
  for (const person of people.rows) {
    if (
      person.merged_into_person_id !== null &&
      invalidById.has(person.merged_into_person_id) &&
      validIds.has(person.id)
    ) {
      protectedIds.add(person.merged_into_person_id);
    }
  }
  for (const personId of candidateIds) {
    const state = observationState.get(personId);
    if (state === undefined || state.count === 0 || state.hasValidName) protectedIds.add(personId);
  }
  const archiveIds = candidateIds.filter((id) => !protectedIds.has(id));
  if (archiveIds.length === 0) {
    return {
      policyVersion: PERSON_NAME_HYGIENE_POLICY_VERSION,
      archivedPersons: 0,
      archivedContacts: 0,
      archivedEventParticipations: 0,
      archivedExternalIdentities: 0,
      detachedProvenanceLinks: 0,
      rejectedExistingObservations: 0,
      dismissedDuplicateCandidates: 0,
      protectedPersons: protectedIds.size,
    };
  }

  const contactIds = await client.query<{ id: string }>(
    `SELECT id FROM contact_points
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );
  const participationIds = await client.query<{ id: string }>(
    `SELECT id FROM event_participations
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );

  const archivedContacts = await client.query(
    `UPDATE contact_points SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );
  await client.query(
    `UPDATE person_aliases SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );
  await client.query(
    `UPDATE affiliations SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );
  await client.query(
    `UPDATE team_memberships SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );
  const archivedParticipations = await client.query(
    `UPDATE event_participations
        SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL AND data_origin = 'LEGACY_IMPORT'`,
    [archiveIds],
  );
  const archivedExternalIdentities = await client.query(
    `UPDATE external_identities
        SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE person_id = ANY($1::uuid[]) AND archived_at IS NULL`,
    [archiveIds],
  );

  const dismissedCandidates = await client.query<{ id: string }>(
    `UPDATE duplicate_candidates
        SET status = 'DISMISSED', decided_at = now(), decided_by_user_id = $2,
            decision_reason = $3, updated_at = now()
      WHERE status = 'OPEN'
        AND (person_a_id = ANY($1::uuid[]) OR person_b_id = ANY($1::uuid[]))
      RETURNING id`,
    [archiveIds, input.actorUserId, `${PERSON_NAME_HYGIENE_POLICY_VERSION}:INVALID_ENDPOINT`],
  );
  for (const candidate of dismissedCandidates.rows) {
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
       VALUES ($1, 'cpi-importer', $2, 'DUPLICATE_DISMISSED_BY_NAME_HYGIENE',
         'duplicate_candidate', $3, $4::jsonb, $5)`,
      [
        input.actorUserId,
        input.requestId,
        candidate.id,
        JSON.stringify({ status: 'DISMISSED', policyVersion: PERSON_NAME_HYGIENE_POLICY_VERSION }),
        `${PERSON_NAME_HYGIENE_POLICY_VERSION}:INVALID_ENDPOINT`,
      ],
    );
  }

  const rejectedObservations = await client.query(
    `UPDATE person_observations
        SET resolution_status = 'REJECTED', resolved_person_id = NULL,
            resolution_reason = $2, resolved_by_user_id = $3, resolved_at = now(), updated_at = now()
      WHERE resolved_person_id = ANY($1::uuid[])
        AND resolution_status <> 'REJECTED'`,
    [archiveIds, `${PERSON_NAME_HYGIENE_POLICY_VERSION}:INVALID_PERSON_NAME`, input.actorUserId],
  );
  await client.query<{ id: string }>(
    `UPDATE source_records source
        SET status = 'IGNORED', error_code = $1,
            error_reason = 'No accepted person observations remain', updated_at = now()
      WHERE source.id IN (
        SELECT observation.source_record_id
          FROM person_observations observation
         GROUP BY observation.source_record_id
        HAVING bool_and(observation.resolution_status = 'REJECTED')
      )
        AND source.status <> 'IGNORED'
      RETURNING source.id`,
    [`${PERSON_NAME_HYGIENE_POLICY_VERSION}:INVALID_PERSON_NAME`],
  );

  const provenanceEntityIds = [
    ...archiveIds,
    ...contactIds.rows.map((row) => row.id),
    ...participationIds.rows.map((row) => row.id),
  ];
  const detachedLinks = await client.query(
    `UPDATE source_entity_links
        SET detached_at = now(), detached_by_run_id = $2, updated_at = now()
      WHERE detached_at IS NULL AND entity_id = ANY($1::uuid[])`,
    [provenanceEntityIds, input.importRunId],
  );
  const archivedPeople = await client.query<{ id: string }>(
    `UPDATE persons
        SET archived_at = now(), updated_at = now(), version = version + 1
      WHERE id = ANY($1::uuid[]) AND archived_at IS NULL
      RETURNING id`,
    [archiveIds],
  );
  for (const person of archivedPeople.rows) {
    const reason = invalidById.get(person.id) ?? 'SERVICE_PLACEHOLDER';
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
       VALUES ($1, 'cpi-importer', $2, 'PERSON_ARCHIVED_BY_NAME_HYGIENE',
         'person', $3, $4::jsonb, $5)`,
      [
        input.actorUserId,
        input.requestId,
        person.id,
        JSON.stringify({
          archived: true,
          policyVersion: PERSON_NAME_HYGIENE_POLICY_VERSION,
          invalidNameReason: reason,
        }),
        `${PERSON_NAME_HYGIENE_POLICY_VERSION}:${reason}`,
      ],
    );
  }

  return {
    policyVersion: PERSON_NAME_HYGIENE_POLICY_VERSION,
    archivedPersons: archivedPeople.rowCount ?? 0,
    archivedContacts: archivedContacts.rowCount ?? 0,
    archivedEventParticipations: archivedParticipations.rowCount ?? 0,
    archivedExternalIdentities: archivedExternalIdentities.rowCount ?? 0,
    detachedProvenanceLinks: detachedLinks.rowCount ?? 0,
    rejectedExistingObservations: rejectedObservations.rowCount ?? 0,
    dismissedDuplicateCandidates: dismissedCandidates.rowCount ?? 0,
    protectedPersons: protectedIds.size,
  };
}
