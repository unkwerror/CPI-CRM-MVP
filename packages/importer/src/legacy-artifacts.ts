import { randomUUID } from 'node:crypto';

import {
  FixedClock,
  calculateLifecycle,
  collapseWhitespace,
  normalizeFullName,
  type ActivityStatus,
  type ActivationState,
} from '@cpi-crm/domain';
import type { PoolClient } from 'pg';

import { extractLegacyArtifactMaterials, type LegacyArtifactMaterial } from './artifacts.js';
import { fingerprint } from './hash.js';
import type { WorkbookImportPlan } from './types.js';

const JSON_CHUNK_SIZE = 750;
const MATERIAL_RELATION_PREFIX = 'LEGACY_MATERIAL_COLUMN:';
const COUNTABILITY_REASONS = Object.freeze({
  countableForActivation: true,
  countableForActivity: false,
  evidence: 'PROVEN_LEGACY_MATERIAL',
  pending: 'SUBMITTED_AT_UNKNOWN',
});

export interface LegacyArtifactEventAssignment {
  readonly sourceRecordId: string;
  readonly personId: string;
  readonly eventName: string;
}

export interface PersistLegacyArtifactsInput {
  readonly plan: WorkbookImportPlan;
  readonly organizationId: string;
  readonly initiatedByUserId: string;
  readonly runId: string;
  readonly batchId: string;
  readonly sourceIds: ReadonlyMap<string, string>;
  readonly eventAssignments: readonly LegacyArtifactEventAssignment[];
  readonly eventIds: ReadonlyMap<string, string>;
}

export interface LegacyArtifactPersistenceResult {
  readonly artifacts: number;
  readonly artifactVersions: number;
  readonly artifactContributors: number;
  readonly provenanceLinks: number;
  /** Includes previously imported versions so lifecycle reconciliation is repeat-safe. */
  readonly versionIds: ReadonlySet<string>;
}

interface ResolvedMaterial {
  readonly material: LegacyArtifactMaterial;
  readonly sourceRecordId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly authorIds: readonly string[];
  readonly relation: string;
  readonly factFingerprint: string;
}

interface ExistingMaterialEntity {
  readonly artifactId: string;
  readonly versionId: string;
}

export async function persistLegacyArtifacts(
  client: PoolClient,
  input: PersistLegacyArtifactsInput,
): Promise<LegacyArtifactPersistenceResult> {
  const materials = extractLegacyArtifactMaterials(input.plan.sourceRows);
  if (materials.length === 0) {
    return {
      artifacts: 0,
      artifactVersions: 0,
      artifactContributors: 0,
      provenanceLinks: 0,
      versionIds: new Set(),
    };
  }

  const resolved = resolveMaterials(materials, input);
  const existing = await loadExistingMaterialEntities(client, input.batchId, resolved);
  await validateExistingMaterialEntities(client, input.organizationId, resolved, existing);

  const pending = resolved.filter((item) => !existing.has(materialKey(item)));
  const artifactRows: Record<string, unknown>[] = [];
  const versionRows: Record<string, unknown>[] = [];
  const assetRows: Record<string, unknown>[] = [];
  const contributorRows: Record<string, unknown>[] = [];
  const linkRows: Record<string, unknown>[] = [];
  const versionIds = new Set([...existing.values()].map((item) => item.versionId));

  if (pending.length > 0) {
    const typeIds = await loadArtifactTypeIds(client);
    for (const item of pending) {
      const artifactId = randomUUID();
      const versionId = randomUUID();
      const typeId = typeIds.get(item.material.typeCode);
      if (typeId === undefined) {
        throw new Error(`Artifact type ${item.material.typeCode} is not configured`);
      }
      artifactRows.push({
        id: artifactId,
        organization_id: input.organizationId,
        type_id: typeId,
        title: materialTitle(item),
        event_id: item.eventId,
        created_by_user_id: input.initiatedByUserId,
      });
      versionRows.push({
        id: versionId,
        artifact_id: artifactId,
        content_type: item.material.contentType,
        text_content: item.material.textContent,
        content_fingerprint: item.material.contentFingerprint,
        uploaded_by_user_id: input.initiatedByUserId,
        countability_reasons: COUNTABILITY_REASONS,
      });
      if (item.material.externalUrl !== null) {
        assetRows.push({
          id: randomUUID(),
          artifact_version_id: versionId,
          external_url: item.material.externalUrl,
        });
      }
      for (const personId of item.authorIds) {
        contributorRows.push({
          id: randomUUID(),
          artifact_version_id: versionId,
          person_id: personId,
        });
      }
      linkRows.push(
        {
          id: randomUUID(),
          source_record_id: item.sourceRecordId,
          import_run_id: input.runId,
          entity_type: 'ARTIFACT',
          entity_id: artifactId,
          relation: item.relation,
          fact_fingerprint: item.factFingerprint,
        },
        {
          id: randomUUID(),
          source_record_id: item.sourceRecordId,
          import_run_id: input.runId,
          entity_type: 'ARTIFACT_VERSION',
          entity_id: versionId,
          relation: item.relation,
          fact_fingerprint: item.factFingerprint,
        },
      );
      versionIds.add(versionId);
    }
  }

  const artifacts = await insertJsonRows(
    client,
    `INSERT INTO artifacts
       (id, organization_id, type_id, title, event_id, created_by_user_id)
     SELECT x.id, x.organization_id, x.type_id, x.title, x.event_id, x.created_by_user_id
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, organization_id uuid, type_id uuid, title text,
         event_id uuid, created_by_user_id uuid)`,
    artifactRows,
  );
  const artifactVersions = await insertJsonRows(
    client,
    `INSERT INTO artifact_versions
       (id, artifact_id, version_number, status, content_type, text_content,
        submitted_at, recorded_at, content_fingerprint, uploaded_by_user_id,
        qualifies_for_activation, qualifies_for_activity, countability_reasons, data_origin)
     SELECT x.id, x.artifact_id, 1, 'DRAFT', x.content_type::artifact_content_type,
            x.text_content, NULL, now(), x.content_fingerprint, x.uploaded_by_user_id,
            false, false, x.countability_reasons, 'LEGACY_IMPORT'
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, artifact_id uuid, content_type text, text_content text,
         content_fingerprint text, uploaded_by_user_id uuid, countability_reasons jsonb)`,
    versionRows,
  );
  const artifactAssets = await insertJsonRows(
    client,
    `INSERT INTO artifact_assets
       (id, artifact_version_id, asset_type, external_url, display_order)
     SELECT x.id, x.artifact_version_id, 'EXTERNAL_URL', x.external_url, 0
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, artifact_version_id uuid, external_url text)`,
    assetRows,
  );
  const artifactContributors = await insertJsonRows(
    client,
    `INSERT INTO artifact_version_contributors
       (id, artifact_version_id, person_id, contribution_role, authorship_source)
     SELECT x.id, x.artifact_version_id, x.person_id, 'AUTHOR', 'LEGACY_SOURCE_ROW'
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, artifact_version_id uuid, person_id uuid)`,
    contributorRows,
  );
  if (versionRows.length > 0) {
    const submitted = await client.query(
      `UPDATE artifact_versions
          SET status = 'SUBMITTED', qualifies_for_activation = true,
              qualifies_for_activity = false, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'DRAFT'`,
      [versionRows.map((row) => row.id)],
    );
    if ((submitted.rowCount ?? 0) !== versionRows.length) {
      throw new Error('Could not submit every imported legacy artifact version');
    }
  }
  const provenanceLinks = await insertJsonRows(
    client,
    `INSERT INTO source_entity_links
       (id, source_record_id, import_run_id, entity_type, entity_id, relation,
        fact_fingerprint, created_entity)
     SELECT x.id, x.source_record_id, x.import_run_id, x.entity_type,
            x.entity_id, x.relation, x.fact_fingerprint, true
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, source_record_id uuid, import_run_id uuid, entity_type text,
         entity_id uuid, relation text, fact_fingerprint text)`,
    linkRows,
  );

  if (
    artifacts !== pending.length ||
    artifactVersions !== pending.length ||
    artifactAssets !== assetRows.length ||
    artifactContributors !== contributorRows.length ||
    provenanceLinks !== linkRows.length
  ) {
    throw new Error('Could not persist every legacy artifact fact');
  }

  return {
    artifacts,
    artifactVersions,
    artifactContributors,
    provenanceLinks,
    versionIds,
  };
}

export async function recalculateLegacyArtifactAuthors(
  client: PoolClient,
  versionIds: ReadonlySet<string>,
  now = new Date(),
): Promise<number> {
  if (versionIds.size === 0) return 0;
  const authors = await client.query<{
    person_id: string;
    related_version_id: string;
  }>(
    `SELECT COALESCE(person.merged_into_person_id, person.id) AS person_id,
            min(contributor.artifact_version_id::text)::uuid AS related_version_id
       FROM artifact_version_contributors contributor
       JOIN persons person ON person.id = contributor.person_id
      WHERE contributor.artifact_version_id = ANY($1::uuid[])
        AND contributor.contribution_role = 'AUTHOR'
        AND person.archived_at IS NULL
      GROUP BY COALESCE(person.merged_into_person_id, person.id)
      ORDER BY person_id`,
    [[...versionIds]],
  );
  for (const author of authors.rows) {
    await recalculateLegacyArtifactAuthor(client, author.person_id, author.related_version_id, now);
  }
  return authors.rows.length;
}

function resolveMaterials(
  materials: readonly LegacyArtifactMaterial[],
  input: PersistLegacyArtifactsInput,
): readonly ResolvedMaterial[] {
  const assignmentsBySource = new Map<
    string,
    {
      readonly eventIds: Set<string>;
      readonly eventNames: Set<string>;
      readonly authors: Set<string>;
    }
  >();
  for (const assignment of input.eventAssignments) {
    const normalizedEventName = normalizeFullName(assignment.eventName);
    const eventId = input.eventIds.get(normalizedEventName);
    if (eventId === undefined) throw new Error('Legacy artifact event resolution was lost');
    let grouped = assignmentsBySource.get(assignment.sourceRecordId);
    if (grouped === undefined) {
      grouped = { eventIds: new Set(), eventNames: new Set(), authors: new Set() };
      assignmentsBySource.set(assignment.sourceRecordId, grouped);
    }
    grouped.eventIds.add(eventId);
    grouped.eventNames.add(collapseWhitespace(assignment.eventName));
    grouped.authors.add(assignment.personId);
  }

  return materials.flatMap((material) => {
    const sourceRecordId = input.sourceIds.get(sourceKey(material.sheetName, material.rowNumber));
    if (sourceRecordId === undefined) throw new Error('Legacy artifact source record is missing');
    const grouped = assignmentsBySource.get(sourceRecordId);
    if (grouped === undefined || grouped.authors.size === 0) {
      // A rejected person-name observation must not be resurrected merely to
      // attach a material. The immutable source cell remains in SourceRecord.
      return [];
    }
    if (grouped.eventIds.size !== 1 || grouped.eventNames.size !== 1) {
      throw new Error(
        `Legacy material at ${material.sheetName}:${material.rowNumber}:${material.column} has an ambiguous event`,
      );
    }
    const eventId = [...grouped.eventIds][0]!;
    const eventName = [...grouped.eventNames][0]!;
    const authorIds = [...grouped.authors].sort();
    const relation = `${MATERIAL_RELATION_PREFIX}${material.column}`;
    const factFingerprint = fingerprint({
      version: 'legacy-material-v1',
      sourceRowHash: material.sourceRowHash,
      column: material.column,
      normalizedHeader: material.normalizedHeader,
      typeCode: material.typeCode,
      contentType: material.contentType,
      contentFingerprint: material.contentFingerprint,
      eventId,
      authorIds,
    });
    return [
      {
        material,
        sourceRecordId,
        eventId,
        eventName,
        authorIds,
        relation,
        factFingerprint,
      },
    ];
  });
}

async function loadExistingMaterialEntities(
  client: PoolClient,
  batchId: string,
  resolved: readonly ResolvedMaterial[],
): Promise<ReadonlyMap<string, ExistingMaterialEntity>> {
  const result = await client.query<{
    source_record_id: string;
    entity_type: string;
    entity_id: string;
    relation: string;
  }>(
    `SELECT link.source_record_id, upper(link.entity_type) AS entity_type,
            link.entity_id, link.relation
       FROM source_entity_links link
       JOIN source_records source ON source.id = link.source_record_id
      WHERE source.batch_id = $1
        AND link.detached_at IS NULL
        AND upper(link.entity_type) IN ('ARTIFACT', 'ARTIFACT_VERSION')
        AND link.relation ~ '^LEGACY_MATERIAL_COLUMN:[0-9]+$'
      ORDER BY link.source_record_id, link.entity_type, link.relation, link.entity_id`,
    [batchId],
  );
  const expectedKeys = new Set(resolved.map(materialKey));
  const artifacts = new Map<string, string>();
  const versions = new Map<string, string>();
  for (const row of result.rows) {
    const key = `${row.source_record_id}\u0000${row.relation}`;
    if (!expectedKeys.has(key)) continue;
    const target = row.entity_type === 'ARTIFACT' ? artifacts : versions;
    if (target.has(key)) throw new Error(`Multiple active legacy material links for ${key}`);
    target.set(key, row.entity_id);
  }
  const existing = new Map<string, ExistingMaterialEntity>();
  for (const key of expectedKeys) {
    const artifactId = artifacts.get(key);
    const versionId = versions.get(key);
    if ((artifactId === undefined) !== (versionId === undefined)) {
      throw new Error(`Incomplete legacy material provenance for ${key}`);
    }
    if (artifactId !== undefined && versionId !== undefined) {
      existing.set(key, { artifactId, versionId });
    }
  }
  return existing;
}

async function validateExistingMaterialEntities(
  client: PoolClient,
  organizationId: string,
  resolved: readonly ResolvedMaterial[],
  existing: ReadonlyMap<string, ExistingMaterialEntity>,
): Promise<void> {
  if (existing.size === 0) return;
  const factsByKey = new Map(resolved.map((item) => [materialKey(item), item]));
  const versionIds = [...existing.values()].map((item) => item.versionId);
  const persisted = await client.query<{
    version_id: string;
    artifact_id: string;
    organization_id: string;
    event_id: string | null;
    content_fingerprint: string | null;
    status: string;
  }>(
    `SELECT version.id AS version_id, artifact.id AS artifact_id,
            artifact.organization_id, artifact.event_id,
            version.content_fingerprint, version.status
       FROM artifact_versions version
       JOIN artifacts artifact ON artifact.id = version.artifact_id
      WHERE version.id = ANY($1::uuid[])`,
    [versionIds],
  );
  const persistedByVersion = new Map(persisted.rows.map((row) => [row.version_id, row]));
  const contributors = await client.query<{
    artifact_version_id: string;
    person_id: string;
  }>(
    `SELECT artifact_version_id, person_id
       FROM artifact_version_contributors
      WHERE artifact_version_id = ANY($1::uuid[])
        AND contribution_role = 'AUTHOR'`,
    [versionIds],
  );
  const authorsByVersion = new Map<string, Set<string>>();
  for (const contributor of contributors.rows) {
    const authors = authorsByVersion.get(contributor.artifact_version_id) ?? new Set<string>();
    authors.add(contributor.person_id);
    authorsByVersion.set(contributor.artifact_version_id, authors);
  }

  for (const [key, entity] of existing) {
    const fact = factsByKey.get(key)!;
    const row = persistedByVersion.get(entity.versionId);
    if (
      row === undefined ||
      row.artifact_id !== entity.artifactId ||
      row.organization_id !== organizationId ||
      row.event_id !== fact.eventId ||
      row.content_fingerprint !== fact.material.contentFingerprint ||
      row.status !== 'SUBMITTED'
    ) {
      throw new Error(`Legacy material entity no longer matches immutable source fact ${key}`);
    }
    const authors = authorsByVersion.get(entity.versionId) ?? new Set<string>();
    if (fact.authorIds.some((personId) => !authors.has(personId))) {
      throw new Error(`Legacy material authors no longer match immutable source fact ${key}`);
    }
  }
}

async function loadArtifactTypeIds(client: PoolClient): Promise<ReadonlyMap<string, string>> {
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code
       FROM artifact_types
      WHERE code = ANY($1::text[]) AND archived_at IS NULL`,
    [['PITCH_DECK', 'OTHER']],
  );
  const ids = new Map(result.rows.map((row) => [row.code, row.id]));
  if (!ids.has('PITCH_DECK') || !ids.has('OTHER')) {
    throw new Error('Legacy artifact types PITCH_DECK and OTHER must be configured');
  }
  return ids;
}

async function recalculateLegacyArtifactAuthor(
  client: PoolClient,
  personId: string,
  relatedVersionId: string,
  now: Date,
): Promise<void> {
  const profile = await client.query<{
    lifecycle_data_state: 'LEGACY_INCOMPLETE' | 'COMPLETE';
    activation_state: ActivationState;
    activity_status: ActivityStatus;
    rule_set_id: string;
    rule_version: number;
    active_window_hours: number;
    inactive_after_hours: number;
  }>(
    `SELECT person.lifecycle_data_state, person.activation_state, person.activity_status,
            rules.id AS rule_set_id, rules.rule_version,
            rules.active_window_hours, rules.inactive_after_hours
       FROM persons person
       JOIN organization_settings settings ON settings.organization_id = person.organization_id
       JOIN lifecycle_rule_sets rules ON rules.id = settings.current_lifecycle_rule_set_id
      WHERE person.id = $1 AND person.archived_at IS NULL
        AND person.merged_into_person_id IS NULL
      FOR UPDATE OF person`,
    [personId],
  );
  const current = profile.rows[0];
  if (current === undefined) throw new Error('Canonical legacy artifact author was not found');
  const evidence = await client.query<{
    qualifies_for_activation: boolean;
    qualifies_for_activity: boolean;
    submitted_at: Date | null;
    recorded_at: Date | null;
  }>(
    `SELECT version.qualifies_for_activation, version.qualifies_for_activity,
            version.submitted_at, version.recorded_at
       FROM artifact_version_contributors contributor
       JOIN persons author ON author.id = contributor.person_id
       JOIN artifact_versions version ON version.id = contributor.artifact_version_id
       JOIN artifacts artifact ON artifact.id = version.artifact_id
      WHERE (author.id = $1 OR author.merged_into_person_id = $1)
        AND author.archived_at IS NULL
        AND contributor.contribution_role = 'AUTHOR'
        AND version.status = 'SUBMITTED'
        AND artifact.status <> 'VOIDED'`,
    [personId],
  );
  const calculated = calculateLifecycle(
    {
      lifecycleDataState: current.lifecycle_data_state,
      evidence: evidence.rows.map((row) => ({
        qualifiesForActivation: row.qualifies_for_activation,
        qualifiesForActivity: row.qualifies_for_activity,
        submittedAt: row.submitted_at,
        recordedAt: row.recorded_at,
      })),
    },
    {
      clock: new FixedClock(now),
      ruleSet: {
        id: current.rule_set_id,
        version: current.rule_version,
        activeWindowHours: current.active_window_hours,
        inactiveAfterHours: current.inactive_after_hours,
      },
    },
  );
  await client.query(
    `UPDATE persons
        SET activation_state = $2, activity_status = $3, activated_at = $4,
            activation_recorded_at = $5, last_artifact_at = $6,
            next_status_transition_at = $7, applied_lifecycle_rule_set_id = $8,
            updated_at = now()
      WHERE id = $1`,
    [
      personId,
      calculated.activationState,
      calculated.activityStatus,
      calculated.activatedAt,
      calculated.activationRecordedAt,
      calculated.lastArtifactAt,
      calculated.nextStatusTransitionAt,
      current.rule_set_id,
    ],
  );
  if (current.activation_state !== calculated.activationState) {
    await insertLifecycleTransition(client, {
      personId,
      dimension: 'ACTIVATION',
      fromState: current.activation_state,
      toState: calculated.activationState,
      reason: 'LEGACY_STATE_RESOLVED',
      ruleSetId: current.rule_set_id,
      ruleSetVersion: current.rule_version,
      relatedVersionId,
      effectiveAt: calculated.calculatedAt,
    });
  }
  if (current.activity_status !== calculated.activityStatus) {
    await insertLifecycleTransition(client, {
      personId,
      dimension: 'ACTIVITY',
      fromState: current.activity_status,
      toState: calculated.activityStatus,
      reason: 'RECONCILIATION',
      ruleSetId: current.rule_set_id,
      ruleSetVersion: current.rule_version,
      relatedVersionId,
      effectiveAt: calculated.calculatedAt,
    });
  }
}

async function insertLifecycleTransition(
  client: PoolClient,
  input: {
    readonly personId: string;
    readonly dimension: 'ACTIVATION' | 'ACTIVITY';
    readonly fromState: string;
    readonly toState: string;
    readonly reason: 'LEGACY_STATE_RESOLVED' | 'RECONCILIATION';
    readonly ruleSetId: string;
    readonly ruleSetVersion: number;
    readonly relatedVersionId: string;
    readonly effectiveAt: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO lifecycle_status_history
       (person_id, dimension, from_state, to_state, reason, lifecycle_rule_set_id,
        artifact_version_id, effective_at, detected_at, metadata)
     VALUES ($1, $2::lifecycle_dimension, $3, $4, $5::lifecycle_transition_reason,
             $6, $7, $8, now(), $9::jsonb)`,
    [
      input.personId,
      input.dimension,
      input.fromState,
      input.toState,
      input.reason,
      input.ruleSetId,
      input.relatedVersionId,
      input.effectiveAt,
      JSON.stringify({
        ruleSetVersion: input.ruleSetVersion,
        evidence: 'PROVEN_LEGACY_MATERIAL',
        submittedAtKnown: false,
      }),
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ('person_lifecycle_changed', 'person', $1, $2::jsonb)`,
    [
      input.personId,
      JSON.stringify({
        personId: input.personId,
        dimension: input.dimension,
        fromState: input.fromState,
        toState: input.toState,
        reason: input.reason,
        lifecycleRuleSetId: input.ruleSetId,
        lifecycleRuleSetVersion: input.ruleSetVersion,
        artifactVersionId: input.relatedVersionId,
        effectiveAt: input.effectiveAt.toISOString(),
      }),
    ],
  );
}

function materialTitle(item: ResolvedMaterial): string {
  const prefix = item.material.typeCode === 'PITCH_DECK' ? 'Презентация' : 'Материал';
  return [...`${prefix}: ${item.eventName}`].slice(0, 500).join('');
}

function materialKey(item: Pick<ResolvedMaterial, 'sourceRecordId' | 'relation'>): string {
  return `${item.sourceRecordId}\u0000${item.relation}`;
}

function sourceKey(sheetName: string, rowNumber: number): string {
  return `${sheetName}\u0000${rowNumber}`;
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
