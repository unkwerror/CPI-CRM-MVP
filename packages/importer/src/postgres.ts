import { randomUUID } from 'node:crypto';

import { autoResolveDuplicateCandidatesInTransaction } from '@cpi-crm/db';
import { collapseWhitespace, normalizeFullName } from '@cpi-crm/domain';
import { Pool, type PoolClient } from 'pg';

import { extractPersonAttributes, type AttributeSourceRow } from './attributes.js';
import { DEFAULT_TIMEZONE, IMPORTER_VERSION, PARSER_VERSION, RULES_VERSION } from './constants.js';
import { fingerprint } from './hash.js';
import {
  archiveInvalidImportedPeopleInTransaction,
  assessPersonObservation,
  PERSON_NAME_HYGIENE_POLICY_VERSION,
  summarizePersonNameHygiene,
} from './hygiene.js';
import { persistLegacyArtifacts, recalculateLegacyArtifactAuthors } from './legacy-artifacts.js';
import type {
  CommitOptions,
  CommitResult,
  ContactObservation,
  PersonObservation,
  WorkbookImportPlan,
} from './types.js';
import { sourceRowAsRawJson } from './workbook.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JSON_CHUNK_SIZE = 750;

interface Assignment {
  readonly observation: PersonObservation;
  readonly observationId: string;
  readonly sourceRecordId: string;
  readonly personId: string;
  readonly personWasCreated: boolean;
}

interface EventAssignment {
  readonly observation: PersonObservation;
  readonly sourceRecordId: string;
  readonly personId: string;
}

interface ContactEntity {
  readonly id: string;
  readonly personId: string;
  readonly type: ContactObservation['type'];
  readonly raw: string;
  readonly normalized: string;
  readonly created: boolean;
}

interface ExistingObservationRow {
  readonly sheet_name: string;
  readonly row_number: number;
  readonly slot_key: string;
  readonly resolved_person_id: string | null;
  readonly resolution_status: 'PENDING' | 'RESOLVED' | 'REVIEW_REQUIRED' | 'REJECTED';
}

function assertUuid(label: string, value: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID`);
}

function sourceKey(sheetName: string, rowNumber: number): string {
  return `${sheetName}\u0000${rowNumber}`;
}

function observationKey(sheetName: string, rowNumber: number, slotKey: string): string {
  return `${sourceKey(sheetName, rowNumber)}\u0000${slotKey}`;
}

function externalKey(namespace: string, externalId: string): string {
  return `${namespace}\u0000${externalId}`;
}

function contactKey(personId: string, type: string, normalized: string): string {
  return `${personId}\u0000${type}\u0000${normalized}`;
}

function eventParticipationKey(personId: string, eventId: string): string {
  return `${personId}\u0000${eventId}`;
}

async function insertJsonRows(
  client: PoolClient,
  sql: string,
  rows: readonly Record<string, unknown>[],
): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += JSON_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + JSON_CHUNK_SIZE);
    const result = await client.query(sql, [JSON.stringify(chunk)]);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function assertCommitPrincipals(client: PoolClient, options: CommitOptions): Promise<void> {
  const result = await client.query<{
    organization_exists: boolean;
    user_exists: boolean;
  }>(
    `select
       exists(select 1 from organizations where id = $1 and archived_at is null) as organization_exists,
       exists(select 1 from app_users where id = $2 and archived_at is null) as user_exists`,
    [options.organizationId, options.initiatedByUserId],
  );
  const row = result.rows[0];
  if (row?.organization_exists !== true) throw new Error('Import organization does not exist');
  if (row.user_exists !== true) throw new Error('Import user does not exist');
}

async function ensureSourceFileObject(
  client: PoolClient,
  plan: WorkbookImportPlan,
  options: CommitOptions,
): Promise<string> {
  if (options.sourceFileObjectId !== undefined) {
    assertUuid('sourceFileObjectId', options.sourceFileObjectId);
    const existing = await client.query<{ id: string }>(
      'select id from file_objects where id = $1',
      [options.sourceFileObjectId],
    );
    if (existing.rows[0] === undefined) throw new Error('Source file object does not exist');
    return options.sourceFileObjectId;
  }

  const id = randomUUID();
  const objectKey = `xlsx/${options.organizationId}/${plan.sha256}`;
  await client.query(
    `insert into file_objects
       (id, bucket, object_key, original_filename, declared_mime_type, detected_mime_type,
        size_bytes, sha256, status, scan_result, uploaded_by_user_id, available_at)
     values ($1, 'local-import', $2, $3,
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       $4, $5, 'AVAILABLE', $6::jsonb, $7, now())
     on conflict (bucket, object_key) do nothing`,
    [
      id,
      objectKey,
      plan.sourceFilename,
      plan.sizeBytes,
      plan.sha256,
      JSON.stringify({
        source: 'LOCAL_IMPORT_CLI',
        localPath: plan.absolutePath,
        sha256Verified: true,
      }),
      options.initiatedByUserId,
    ],
  );
  const selected = await client.query<{ id: string; sha256: string | null }>(
    'select id, sha256 from file_objects where bucket = $1 and object_key = $2',
    ['local-import', objectKey],
  );
  const row = selected.rows[0];
  if (row === undefined || row.sha256 !== plan.sha256) {
    throw new Error('Could not establish immutable source file metadata');
  }
  return row.id;
}

async function createOrReuseBatch(
  client: PoolClient,
  plan: WorkbookImportPlan,
  options: CommitOptions,
  sourceFileObjectId: string,
): Promise<{ readonly id: string; readonly reused: boolean }> {
  const id = randomUUID();
  const result = await client.query<{ id: string }>(
    `insert into import_batches
       (id, organization_id, source_file_object_id, original_filename, size_bytes, sha256,
        importer_version, timezone_snapshot, uploaded_by_user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (organization_id, sha256) do nothing
     returning id`,
    [
      id,
      options.organizationId,
      sourceFileObjectId,
      plan.sourceFilename,
      plan.sizeBytes,
      plan.sha256,
      IMPORTER_VERSION,
      options.timezone ?? DEFAULT_TIMEZONE,
      options.initiatedByUserId,
    ],
  );
  if (result.rows[0] !== undefined) return { id: result.rows[0].id, reused: false };

  const selected = await client.query<{ id: string }>(
    'select id from import_batches where organization_id = $1 and sha256 = $2',
    [options.organizationId, plan.sha256],
  );
  const existing = selected.rows[0];
  if (existing === undefined) throw new Error('Could not create or select import batch');
  return { id: existing.id, reused: true };
}

async function createRun(
  client: PoolClient,
  batchId: string,
  userId: string,
  explicitBasedOnRunId?: string,
): Promise<string> {
  const previous = await client.query<{ id: string }>(
    `select id from import_runs
     where batch_id = $1 and mode = 'COMMIT' and status = 'SUCCEEDED'
     order by created_at desc limit 1`,
    [batchId],
  );
  const id = randomUUID();
  await client.query(
    `insert into import_runs
       (id, batch_id, mode, parser_version, rules_version, status, based_on_run_id,
        statistics, errors, started_at, initiated_by_user_id)
     values ($1, $2, 'COMMIT', $3, $4, 'RUNNING', $5, '{}'::jsonb, '[]'::jsonb, now(), $6)`,
    [
      id,
      batchId,
      PARSER_VERSION,
      RULES_VERSION,
      explicitBasedOnRunId ?? previous.rows[0]?.id ?? null,
      userId,
    ],
  );
  return id;
}

async function persistSourceRecords(
  client: PoolClient,
  plan: WorkbookImportPlan,
  batchId: string,
): Promise<{
  readonly created: number;
  readonly ids: ReadonlyMap<string, string>;
}> {
  const rows = plan.sourceRows.map((row) => ({
    id: randomUUID(),
    batch_id: batchId,
    source_filename: row.sourceFilename,
    sheet_name: row.sheetName,
    row_number: row.rowNumber,
    raw_json: sourceRowAsRawJson(row),
    row_hash: row.rowHash,
  }));
  const created = await insertJsonRows(
    client,
    `insert into source_records
       (id, batch_id, source_filename, sheet_name, row_number, raw_json, row_hash, status)
     select x.id, x.batch_id, x.source_filename, x.sheet_name, x.row_number,
       x.raw_json, x.row_hash, 'PARSED'
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, batch_id uuid, source_filename text, sheet_name text,
       row_number integer, raw_json jsonb, row_hash text)
     on conflict (batch_id, sheet_name, row_number) do nothing`,
    rows,
  );

  const selected = await client.query<{
    id: string;
    sheet_name: string;
    row_number: number;
    row_hash: string;
  }>('select id, sheet_name, row_number, row_hash from source_records where batch_id = $1', [
    batchId,
  ]);
  const ids = new Map<string, string>();
  const hashes = new Map(
    plan.sourceRows.map((row) => [sourceKey(row.sheetName, row.rowNumber), row.rowHash]),
  );
  for (const row of selected.rows) {
    const key = sourceKey(row.sheet_name, row.row_number);
    if (hashes.get(key) !== row.row_hash) {
      throw new Error(
        `Immutable SourceRecord hash mismatch at ${row.sheet_name}:${row.row_number}`,
      );
    }
    ids.set(key, row.id);
  }
  if (ids.size !== plan.sourceRows.length) {
    throw new Error(`Expected ${plan.sourceRows.length} SourceRecords, selected ${ids.size}`);
  }
  return { created, ids };
}

async function existingObservations(
  client: PoolClient,
  batchId: string,
): Promise<ReadonlyMap<string, ExistingObservationRow>> {
  const result = await client.query<ExistingObservationRow>(
    `select sr.sheet_name, sr.row_number, po.slot_key, po.resolved_person_id,
       po.resolution_status
     from person_observations po
     join source_records sr on sr.id = po.source_record_id
     where sr.batch_id = $1 and po.parser_version = $2`,
    [batchId, PARSER_VERSION],
  );
  return new Map(
    result.rows.map((row) => [observationKey(row.sheet_name, row.row_number, row.slot_key), row]),
  );
}

async function loadExternalIdentities(
  client: PoolClient,
  organizationId: string,
  observations: readonly PersonObservation[],
): Promise<Map<string, string>> {
  const namespaces = [...new Set(observations.flatMap((entry) => entry.sourceNamespace ?? []))];
  if (namespaces.length === 0) return new Map();
  const result = await client.query<{
    source_namespace: string;
    external_id: string;
    person_id: string;
  }>(
    `select source_namespace, external_id, person_id
     from external_identities
     where organization_id = $1 and source_namespace = any($2::text[])
       and archived_at is null`,
    [organizationId, namespaces],
  );
  return new Map(
    result.rows.map((row) => [externalKey(row.source_namespace, row.external_id), row.person_id]),
  );
}

async function persistPeopleAndObservations(
  client: PoolClient,
  plan: WorkbookImportPlan,
  options: CommitOptions,
  batchId: string,
  runId: string,
  sourceIds: ReadonlyMap<string, string>,
): Promise<{
  readonly assignments: readonly Assignment[];
  readonly createdPersons: ReadonlySet<string>;
  readonly createdObservations: number;
}> {
  const existing = await existingObservations(client, batchId);
  const unresolvedExisting = [...existing.values()].find(
    (observation) =>
      observation.resolved_person_id === null && observation.resolution_status !== 'REJECTED',
  );
  if (unresolvedExisting !== undefined) {
    throw new Error(
      `Existing observation is unresolved at ${unresolvedExisting.sheet_name}:${unresolvedExisting.row_number}; manual review is required`,
    );
  }
  const pending = plan.observations.filter(
    (observation) =>
      !existing.has(
        observationKey(observation.sheetName, observation.rowNumber, observation.slotKey),
      ),
  );
  if (pending.length === 0) {
    return { assignments: [], createdPersons: new Set(), createdObservations: 0 };
  }
  const acceptedPending = pending.filter(
    (observation) => assessPersonObservation(observation).accepted,
  );

  // Serializes stable-ID creation with other importer commits. It does not use
  // names or contacts for resolution and therefore cannot auto-merge people.
  await client.query('lock table external_identities in share row exclusive mode');
  const externalIdentities = await loadExternalIdentities(
    client,
    options.organizationId,
    acceptedPending,
  );
  const newExternalIdentities = new Map<
    string,
    {
      readonly namespace: string;
      readonly externalId: string;
      readonly personId: string;
      readonly sourceRecordId: string;
    }
  >();
  const personRows: Record<string, unknown>[] = [];
  const createdPersons = new Set<string>();
  const existingExternalPersonIds = new Set(externalIdentities.values());
  const assignments: Assignment[] = [];

  for (const observation of acceptedPending) {
    const sourceRecordId = sourceIds.get(sourceKey(observation.sheetName, observation.rowNumber));
    if (sourceRecordId === undefined) throw new Error('Observation source record is missing');

    let personId: string | undefined;
    if (observation.sourceNamespace !== null && observation.externalId !== null) {
      const key = externalKey(observation.sourceNamespace, observation.externalId);
      personId = externalIdentities.get(key) ?? newExternalIdentities.get(key)?.personId;
      if (personId === undefined) {
        personId = randomUUID();
        newExternalIdentities.set(key, {
          namespace: observation.sourceNamespace,
          externalId: observation.externalId,
          personId,
          sourceRecordId,
        });
      }
    }
    if (personId === undefined) personId = randomUUID();

    if (!createdPersons.has(personId) && !existingExternalPersonIds.has(personId)) {
      createdPersons.add(personId);
      personRows.push({
        id: personId,
        organization_id: options.organizationId,
        canonical_full_name: observation.canonicalFullName,
        normalized_full_name: observation.normalizedFullName,
      });
    }
    assignments.push({
      observation,
      observationId: randomUUID(),
      sourceRecordId,
      personId,
      personWasCreated: createdPersons.has(personId),
    });
  }

  await insertJsonRows(
    client,
    `insert into persons
       (id, organization_id, canonical_full_name, normalized_full_name,
        lifecycle_data_state, activation_state, activity_status)
     select x.id, x.organization_id, x.canonical_full_name, x.normalized_full_name,
       'LEGACY_INCOMPLETE', 'UNKNOWN_LEGACY', 'UNKNOWN'
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, organization_id uuid, canonical_full_name text, normalized_full_name text)`,
    personRows,
  );

  await insertJsonRows(
    client,
    `insert into external_identities
       (id, organization_id, source_namespace, external_id, person_id, first_seen_source_record_id)
     select x.id, x.organization_id, x.source_namespace, x.external_id,
       x.person_id, x.first_seen_source_record_id
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, organization_id uuid, source_namespace text, external_id text,
       person_id uuid, first_seen_source_record_id uuid)
     on conflict do nothing`,
    [...newExternalIdentities.values()].map((entry) => ({
      id: randomUUID(),
      organization_id: options.organizationId,
      source_namespace: entry.namespace,
      external_id: entry.externalId,
      person_id: entry.personId,
      first_seen_source_record_id: entry.sourceRecordId,
    })),
  );

  const resolvedObservationRows = assignments.map((assignment) => ({
    id: assignment.observationId,
    source_record_id: assignment.sourceRecordId,
    import_run_id: runId,
    slot_key: assignment.observation.slotKey,
    parser_version: PARSER_VERSION,
    source_namespace: assignment.observation.sourceNamespace,
    external_id: assignment.observation.externalId,
    observation_fingerprint: assignment.observation.observationFingerprint,
    raw_values: assignment.observation.rawValues,
    normalized_values: assignment.observation.normalizedValues,
    resolution_status: 'RESOLVED',
    resolved_person_id: assignment.personId,
    resolution_reason:
      assignment.observation.externalId === null
        ? 'NEW_LEGACY_PERSON_NO_AUTOMERGE'
        : createdPersons.has(assignment.personId)
          ? 'NEW_PERSON_FROM_STABLE_EXTERNAL_ID'
          : 'EXACT_STABLE_EXTERNAL_ID',
  }));
  const rejectedObservationRows = pending.flatMap((observation) => {
    const assessment = assessPersonObservation(observation);
    if (assessment.accepted) return [];
    const sourceRecordId = sourceIds.get(sourceKey(observation.sheetName, observation.rowNumber));
    if (sourceRecordId === undefined)
      throw new Error('Rejected observation source record is missing');
    return [
      {
        id: randomUUID(),
        source_record_id: sourceRecordId,
        import_run_id: runId,
        slot_key: observation.slotKey,
        parser_version: PARSER_VERSION,
        source_namespace: observation.sourceNamespace,
        external_id: observation.externalId,
        observation_fingerprint: observation.observationFingerprint,
        raw_values: observation.rawValues,
        normalized_values: observation.normalizedValues,
        resolution_status: 'REJECTED',
        resolved_person_id: null,
        resolution_reason: `${PERSON_NAME_HYGIENE_POLICY_VERSION}:${assessment.reason}`,
      },
    ];
  });
  const observationRows = [...resolvedObservationRows, ...rejectedObservationRows];
  const createdObservations = await insertJsonRows(
    client,
    `insert into person_observations
       (id, source_record_id, import_run_id, slot_key, parser_version,
        source_namespace, external_id, observation_fingerprint, raw_values,
        normalized_values, resolution_status, resolved_person_id,
        resolution_reason, resolved_at)
     select x.id, x.source_record_id, x.import_run_id, x.slot_key,
       x.parser_version, x.source_namespace, x.external_id,
       x.observation_fingerprint, x.raw_values, x.normalized_values,
       x.resolution_status::observation_resolution_status, x.resolved_person_id,
       x.resolution_reason, now()
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, source_record_id uuid, import_run_id uuid, slot_key text,
       parser_version text, source_namespace text, external_id text,
       observation_fingerprint text, raw_values jsonb, normalized_values jsonb,
       resolution_status text, resolved_person_id uuid, resolution_reason text)
     on conflict (source_record_id, slot_key, parser_version) do nothing`,
    observationRows,
  );
  if (createdObservations !== pending.length) {
    throw new Error('Concurrent observation insertion detected; retry the commit');
  }
  return { assignments, createdPersons, createdObservations };
}

async function markIgnoredNameSourceRecords(
  client: PoolClient,
  plan: WorkbookImportPlan,
  sourceIds: ReadonlyMap<string, string>,
): Promise<void> {
  const rows = new Map<string, { accepted: number; rejected: number }>();
  for (const observation of plan.observations) {
    const key = sourceKey(observation.sheetName, observation.rowNumber);
    const state = rows.get(key) ?? { accepted: 0, rejected: 0 };
    if (assessPersonObservation(observation).accepted) state.accepted += 1;
    else state.rejected += 1;
    rows.set(key, state);
  }
  const ignoredIds = [...rows.entries()].flatMap(([key, state]) => {
    if (state.accepted > 0 || state.rejected === 0) return [];
    const id = sourceIds.get(key);
    if (id === undefined) throw new Error('Ignored source record is missing');
    return [id];
  });
  if (ignoredIds.length === 0) return;
  await client.query(
    `UPDATE source_records
        SET status = 'IGNORED', error_code = $2,
            error_reason = 'All person observations failed deterministic name hygiene',
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ignoredIds, `${PERSON_NAME_HYGIENE_POLICY_VERSION}:INVALID_PERSON_NAME`],
  );
}

async function loadResolvedEventAssignments(
  client: PoolClient,
  plan: WorkbookImportPlan,
  batchId: string,
  sourceIds: ReadonlyMap<string, string>,
): Promise<readonly EventAssignment[]> {
  const resolved = await client.query<{
    sheet_name: string;
    row_number: number;
    slot_key: string;
    resolved_person_id: string;
  }>(
    `select sr.sheet_name, sr.row_number, po.slot_key, po.resolved_person_id
       from person_observations po
       join source_records sr on sr.id = po.source_record_id
      where sr.batch_id = $1 and po.parser_version = $2
        and po.resolution_status = 'RESOLVED'
        and po.resolved_person_id is not null`,
    [batchId, PARSER_VERSION],
  );
  const personByObservation = new Map(
    resolved.rows.map((row) => [
      observationKey(row.sheet_name, row.row_number, row.slot_key),
      row.resolved_person_id,
    ]),
  );
  const assignments: EventAssignment[] = [];
  for (const observation of plan.observations) {
    if (!assessPersonObservation(observation).accepted) continue;
    if (collapseWhitespace(observation.eventName).length === 0) continue;
    const key = observationKey(observation.sheetName, observation.rowNumber, observation.slotKey);
    const personId = personByObservation.get(key);
    if (personId === undefined) {
      throw new Error(
        `Event observation is unresolved at ${observation.sheetName}:${observation.rowNumber}:${observation.slotKey}`,
      );
    }
    const sourceRecordId = sourceIds.get(sourceKey(observation.sheetName, observation.rowNumber));
    if (sourceRecordId === undefined) throw new Error('Event source record is missing');
    assignments.push({ observation, sourceRecordId, personId });
  }
  return assignments;
}

async function persistEventsAndParticipations(
  client: PoolClient,
  assignments: readonly EventAssignment[],
  organizationId: string,
  runId: string,
): Promise<{
  readonly events: number;
  readonly participations: number;
  readonly links: number;
  readonly eventIds: ReadonlyMap<string, string>;
}> {
  if (assignments.length === 0) {
    return { events: 0, participations: 0, links: 0, eventIds: new Map() };
  }

  const eventNames = new Map<string, string>();
  for (const assignment of assignments) {
    const name = collapseWhitespace(assignment.observation.eventName);
    const normalizedName = normalizeFullName(name);
    if (normalizedName.length > 0 && !eventNames.has(normalizedName)) {
      eventNames.set(normalizedName, name);
    }
  }
  const normalizedNames = [...eventNames.keys()];
  const existingEvents = await client.query<{
    id: string;
    normalized_name: string;
  }>(
    `select id, normalized_name
       from events
      where organization_id = $1 and normalized_name = any($2::text[])
        and archived_at is null
      order by created_at, id`,
    [organizationId, normalizedNames],
  );
  const eventIds = new Map<string, string>();
  for (const event of existingEvents.rows) {
    if (!eventIds.has(event.normalized_name)) eventIds.set(event.normalized_name, event.id);
  }

  const eventRows: Record<string, unknown>[] = [];
  const createdEventIds = new Set<string>();
  for (const [normalizedName, name] of eventNames) {
    if (eventIds.has(normalizedName)) continue;
    const id = randomUUID();
    eventIds.set(normalizedName, id);
    createdEventIds.add(id);
    eventRows.push({
      id,
      organization_id: organizationId,
      name,
      normalized_name: normalizedName,
    });
  }
  const eventsCreated = await insertJsonRows(
    client,
    `insert into events (id, organization_id, name, normalized_name, status)
     select x.id, x.organization_id, x.name, x.normalized_name, 'UNKNOWN'
       from jsonb_to_recordset($1::jsonb) as x(
         id uuid, organization_id uuid, name text, normalized_name text)`,
    eventRows,
  );
  if (eventsCreated !== eventRows.length) throw new Error('Could not create every imported event');

  const requiredPairs = new Map<string, { readonly personId: string; readonly eventId: string }>();
  for (const assignment of assignments) {
    const eventId = eventIds.get(normalizeFullName(assignment.observation.eventName));
    if (eventId === undefined) throw new Error('Imported event resolution was lost');
    const key = eventParticipationKey(assignment.personId, eventId);
    requiredPairs.set(key, { personId: assignment.personId, eventId });
  }
  const personIds = [...new Set([...requiredPairs.values()].map((item) => item.personId))];
  const resolvedEventIds = [...new Set([...requiredPairs.values()].map((item) => item.eventId))];
  const existingParticipations = await client.query<{
    id: string;
    person_id: string;
    event_id: string;
  }>(
    `select id, person_id, event_id
       from event_participations
      where person_id = any($1::uuid[]) and event_id = any($2::uuid[])
        and archived_at is null`,
    [personIds, resolvedEventIds],
  );
  const participations = new Map(
    existingParticipations.rows.map((row) => [
      eventParticipationKey(row.person_id, row.event_id),
      row.id,
    ]),
  );
  const participationRows: Record<string, unknown>[] = [];
  const proposedParticipationIds = new Set<string>();
  for (const [key, pair] of requiredPairs) {
    if (participations.has(key)) continue;
    const id = randomUUID();
    proposedParticipationIds.add(id);
    participationRows.push({ id, person_id: pair.personId, event_id: pair.eventId });
  }
  const participationsInserted = await insertJsonRows(
    client,
    `insert into event_participations
       (id, person_id, event_id, decision, attendance, data_origin)
     select x.id, x.person_id, x.event_id, 'UNKNOWN', 'UNKNOWN', 'LEGACY_IMPORT'
       from jsonb_to_recordset($1::jsonb) as x(id uuid, person_id uuid, event_id uuid)
     on conflict do nothing`,
    participationRows,
  );

  const selectedParticipations = await client.query<{
    id: string;
    person_id: string;
    event_id: string;
  }>(
    `select id, person_id, event_id
       from event_participations
      where person_id = any($1::uuid[]) and event_id = any($2::uuid[])
        and archived_at is null`,
    [personIds, resolvedEventIds],
  );
  participations.clear();
  for (const row of selectedParticipations.rows) {
    participations.set(eventParticipationKey(row.person_id, row.event_id), row.id);
  }
  if (participations.size !== requiredPairs.size) {
    throw new Error('Could not resolve every imported event participation');
  }
  const createdParticipationIds = new Set(
    selectedParticipations.rows
      .map((row) => row.id)
      .filter((id) => proposedParticipationIds.has(id)),
  );
  if (createdParticipationIds.size !== participationsInserted) {
    throw new Error('Concurrent event participation insertion could not be reconciled');
  }

  const linkRows = new Map<string, Record<string, unknown>>();
  for (const assignment of assignments) {
    const normalizedEventName = normalizeFullName(assignment.observation.eventName);
    const eventId = eventIds.get(normalizedEventName);
    if (eventId === undefined) throw new Error('Imported event link resolution was lost');
    const participationId = participations.get(eventParticipationKey(assignment.personId, eventId));
    if (participationId === undefined) {
      throw new Error('Imported event participation link resolution was lost');
    }
    linkRows.set(`${assignment.sourceRecordId}\u0000EVENT\u0000${eventId}`, {
      id: randomUUID(),
      source_record_id: assignment.sourceRecordId,
      import_run_id: runId,
      entity_type: 'EVENT',
      entity_id: eventId,
      relation: 'OBSERVED_EVENT',
      fact_fingerprint: fingerprint({ organizationId, normalizedEventName }),
      created_entity: createdEventIds.has(eventId),
    });
    linkRows.set(`${assignment.sourceRecordId}\u0000EVENT_PARTICIPATION\u0000${participationId}`, {
      id: randomUUID(),
      source_record_id: assignment.sourceRecordId,
      import_run_id: runId,
      entity_type: 'EVENT_PARTICIPATION',
      entity_id: participationId,
      relation: 'OBSERVED_PARTICIPATION',
      fact_fingerprint: fingerprint({ personId: assignment.personId, eventId }),
      created_entity: createdParticipationIds.has(participationId),
    });
  }
  const links = await insertJsonRows(
    client,
    `insert into source_entity_links
       (id, source_record_id, import_run_id, entity_type, entity_id, relation,
        fact_fingerprint, created_entity)
     select x.id, x.source_record_id, x.import_run_id, x.entity_type,
       x.entity_id, x.relation, x.fact_fingerprint, x.created_entity
       from jsonb_to_recordset($1::jsonb) as x(
         id uuid, source_record_id uuid, import_run_id uuid, entity_type text,
         entity_id uuid, relation text, fact_fingerprint text, created_entity boolean)
     on conflict (source_record_id, entity_type, relation, entity_id) do nothing`,
    [...linkRows.values()],
  );
  return {
    events: eventsCreated,
    participations: participationsInserted,
    links,
    eventIds,
  };
}

async function persistContacts(
  client: PoolClient,
  assignments: readonly Assignment[],
): Promise<{
  readonly created: number;
  readonly entities: ReadonlyMap<string, ContactEntity>;
  readonly observationContacts: ReadonlyMap<string, readonly ContactEntity[]>;
  readonly createdContactIds: ReadonlySet<string>;
}> {
  const personIds = [...new Set(assignments.map((assignment) => assignment.personId))];
  const existing =
    personIds.length === 0
      ? {
          rows: [] as Array<{
            id: string;
            person_id: string;
            type: ContactObservation['type'];
            raw_value: string;
            normalized_value: string;
          }>,
        }
      : await client.query<{
          id: string;
          person_id: string;
          type: ContactObservation['type'];
          raw_value: string;
          normalized_value: string;
        }>(
          `select id, person_id, type, raw_value, normalized_value
           from contact_points
           where person_id = any($1::uuid[]) and archived_at is null`,
          [personIds],
        );
  const entities = new Map<string, ContactEntity>();
  for (const row of existing.rows) {
    entities.set(contactKey(row.person_id, row.type, row.normalized_value), {
      id: row.id,
      personId: row.person_id,
      type: row.type,
      raw: row.raw_value,
      normalized: row.normalized_value,
      created: false,
    });
  }

  const rows: Record<string, unknown>[] = [];
  const createdContactIds = new Set<string>();
  const observationContacts = new Map<string, readonly ContactEntity[]>();
  for (const assignment of assignments) {
    const values: ContactEntity[] = [];
    for (const observed of assignment.observation.contacts) {
      const key = contactKey(assignment.personId, observed.type, observed.normalized);
      let entity = entities.get(key);
      if (entity === undefined) {
        entity = {
          id: randomUUID(),
          personId: assignment.personId,
          type: observed.type,
          raw: observed.raw,
          normalized: observed.normalized,
          created: true,
        };
        entities.set(key, entity);
        createdContactIds.add(entity.id);
        rows.push({
          id: entity.id,
          person_id: entity.personId,
          type: entity.type,
          raw_value: entity.raw,
          normalized_value: entity.normalized,
        });
      }
      values.push(entity);
    }
    observationContacts.set(assignment.observationId, values);
  }
  const created = await insertJsonRows(
    client,
    `insert into contact_points
       (id, person_id, type, raw_value, normalized_value, is_primary, is_verified, data_origin)
     select x.id, x.person_id, x.type::contact_point_type, x.raw_value,
       x.normalized_value, false, false, 'LEGACY_IMPORT'
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, person_id uuid, type text, raw_value text, normalized_value text)`,
    rows,
  );
  return { created, entities, observationContacts, createdContactIds };
}

async function persistProvenance(
  client: PoolClient,
  runId: string,
  assignments: readonly Assignment[],
  createdPersons: ReadonlySet<string>,
  observationContacts: ReadonlyMap<string, readonly ContactEntity[]>,
  createdContactIds: ReadonlySet<string>,
): Promise<{ readonly links: number; readonly fields: number }> {
  const linkMap = new Map<string, Record<string, unknown>>();
  const fieldRows: Record<string, unknown>[] = [];
  const canonicalPersonRecorded = new Set<string>();
  const canonicalContactRecorded = new Set<string>();
  const fieldDedupe = new Set<string>();

  for (const assignment of assignments) {
    const personLinkKey = `${assignment.sourceRecordId}\u0000PERSON\u0000${assignment.personId}`;
    linkMap.set(personLinkKey, {
      id: randomUUID(),
      source_record_id: assignment.sourceRecordId,
      import_run_id: runId,
      entity_type: 'PERSON',
      entity_id: assignment.personId,
      relation: 'OBSERVED_PERSON',
      fact_fingerprint: assignment.observation.observationFingerprint,
      created_entity: createdPersons.has(assignment.personId),
    });

    const personFieldKey = `${assignment.sourceRecordId}\u0000PERSON\u0000${assignment.personId}\u0000canonicalFullName`;
    if (!fieldDedupe.has(personFieldKey)) {
      fieldDedupe.add(personFieldKey);
      const isCanonical =
        createdPersons.has(assignment.personId) &&
        !canonicalPersonRecorded.has(assignment.personId);
      if (isCanonical) canonicalPersonRecorded.add(assignment.personId);
      fieldRows.push({
        id: randomUUID(),
        entity_type: 'PERSON',
        entity_id: assignment.personId,
        field_name: 'canonicalFullName',
        raw_value: assignment.observation.rawValues.fullName ?? null,
        normalized_value: assignment.observation.normalizedFullName,
        source_record_id: assignment.sourceRecordId,
        is_canonical: isCanonical,
      });
    }

    for (const entity of observationContacts.get(assignment.observationId) ?? []) {
      const contactLinkKey = `${assignment.sourceRecordId}\u0000CONTACT_POINT\u0000${entity.id}`;
      linkMap.set(contactLinkKey, {
        id: randomUUID(),
        source_record_id: assignment.sourceRecordId,
        import_run_id: runId,
        entity_type: 'CONTACT_POINT',
        entity_id: entity.id,
        relation: 'OBSERVED_CONTACT',
        fact_fingerprint: fingerprint({
          observation: assignment.observation.observationFingerprint,
          type: entity.type,
          normalized: entity.normalized,
        }),
        created_entity: createdContactIds.has(entity.id),
      });

      const contactFieldKey = `${assignment.sourceRecordId}\u0000CONTACT_POINT\u0000${entity.id}\u0000value`;
      if (fieldDedupe.has(contactFieldKey)) continue;
      fieldDedupe.add(contactFieldKey);
      const isCanonical =
        createdContactIds.has(entity.id) && !canonicalContactRecorded.has(entity.id);
      if (isCanonical) canonicalContactRecorded.add(entity.id);
      const rawContact = assignment.observation.contacts.find(
        (entry) => entry.type === entity.type && entry.normalized === entity.normalized,
      );
      fieldRows.push({
        id: randomUUID(),
        entity_type: 'CONTACT_POINT',
        entity_id: entity.id,
        field_name: 'value',
        raw_value: rawContact?.raw ?? entity.raw,
        normalized_value: entity.normalized,
        source_record_id: assignment.sourceRecordId,
        is_canonical: isCanonical,
      });
    }
  }

  const links = await insertJsonRows(
    client,
    `insert into source_entity_links
       (id, source_record_id, import_run_id, entity_type, entity_id, relation,
        fact_fingerprint, created_entity)
     select x.id, x.source_record_id, x.import_run_id, x.entity_type,
       x.entity_id, x.relation, x.fact_fingerprint, x.created_entity
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, source_record_id uuid, import_run_id uuid, entity_type text,
       entity_id uuid, relation text, fact_fingerprint text, created_entity boolean)
     on conflict (source_record_id, entity_type, relation, entity_id) do nothing`,
    [...linkMap.values()],
  );
  const fields = await insertJsonRows(
    client,
    `insert into field_observations
       (id, entity_type, entity_id, field_name, raw_value, normalized_value,
        source_record_id, is_canonical)
     select x.id, x.entity_type, x.entity_id, x.field_name, x.raw_value,
       x.normalized_value, x.source_record_id, x.is_canonical
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, entity_type text, entity_id uuid, field_name text,
       raw_value jsonb, normalized_value jsonb, source_record_id uuid,
       is_canonical boolean)`,
    fieldRows,
  );
  return { links, fields };
}

const INSERT_PERSON_ATTRIBUTES_SQL = `insert into field_observations
   (id, entity_type, entity_id, field_name, raw_value, normalized_value,
    source_record_id, is_canonical)
 select x.id, 'PERSON', x.entity_id, x.field_name, x.raw_value,
   x.normalized_value, x.source_record_id, false
 from jsonb_to_recordset($1::jsonb) as x(
   id uuid, entity_id uuid, field_name text, raw_value jsonb,
   normalized_value jsonb, source_record_id uuid)
 where not exists (
   select 1 from field_observations f
    where f.entity_type = 'PERSON'
      and f.entity_id = x.entity_id
      and f.field_name = x.field_name
      and f.source_record_id is not distinct from x.source_record_id
      and f.raw_value = x.raw_value)`;

function personAttributeRows(
  personId: string,
  sourceRecordId: string,
  row: AttributeSourceRow,
  slotKey: string,
  dedupe: Set<string>,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const attribute of extractPersonAttributes(row, slotKey)) {
    const key = [personId, sourceRecordId, attribute.field, attribute.label, attribute.value].join(
      '\u0000',
    );
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    rows.push({
      id: randomUUID(),
      entity_id: personId,
      field_name: attribute.field,
      raw_value: { label: attribute.label, value: attribute.value },
      normalized_value: attribute.value.toLocaleLowerCase('ru'),
      source_record_id: sourceRecordId,
    });
  }
  return rows;
}

/**
 * Persists non-contact participant attributes (university, project, statuses…)
 * as PERSON field observations so imported knowledge is queryable instead of
 * living only inside source_records.raw_json.
 */
async function persistPersonAttributes(
  client: PoolClient,
  plan: WorkbookImportPlan,
  assignments: readonly Assignment[],
): Promise<number> {
  const rowsByKey = new Map(
    plan.sourceRows.map((row) => [sourceKey(row.sheetName, row.rowNumber), row]),
  );
  const dedupe = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const assignment of assignments) {
    const sourceRow = rowsByKey.get(
      sourceKey(assignment.observation.sheetName, assignment.observation.rowNumber),
    );
    if (sourceRow === undefined) continue;
    rows.push(
      ...personAttributeRows(
        assignment.personId,
        assignment.sourceRecordId,
        sourceRow,
        assignment.observation.slotKey,
        dedupe,
      ),
    );
  }
  return insertJsonRows(client, INSERT_PERSON_ATTRIBUTES_SQL, rows);
}

export interface BackfillAttributesResult {
  readonly observationsScanned: number;
  readonly attributesCreated: number;
}

/**
 * Recovers attributes for observations that were imported before attribute
 * extraction existed, reading the immutable raw row JSON already stored in
 * source_records. Safe to re-run: existing rows are skipped.
 */
export async function backfillPersonAttributes(databaseUrl: string): Promise<BackfillAttributesResult> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const observations = await client.query<{
      person_id: string;
      slot_key: string;
      source_record_id: string;
      raw_json: { sheetName: string; cells: AttributeSourceRow['cells'] };
    }>(
      `select po.resolved_person_id as person_id, po.slot_key,
              sr.id as source_record_id, sr.raw_json
         from person_observations po
         join source_records sr on sr.id = po.source_record_id
         join persons p on p.id = po.resolved_person_id
        where po.resolution_status = 'RESOLVED'
          and po.resolved_person_id is not null
          and p.archived_at is null`,
    );
    const dedupe = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const observation of observations.rows) {
      rows.push(
        ...personAttributeRows(
          observation.person_id,
          observation.source_record_id,
          {
            sheetName: observation.raw_json.sheetName,
            cells: observation.raw_json.cells ?? [],
          },
          observation.slot_key,
          dedupe,
        ),
      );
    }
    const attributesCreated = await insertJsonRows(client, INSERT_PERSON_ATTRIBUTES_SQL, rows);
    await client.query('commit');
    return { observationsScanned: observations.rowCount ?? 0, attributesCreated };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function queueDuplicateCandidates(
  client: PoolClient,
  organizationId: string,
  createdPersons: ReadonlySet<string>,
): Promise<number> {
  const ids = [...createdPersons];
  if (ids.length === 0) return 0;

  const nameMatches = await client.query<{ person_a_id: string; person_b_id: string }>(
    `select distinct least(np.id, p.id) as person_a_id, greatest(np.id, p.id) as person_b_id
     from persons np
     join persons p
       on p.organization_id = np.organization_id
      and p.normalized_full_name = np.normalized_full_name
      and p.id <> np.id
      and p.archived_at is null
      and p.merged_into_person_id is null
     where np.id = any($1::uuid[])
       and np.organization_id = $2
       and np.normalized_full_name <> ''
       and np.normalized_full_name not like 'неизвестный участник (%'`,
    [ids, organizationId],
  );
  const contactMatches = await client.query<{
    person_a_id: string;
    person_b_id: string;
    contact_type: ContactObservation['type'];
  }>(
    `select distinct least(nc.person_id, c.person_id) as person_a_id,
       greatest(nc.person_id, c.person_id) as person_b_id,
       nc.type as contact_type
     from contact_points nc
     join persons np on np.id = nc.person_id
     join contact_points c
       on c.type = nc.type
      and c.normalized_value = nc.normalized_value
      and c.person_id <> nc.person_id
      and c.archived_at is null
     join persons p
       on p.id = c.person_id
      and p.organization_id = np.organization_id
      and p.archived_at is null
      and p.merged_into_person_id is null
     where nc.person_id = any($1::uuid[])
       and nc.archived_at is null
       and np.organization_id = $2`,
    [ids, organizationId],
  );

  const pairs = new Map<
    string,
    { readonly a: string; readonly b: string; readonly evidence: Set<string> }
  >();
  for (const match of nameMatches.rows) {
    const key = `${match.person_a_id}\u0000${match.person_b_id}`;
    const pair = pairs.get(key) ?? {
      a: match.person_a_id,
      b: match.person_b_id,
      evidence: new Set<string>(),
    };
    pair.evidence.add('EXACT_NORMALIZED_FULL_NAME');
    pairs.set(key, pair);
  }
  for (const match of contactMatches.rows) {
    const key = `${match.person_a_id}\u0000${match.person_b_id}`;
    const pair = pairs.get(key) ?? {
      a: match.person_a_id,
      b: match.person_b_id,
      evidence: new Set<string>(),
    };
    pair.evidence.add(`EXACT_NORMALIZED_CONTACT:${match.contact_type}`);
    pairs.set(key, pair);
  }

  const rows = [...pairs.values()].map((pair) => {
    const evidence = [...pair.evidence].sort();
    const hasContact = evidence.some((entry) => entry.startsWith('EXACT_NORMALIZED_CONTACT:'));
    return {
      id: randomUUID(),
      person_a_id: pair.a,
      person_b_id: pair.b,
      confidence_basis_points: hasContact ? 9_000 : 6_500,
      evidence_fingerprint: fingerprint({
        version: 'exact-evidence-v1',
        personAId: pair.a,
        personBId: pair.b,
        evidence,
      }),
      reasons: evidence.map((code) => ({ code })),
      conflicts: [],
    };
  });
  return insertJsonRows(
    client,
    `insert into duplicate_candidates
       (id, person_a_id, person_b_id, confidence_basis_points,
        evidence_fingerprint, reasons, conflicts, status)
     select x.id, x.person_a_id, x.person_b_id, x.confidence_basis_points,
       x.evidence_fingerprint, x.reasons, x.conflicts, 'OPEN'
     from jsonb_to_recordset($1::jsonb) as x(
       id uuid, person_a_id uuid, person_b_id uuid, confidence_basis_points integer,
       evidence_fingerprint text, reasons jsonb, conflicts jsonb)
     on conflict (person_a_id, person_b_id, evidence_fingerprint) do nothing`,
    rows,
  );
}

async function rebuildSearchDocuments(
  client: PoolClient,
  personIds: ReadonlySet<string>,
): Promise<void> {
  const ids = [...personIds];
  if (ids.length === 0) return;
  await client.query(
    `insert into person_search_documents
       (person_id, internal_ids, canonical_name, aliases, contacts, organizations,
        projects, artifacts, search_text, match_metadata, rebuilt_at)
     select p.id,
            p.id::text,
            p.normalized_full_name,
            '',
            coalesce(string_agg(distinct cp.normalized_value, ' '), ''),
            '', '',
            coalesce((
              select string_agg(distinct artifact.title, ' ' order by artifact.title)
                from artifact_version_contributors contributor
                join artifact_versions version on version.id = contributor.artifact_version_id
                join artifacts artifact on artifact.id = version.artifact_id
               where contributor.person_id = p.id
                 and version.status <> 'VOIDED'
                 and artifact.status <> 'VOIDED'
            ), ''),
            concat_ws(' ', p.id::text, p.normalized_full_name,
              string_agg(distinct cp.normalized_value, ' '),
              (select string_agg(distinct artifact.title, ' ' order by artifact.title)
                 from artifact_version_contributors contributor
                 join artifact_versions version on version.id = contributor.artifact_version_id
                 join artifacts artifact on artifact.id = version.artifact_id
                where contributor.person_id = p.id
                  and version.status <> 'VOIDED'
                  and artifact.status <> 'VOIDED')),
            jsonb_build_object('origin', 'LEGACY_IMPORT'),
            now()
       from persons p
       left join contact_points cp on cp.person_id = p.id and cp.archived_at is null
      where p.id = any($1::uuid[])
      group by p.id
     on conflict (person_id) do update
       set canonical_name = excluded.canonical_name,
           contacts = excluded.contacts,
           artifacts = excluded.artifacts,
           search_text = excluded.search_text,
           match_metadata = excluded.match_metadata,
           rebuilt_at = now(),
           updated_at = now()`,
    [ids],
  );
}

export async function commitImportPlan(
  plan: WorkbookImportPlan,
  options: CommitOptions,
  poolOverride?: Pool,
): Promise<CommitResult> {
  assertUuid('organizationId', options.organizationId);
  assertUuid('initiatedByUserId', options.initiatedByUserId);
  const pool = poolOverride ?? new Pool({ connectionString: options.databaseUrl, max: 1 });
  const ownsPool = poolOverride === undefined;
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtextextended('cpi-import:' || $1, 0))", [
      options.organizationId,
    ]);
    await assertCommitPrincipals(client, options);
    const sourceFileObjectId = await ensureSourceFileObject(client, plan, options);
    const batch = await createOrReuseBatch(client, plan, options, sourceFileObjectId);
    const runId = await createRun(
      client,
      batch.id,
      options.initiatedByUserId,
      options.basedOnRunId,
    );
    const sources = await persistSourceRecords(client, plan, batch.id);
    const people = await persistPeopleAndObservations(
      client,
      plan,
      options,
      batch.id,
      runId,
      sources.ids,
    );
    const hygieneSummary = summarizePersonNameHygiene(plan);
    await markIgnoredNameSourceRecords(client, plan, sources.ids);
    const hygieneCleanup = await archiveInvalidImportedPeopleInTransaction(client, {
      organizationId: options.organizationId,
      actorUserId: options.initiatedByUserId,
      requestId: `import:${runId}:name-hygiene`,
      importRunId: runId,
    });
    const eventAssignments = await loadResolvedEventAssignments(
      client,
      plan,
      batch.id,
      sources.ids,
    );
    const eventFacts = await persistEventsAndParticipations(
      client,
      eventAssignments,
      options.organizationId,
      runId,
    );
    const legacyArtifacts = await persistLegacyArtifacts(client, {
      plan,
      organizationId: options.organizationId,
      initiatedByUserId: options.initiatedByUserId,
      runId,
      batchId: batch.id,
      sourceIds: sources.ids,
      eventAssignments: eventAssignments.map((assignment) => ({
        sourceRecordId: assignment.sourceRecordId,
        personId: assignment.personId,
        eventName: assignment.observation.eventName,
      })),
      eventIds: eventFacts.eventIds,
    });
    const contacts = await persistContacts(client, people.assignments);
    const provenance = await persistProvenance(
      client,
      runId,
      people.assignments,
      people.createdPersons,
      contacts.observationContacts,
      contacts.createdContactIds,
    );
    const personAttributes = await persistPersonAttributes(client, plan, people.assignments);
    const duplicateCandidates = await queueDuplicateCandidates(
      client,
      options.organizationId,
      people.createdPersons,
    );
    await rebuildSearchDocuments(client, people.createdPersons);
    const deduplication = await autoResolveDuplicateCandidatesInTransaction(client, {
      organizationId: options.organizationId,
      actorUserId: options.initiatedByUserId,
      actorSubject: 'cpi-importer',
      requestId: `import:${runId}:auto-dedupe`,
      importRunId: runId,
    });
    await recalculateLegacyArtifactAuthors(client, legacyArtifacts.versionIds);

    const result: CommitResult = {
      batchId: batch.id,
      runId,
      reusedBatch: batch.reused,
      deduplication,
      dataHygiene: { summary: hygieneSummary, cleanup: hygieneCleanup },
      created: {
        sourceRecords: sources.created,
        personObservations: people.createdObservations,
        persons: people.createdPersons.size,
        contacts: contacts.created,
        events: eventFacts.events,
        eventParticipations: eventFacts.participations,
        artifacts: legacyArtifacts.artifacts,
        artifactVersions: legacyArtifacts.artifactVersions,
        artifactContributors: legacyArtifacts.artifactContributors,
        provenanceLinks: provenance.links + eventFacts.links + legacyArtifacts.provenanceLinks,
        fieldObservations: provenance.fields,
        personAttributes,
        duplicateCandidates,
      },
    };
    await client.query(
      `update import_runs
       set status = 'SUCCEEDED', statistics = $2::jsonb, finished_at = now(), updated_at = now()
       where id = $1`,
      [
        runId,
        JSON.stringify({
          controls: {
            sheets: plan.sheets.length,
            sourceRows: plan.sourceRows.length,
            personObservations: plan.observations.length,
            catalyst2025: plan.catalyst2025,
          },
          created: result.created,
          dataHygiene: result.dataHygiene,
          deduplication: result.deduplication,
          sha256: plan.sha256,
        }),
      ],
    );
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    if (ownsPool) await pool.end();
  }
}
