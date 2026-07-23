import type { Pool, PoolClient } from 'pg';

export const AUTO_DEDUPE_POLICY_VERSION = 'AUTO_DEDUPE_V1' as const;

const AUTO_MERGE_REASON = `${AUTO_DEDUPE_POLICY_VERSION}: автоматическое объединение совместимых карточек`;
const AUTO_NOT_DUPLICATE_REASON = `${AUTO_DEDUPE_POLICY_VERSION}: конфликт стабильных внешних идентификаторов`;
const AUTO_DISMISS_REASON = `${AUTO_DEDUPE_POLICY_VERSION}: недостаточное или загрязнённое доказательство`;

export interface AutoDeduplicationInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly actorSubject?: string | null;
  readonly requestId: string;
  readonly importRunId?: string | null;
  /**
   * Optional hint used only for deterministic master selection. Existing
   * profiles win over profiles created by the mutation that invoked the
   * resolver. It never changes the merge eligibility policy.
   */
  readonly newlyCreatedPersonIds?: readonly string[];
}

export interface AutoDeduplicationResult {
  readonly policyVersion: typeof AUTO_DEDUPE_POLICY_VERSION;
  readonly candidatesExamined: number;
  readonly mergedCandidates: number;
  readonly notDuplicateCandidates: number;
  readonly dismissedCandidates: number;
  readonly mergedProfiles: number;
  readonly components: number;
  readonly remainingOpenCandidates: number;
  readonly masterPersonIds: readonly string[];
}

export interface DeduplicationPersonSnapshot {
  readonly id: string;
  readonly normalizedFullName: string;
  readonly mergedIntoPersonId: string | null;
  readonly createdAt: string;
  readonly provenanceCount?: number;
}

export interface DeduplicationContactSnapshot {
  readonly personId: string;
  readonly type: string;
  readonly normalizedValue: string;
}

export interface DeduplicationExternalIdentitySnapshot {
  readonly personId: string;
  readonly sourceNamespace: string;
  readonly externalId: string;
}

export interface DeduplicationCandidateSnapshot {
  readonly id: string;
  readonly personAId: string;
  readonly personBId: string;
  readonly evidenceFingerprint: string;
}

export interface AutoDeduplicationSnapshot {
  readonly persons: readonly DeduplicationPersonSnapshot[];
  readonly contacts: readonly DeduplicationContactSnapshot[];
  readonly externalIdentities: readonly DeduplicationExternalIdentitySnapshot[];
  readonly candidates: readonly DeduplicationCandidateSnapshot[];
  readonly newlyCreatedPersonIds?: readonly string[];
}

export interface PersonMergeChange {
  readonly personId: string;
  readonly beforeMergedIntoPersonId: string | null;
}

export interface AutoMergeComponentPlan {
  readonly masterPersonId: string;
  readonly memberPersonIds: readonly string[];
  readonly personChanges: readonly PersonMergeChange[];
  readonly mergedCandidateIds: readonly string[];
  readonly clusterBefore: readonly {
    readonly master: string;
    readonly members: readonly string[];
  }[];
  readonly clusterAfter: readonly {
    readonly master: string;
    readonly members: readonly string[];
  }[];
}

export interface AutoDeduplicationPlan {
  readonly components: readonly AutoMergeComponentPlan[];
  readonly mergedCandidateIds: readonly string[];
  readonly mergedWithoutOperationCandidateIds: readonly string[];
  readonly notDuplicateCandidateIds: readonly string[];
  readonly dismissedCandidateIds: readonly string[];
}

interface PersonRow {
  readonly id: string;
  readonly normalized_full_name: string;
  readonly merged_into_person_id: string | null;
  readonly created_at: Date;
  readonly provenance_count: string;
}

interface CandidateRow {
  readonly id: string;
  readonly person_a_id: string;
  readonly person_b_id: string;
  readonly evidence_fingerprint: string;
}

interface ContactRow {
  readonly person_id: string;
  readonly type: string;
  readonly normalized_value: string;
}

interface ExternalIdentityRow {
  readonly person_id: string;
  readonly source_namespace: string;
  readonly external_id: string;
}

interface MergeOperationItemInput {
  readonly action: 'REASSIGNED' | 'CANONICAL_VALUE_SELECTED';
  readonly entityType: 'person' | 'task' | 'duplicate_candidate';
  readonly entityId: string;
  readonly sourcePersonId: string | null;
  readonly targetPersonId: string | null;
  readonly fieldName: string;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

/**
 * A normalized name is compatible only when both variants contain at least
 * two distinct tokens and the smaller token set is a subset of the larger.
 * Word order is deliberately ignored; one-word placeholders never auto-merge.
 */
export function areNormalizedFullNamesCompatible(left: string, right: string): boolean {
  const leftTokens = normalizedNameTokens(left);
  const rightTokens = normalizedNameTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  const [smaller, larger] =
    leftTokens.length <= rightTokens.length
      ? [leftTokens, new Set(rightTokens)]
      : [rightTokens, new Set(leftTokens)];
  return smaller.every((token) => larger.has(token));
}

/**
 * Builds a deterministic, database-independent plan for AUTO_DEDUPE_V1.
 * Strong candidate edges are evaluated first as a graph. A whole connected
 * component is rejected when any two full names are incompatible or when it
 * contains different external IDs from the same source namespace.
 */
export function buildAutoDeduplicationPlan(
  snapshot: AutoDeduplicationSnapshot,
): AutoDeduplicationPlan {
  const persons = new Map(snapshot.persons.map((person) => [person.id, person]));
  const candidates = [...snapshot.candidates].sort(compareCandidate);
  const currentRootByPerson = resolveCurrentRoots(persons);
  const currentClusters = groupBy(snapshot.persons, (person) =>
    currentRootByPerson.get(person.id)!,
  );
  const contactsByPerson = new Map<string, Set<string>>();
  const ownersByContact = new Map<string, Set<string>>();

  for (const contact of snapshot.contacts) {
    if (!persons.has(contact.personId) || contact.normalizedValue.length === 0) continue;
    const key = contactKey(contact.type, contact.normalizedValue);
    addToSetMap(contactsByPerson, contact.personId, key);
    addToSetMap(ownersByContact, key, contact.personId);
  }

  const cleanContacts = new Set<string>();
  for (const [key, ownerIds] of ownersByContact) {
    if (allPersonNamesCompatible([...ownerIds], persons)) cleanContacts.add(key);
  }

  const strongCandidates = candidates.filter((candidate) => {
    const left = persons.get(candidate.personAId);
    const right = persons.get(candidate.personBId);
    if (!left || !right) return false;
    if (!areNormalizedFullNamesCompatible(left.normalizedFullName, right.normalizedFullName)) {
      return false;
    }
    const leftContacts = contactsByPerson.get(left.id);
    const rightContacts = contactsByPerson.get(right.id);
    if (!leftContacts || !rightContacts) return false;
    return [...leftContacts].some((key) => cleanContacts.has(key) && rightContacts.has(key));
  });

  const graph = new DisjointSet(snapshot.persons.map((person) => person.id));
  for (const person of snapshot.persons) {
    if (person.mergedIntoPersonId !== null) graph.union(person.id, person.mergedIntoPersonId);
  }
  for (const candidate of strongCandidates) graph.union(candidate.personAId, candidate.personBId);

  const graphComponents = groupBy(snapshot.persons, (person) => graph.find(person.id));
  const externalIdentitiesByPerson = groupBy(
    snapshot.externalIdentities.filter((identity) => persons.has(identity.personId)),
    (identity) => identity.personId,
  );
  const strongComponentIds = new Set(
    strongCandidates.map((candidate) => graph.find(candidate.personAId)),
  );
  const validComponentIds = new Set<string>();

  for (const componentId of strongComponentIds) {
    const members = graphComponents.get(componentId) ?? [];
    const memberIds = members.map((member) => member.id);
    if (
      allPersonNamesCompatible(memberIds, persons) &&
      !hasExternalIdentityConflict(memberIds, externalIdentitiesByPerson)
    ) {
      validComponentIds.add(componentId);
    }
  }

  const mergedCandidateIds: string[] = [];
  const notDuplicateCandidateIds: string[] = [];
  const dismissedCandidateIds: string[] = [];
  const mergedCandidatesByComponent = new Map<string, string[]>();

  for (const candidate of candidates) {
    const currentA = currentRootByPerson.get(candidate.personAId);
    const currentB = currentRootByPerson.get(candidate.personBId);
    if (!currentA || !currentB) {
      dismissedCandidateIds.push(candidate.id);
      continue;
    }

    const componentA = graph.find(candidate.personAId);
    const componentB = graph.find(candidate.personBId);
    const alreadyMerged = currentA === currentB;
    const mergesInValidComponent = componentA === componentB && validComponentIds.has(componentA);

    if (alreadyMerged || mergesInValidComponent) {
      mergedCandidateIds.push(candidate.id);
      if (mergesInValidComponent) {
        const list = mergedCandidatesByComponent.get(componentA) ?? [];
        list.push(candidate.id);
        mergedCandidatesByComponent.set(componentA, list);
      }
      continue;
    }

    if (
      hasDirectExternalIdentityConflict(
        candidate.personAId,
        candidate.personBId,
        externalIdentitiesByPerson,
      )
    ) {
      notDuplicateCandidateIds.push(candidate.id);
    } else {
      dismissedCandidateIds.push(candidate.id);
    }
  }

  const newlyCreated = new Set(snapshot.newlyCreatedPersonIds ?? []);
  const contactCounts = new Map(
    [...contactsByPerson].map(([personId, values]) => [personId, values.size]),
  );
  const externalIdentityCounts = new Map(
    [...externalIdentitiesByPerson].map(([personId, values]) => [personId, values.length]),
  );
  const operationCandidateIds = new Set<string>();
  const components: AutoMergeComponentPlan[] = [];

  for (const componentId of [...validComponentIds].sort()) {
    const members = graphComponents.get(componentId) ?? [];
    const memberIds = members.map((member) => member.id).sort();
    const roots = [...new Set(memberIds.map((id) => currentRootByPerson.get(id)!))].sort();
    if (roots.length < 2) continue;

    const masterPersonId = chooseMasterPersonId({
      roots,
      currentClusters,
      persons,
      newlyCreated,
      contactCounts,
      externalIdentityCounts,
    });
    const personChanges = memberIds
      .filter((personId) => personId !== masterPersonId)
      .map((personId) => ({
        personId,
        beforeMergedIntoPersonId: persons.get(personId)!.mergedIntoPersonId,
      }))
      .filter((change) => change.beforeMergedIntoPersonId !== masterPersonId)
      .sort((left, right) => left.personId.localeCompare(right.personId));
    const candidateIds = [...(mergedCandidatesByComponent.get(componentId) ?? [])].sort();
    for (const candidateId of candidateIds) operationCandidateIds.add(candidateId);
    const clusterBefore = roots.map((root) => ({
      master: root,
      members: (currentClusters.get(root) ?? []).map((person) => person.id).sort(),
    }));

    components.push({
      masterPersonId,
      memberPersonIds: memberIds,
      personChanges,
      mergedCandidateIds: candidateIds,
      clusterBefore,
      clusterAfter: [{ master: masterPersonId, members: memberIds }],
    });
  }

  components.sort((left, right) => left.masterPersonId.localeCompare(right.masterPersonId));
  return {
    components,
    mergedCandidateIds: mergedCandidateIds.sort(),
    mergedWithoutOperationCandidateIds: mergedCandidateIds
      .filter((candidateId) => !operationCandidateIds.has(candidateId))
      .sort(),
    notDuplicateCandidateIds: notDuplicateCandidateIds.sort(),
    dismissedCandidateIds: dismissedCandidateIds.sort(),
  };
}

/** Runs AUTO_DEDUPE_V1 in its own transaction. */
export async function autoResolveDuplicateCandidates(
  pool: Pool,
  input: AutoDeduplicationInput,
): Promise<AutoDeduplicationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await autoResolveDuplicateCandidatesInTransaction(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs inside an existing transaction. The caller must BEGIN before invoking
 * this function; the transaction-scoped advisory lock serializes all policy
 * decisions for one organization.
 */
export async function autoResolveDuplicateCandidatesInTransaction(
  client: PoolClient,
  input: AutoDeduplicationInput,
): Promise<AutoDeduplicationResult> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('cpi-auto-dedupe:' || $1::text, 0)
     )`,
    [input.organizationId],
  );
  await assertPrincipals(client, input);

  // A pg Client executes one statement at a time. Keeping these reads
  // sequential also makes the row-lock order explicit for future pg versions.
  const personRows = await client.query<PersonRow>(
    `SELECT p.id, p.normalized_full_name, p.merged_into_person_id, p.created_at,
              (SELECT count(*)::text
                 FROM source_entity_links sel
                WHERE upper(sel.entity_type) = 'PERSON'
                  AND sel.entity_id = p.id
                  AND sel.detached_at IS NULL) AS provenance_count
         FROM persons p
        WHERE p.organization_id = $1 AND p.archived_at IS NULL
        ORDER BY p.id
        FOR UPDATE OF p`,
    [input.organizationId],
  );
  const candidateRows = await client.query<CandidateRow>(
    `SELECT dc.id, dc.person_a_id, dc.person_b_id, dc.evidence_fingerprint
         FROM duplicate_candidates dc
         JOIN persons a ON a.id = dc.person_a_id
         JOIN persons b ON b.id = dc.person_b_id
        WHERE dc.status = 'OPEN'
          AND a.organization_id = $1
          AND b.organization_id = $1
          AND a.archived_at IS NULL
          AND b.archived_at IS NULL
        ORDER BY dc.id
        FOR UPDATE OF dc`,
    [input.organizationId],
  );
  const contactRows = await client.query<ContactRow>(
    `SELECT cp.person_id, cp.type::text, cp.normalized_value
         FROM contact_points cp
         JOIN persons p ON p.id = cp.person_id
        WHERE p.organization_id = $1
          AND p.archived_at IS NULL
          AND cp.archived_at IS NULL
        ORDER BY cp.person_id, cp.type, cp.normalized_value`,
    [input.organizationId],
  );
  const externalIdentityRows = await client.query<ExternalIdentityRow>(
    `SELECT ei.person_id, ei.source_namespace, ei.external_id
         FROM external_identities ei
         JOIN persons p ON p.id = ei.person_id
        WHERE ei.organization_id = $1
          AND ei.archived_at IS NULL
          AND p.archived_at IS NULL
        ORDER BY ei.person_id, ei.source_namespace, ei.external_id`,
    [input.organizationId],
  );

  const candidatesById = new Map(candidateRows.rows.map((candidate) => [candidate.id, candidate]));
  const snapshot: AutoDeduplicationSnapshot = {
    persons: personRows.rows.map((person) => ({
      id: person.id,
      normalizedFullName: person.normalized_full_name,
      mergedIntoPersonId: person.merged_into_person_id,
      createdAt: person.created_at.toISOString(),
      provenanceCount: Number(person.provenance_count),
    })),
    contacts: contactRows.rows.map((contact) => ({
      personId: contact.person_id,
      type: contact.type,
      normalizedValue: contact.normalized_value,
    })),
    externalIdentities: externalIdentityRows.rows.map((identity) => ({
      personId: identity.person_id,
      sourceNamespace: identity.source_namespace,
      externalId: identity.external_id,
    })),
    candidates: candidateRows.rows.map((candidate) => ({
      id: candidate.id,
      personAId: candidate.person_a_id,
      personBId: candidate.person_b_id,
      evidenceFingerprint: candidate.evidence_fingerprint,
    })),
    ...(input.newlyCreatedPersonIds === undefined
      ? {}
      : { newlyCreatedPersonIds: input.newlyCreatedPersonIds }),
  };
  const plan = buildAutoDeduplicationPlan(snapshot);

  for (const component of plan.components) {
    await applyMergeComponent(client, input, component);
  }
  await resolveMergedCandidatesWithoutOperation(
    client,
    input,
    plan.mergedWithoutOperationCandidateIds,
  );
  await resolveNotDuplicateCandidates(client, input, plan.notDuplicateCandidateIds, candidatesById);
  await resolveDismissedCandidates(client, input, plan.dismissedCandidateIds);

  const remaining = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM duplicate_candidates dc
       JOIN persons a ON a.id = dc.person_a_id
       JOIN persons b ON b.id = dc.person_b_id
      WHERE dc.status = 'OPEN'
        AND a.organization_id = $1
        AND b.organization_id = $1
        AND a.archived_at IS NULL
        AND b.archived_at IS NULL`,
    [input.organizationId],
  );

  return {
    policyVersion: AUTO_DEDUPE_POLICY_VERSION,
    candidatesExamined: candidateRows.rows.length,
    mergedCandidates: plan.mergedCandidateIds.length,
    notDuplicateCandidates: plan.notDuplicateCandidateIds.length,
    dismissedCandidates: plan.dismissedCandidateIds.length,
    mergedProfiles: plan.components.reduce(
      (total, component) => total + component.personChanges.length,
      0,
    ),
    components: plan.components.length,
    remainingOpenCandidates: Number(remaining.rows[0]?.count ?? 0),
    masterPersonIds: plan.components.map((component) => component.masterPersonId),
  };
}

async function assertPrincipals(client: PoolClient, input: AutoDeduplicationInput): Promise<void> {
  const result = await client.query<{ organization_exists: boolean; actor_exists: boolean }>(
    `SELECT
       EXISTS(SELECT 1 FROM organizations WHERE id = $1 AND archived_at IS NULL)
         AS organization_exists,
       EXISTS(SELECT 1 FROM app_users WHERE id = $2 AND archived_at IS NULL)
         AS actor_exists`,
    [input.organizationId, input.actorUserId],
  );
  if (result.rows[0]?.organization_exists !== true) {
    throw new Error('Auto-deduplication organization does not exist');
  }
  if (result.rows[0]?.actor_exists !== true) {
    throw new Error('Auto-deduplication actor does not exist');
  }
}

async function applyMergeComponent(
  client: PoolClient,
  input: AutoDeduplicationInput,
  component: AutoMergeComponentPlan,
): Promise<void> {
  const representativeCandidateId = component.mergedCandidateIds[0] ?? null;
  const operation = await client.query<{ id: string }>(
    `INSERT INTO merge_operations
       (master_person_id, duplicate_candidate_id, cluster_before, cluster_after,
        reason, operated_by_user_id)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
     RETURNING id`,
    [
      component.masterPersonId,
      representativeCandidateId,
      JSON.stringify(component.clusterBefore),
      JSON.stringify(component.clusterAfter),
      AUTO_MERGE_REASON,
      input.actorUserId,
    ],
  );
  const operationId = operation.rows[0]!.id;

  if (component.personChanges.length > 0) {
    const updated = await client.query<{ id: string }>(
      `WITH changes AS (
         SELECT *
           FROM jsonb_to_recordset($1::jsonb)
             AS x(person_id uuid, before_parent uuid)
       )
       UPDATE persons p
          SET merged_into_person_id = $2,
              updated_at = now(),
              version = version + 1
         FROM changes x
        WHERE p.id = x.person_id
          AND p.merged_into_person_id IS NOT DISTINCT FROM x.before_parent
       RETURNING p.id`,
      [
        JSON.stringify(
          component.personChanges.map((change) => ({
            person_id: change.personId,
            before_parent: change.beforeMergedIntoPersonId,
          })),
        ),
        component.masterPersonId,
      ],
    );
    if (updated.rows.length !== component.personChanges.length) {
      throw new Error('Auto-deduplication person snapshot changed while rows were locked');
    }
  }

  const operationItems: MergeOperationItemInput[] = component.personChanges.map((change) => ({
    action: 'REASSIGNED',
    entityType: 'person',
    entityId: change.personId,
    sourcePersonId: change.personId,
    targetPersonId: component.masterPersonId,
    fieldName: 'merged_into_person_id',
    before: { mergedIntoPersonId: change.beforeMergedIntoPersonId },
    after: { mergedIntoPersonId: component.masterPersonId },
  }));

  const nextSteps = await client.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE person_id = ANY($1::uuid[])
        AND status = 'OPEN'
        AND is_next_step
        AND archived_at IS NULL
      ORDER BY created_at DESC, id DESC
      FOR UPDATE`,
    [component.memberPersonIds],
  );
  const demotedTaskIds = nextSteps.rows.slice(1).map((task) => task.id);
  if (demotedTaskIds.length > 0) {
    await client.query(
      `UPDATE tasks
          SET is_next_step = false, updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [demotedTaskIds],
    );
    operationItems.push(
      ...demotedTaskIds.map((taskId) => ({
        action: 'CANONICAL_VALUE_SELECTED' as const,
        entityType: 'task' as const,
        entityId: taskId,
        sourcePersonId: null,
        targetPersonId: component.masterPersonId,
        fieldName: 'is_next_step',
        before: { isNextStep: true },
        after: { isNextStep: false },
      })),
    );
  }

  if (component.mergedCandidateIds.length > 0) {
    const resolved = await client.query(
      `UPDATE duplicate_candidates
          SET status = 'MERGED',
              decided_at = now(),
              decided_by_user_id = $2,
              decision_reason = $3,
              updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'OPEN'`,
      [component.mergedCandidateIds, input.actorUserId, AUTO_MERGE_REASON],
    );
    if ((resolved.rowCount ?? 0) !== component.mergedCandidateIds.length) {
      throw new Error('Auto-deduplication candidate snapshot changed while rows were locked');
    }
    operationItems.push(
      ...component.mergedCandidateIds.map((candidateId) => ({
        action: 'CANONICAL_VALUE_SELECTED' as const,
        entityType: 'duplicate_candidate' as const,
        entityId: candidateId,
        sourcePersonId: null,
        targetPersonId: component.masterPersonId,
        fieldName: 'status',
        before: { status: 'OPEN' },
        after: { status: 'MERGED', policyVersion: AUTO_DEDUPE_POLICY_VERSION },
      })),
    );
  }

  await insertMergeOperationItems(client, operationId, operationItems);
  await rebuildSearchDocument(client, component.masterPersonId, component.memberPersonIds);
  await writeAudit(client, input, {
    action: 'person.auto_merge',
    entityType: 'merge_operation',
    entityId: operationId,
    reason: AUTO_MERGE_REASON,
    after: {
      policyVersion: AUTO_DEDUPE_POLICY_VERSION,
      masterPersonId: component.masterPersonId,
      mergedPersonIds: component.personChanges.map((change) => change.personId),
      candidateIds: component.mergedCandidateIds,
      ...(input.importRunId === undefined ? {} : { importRunId: input.importRunId }),
    },
  });
}

async function insertMergeOperationItems(
  client: PoolClient,
  operationId: string,
  items: readonly MergeOperationItemInput[],
): Promise<void> {
  if (items.length === 0) return;
  await client.query(
    `INSERT INTO merge_operation_items
       (merge_operation_id, action, entity_type, entity_id, source_person_id,
        target_person_id, field_name, before, after)
     SELECT $1,
            x.action::merge_item_action,
            x.entity_type,
            x.entity_id,
            x.source_person_id,
            x.target_person_id,
            x.field_name,
            x.before_state,
            x.after_state
       FROM jsonb_to_recordset($2::jsonb) AS x(
         action text,
         entity_type text,
         entity_id uuid,
         source_person_id uuid,
         target_person_id uuid,
         field_name text,
         before_state jsonb,
         after_state jsonb
       )`,
    [
      operationId,
      JSON.stringify(
        items.map((item) => ({
          action: item.action,
          entity_type: item.entityType,
          entity_id: item.entityId,
          source_person_id: item.sourcePersonId,
          target_person_id: item.targetPersonId,
          field_name: item.fieldName,
          before_state: item.before,
          after_state: item.after,
        })),
      ),
    ],
  );
}

async function resolveMergedCandidatesWithoutOperation(
  client: PoolClient,
  input: AutoDeduplicationInput,
  candidateIds: readonly string[],
): Promise<void> {
  for (const candidateId of candidateIds) {
    const resolved = await client.query(
      `UPDATE duplicate_candidates
          SET status = 'MERGED', decided_at = now(), decided_by_user_id = $2,
              decision_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'`,
      [candidateId, input.actorUserId, AUTO_MERGE_REASON],
    );
    if ((resolved.rowCount ?? 0) !== 1) {
      throw new Error('Auto-deduplication candidate snapshot changed while rows were locked');
    }
    await writeAudit(client, input, {
      action: 'duplicate.auto_resolved_existing_cluster',
      entityType: 'duplicate_candidate',
      entityId: candidateId,
      reason: AUTO_MERGE_REASON,
      after: { status: 'MERGED', policyVersion: AUTO_DEDUPE_POLICY_VERSION },
    });
  }
}

async function resolveNotDuplicateCandidates(
  client: PoolClient,
  input: AutoDeduplicationInput,
  candidateIds: readonly string[],
  candidatesById: ReadonlyMap<string, CandidateRow>,
): Promise<void> {
  for (const candidateId of candidateIds) {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) throw new Error('Auto-deduplication candidate is missing');
    const resolved = await client.query(
      `UPDATE duplicate_candidates
          SET status = 'NOT_DUPLICATE', decided_at = now(), decided_by_user_id = $2,
              decision_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'`,
      [candidateId, input.actorUserId, AUTO_NOT_DUPLICATE_REASON],
    );
    if ((resolved.rowCount ?? 0) !== 1) {
      throw new Error('Auto-deduplication candidate snapshot changed while rows were locked');
    }
    await client.query(
      `INSERT INTO not_duplicate_pairs
         (person_a_id, person_b_id, evidence_fingerprint, reason, decided_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (person_a_id, person_b_id, evidence_fingerprint) DO NOTHING`,
      [
        candidate.person_a_id,
        candidate.person_b_id,
        candidate.evidence_fingerprint,
        AUTO_NOT_DUPLICATE_REASON,
        input.actorUserId,
      ],
    );
    await writeAudit(client, input, {
      action: 'duplicate.auto_not_duplicate',
      entityType: 'duplicate_candidate',
      entityId: candidateId,
      reason: AUTO_NOT_DUPLICATE_REASON,
      after: { status: 'NOT_DUPLICATE', policyVersion: AUTO_DEDUPE_POLICY_VERSION },
    });
  }
}

async function resolveDismissedCandidates(
  client: PoolClient,
  input: AutoDeduplicationInput,
  candidateIds: readonly string[],
): Promise<void> {
  for (const candidateId of candidateIds) {
    const resolved = await client.query(
      `UPDATE duplicate_candidates
          SET status = 'DISMISSED', decided_at = now(), decided_by_user_id = $2,
              decision_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'OPEN'`,
      [candidateId, input.actorUserId, AUTO_DISMISS_REASON],
    );
    if ((resolved.rowCount ?? 0) !== 1) {
      throw new Error('Auto-deduplication candidate snapshot changed while rows were locked');
    }
    await writeAudit(client, input, {
      action: 'duplicate.auto_dismissed',
      entityType: 'duplicate_candidate',
      entityId: candidateId,
      reason: AUTO_DISMISS_REASON,
      after: { status: 'DISMISSED', policyVersion: AUTO_DEDUPE_POLICY_VERSION },
    });
  }
}

async function rebuildSearchDocument(
  client: PoolClient,
  masterPersonId: string,
  memberPersonIds: readonly string[],
): Promise<void> {
  await client.query(
    `WITH search_values AS (
       SELECT master.id AS person_id,
              master.normalized_full_name AS canonical_name,
              COALESCE((
                SELECT string_agg(DISTINCT member.id::text, ' ' ORDER BY member.id::text)
                  FROM persons member
                 WHERE member.id = ANY($2::uuid[])
              ), '') AS internal_ids,
              COALESCE((
                SELECT string_agg(DISTINCT alias.normalized_value, ' ' ORDER BY alias.normalized_value)
                  FROM person_aliases alias
                 WHERE alias.person_id = ANY($2::uuid[]) AND alias.archived_at IS NULL
              ), '') AS aliases,
              COALESCE((
                SELECT string_agg(DISTINCT contact.normalized_value, ' ' ORDER BY contact.normalized_value)
                  FROM contact_points contact
                 WHERE contact.person_id = ANY($2::uuid[]) AND contact.archived_at IS NULL
              ), '') AS contacts,
              COALESCE((
                SELECT string_agg(DISTINCT organization.normalized_name, ' ' ORDER BY organization.normalized_name)
                  FROM affiliations affiliation
                  JOIN organizations organization ON organization.id = affiliation.organization_id
                 WHERE affiliation.person_id = ANY($2::uuid[])
                   AND affiliation.archived_at IS NULL
                   AND organization.archived_at IS NULL
              ), '') AS organizations,
              COALESCE((
                SELECT string_agg(DISTINCT project.normalized_name, ' ' ORDER BY project.normalized_name)
                  FROM team_memberships membership
                  JOIN project_team_links link ON link.team_id = membership.team_id
                  JOIN projects project ON project.id = link.project_id
                 WHERE membership.person_id = ANY($2::uuid[])
                   AND membership.archived_at IS NULL
                   AND membership.valid_to IS NULL
                   AND link.archived_at IS NULL
                   AND link.valid_to IS NULL
                   AND project.archived_at IS NULL
              ), '') AS projects,
              COALESCE((
                SELECT string_agg(DISTINCT artifact.title, ' ' ORDER BY artifact.title)
                  FROM artifact_version_contributors contributor
                  JOIN artifact_versions version ON version.id = contributor.artifact_version_id
                  JOIN artifacts artifact ON artifact.id = version.artifact_id
                 WHERE contributor.person_id = ANY($2::uuid[])
                   AND version.status <> 'VOIDED'
                   AND artifact.status <> 'VOIDED'
              ), '') AS artifacts
         FROM persons master
        WHERE master.id = $1
     )
     INSERT INTO person_search_documents
       (person_id, internal_ids, canonical_name, aliases, contacts, organizations,
        projects, artifacts, search_text, match_metadata, rebuilt_at)
     SELECT person_id, internal_ids, canonical_name, aliases, contacts, organizations,
            projects, artifacts,
            concat_ws(' ', canonical_name, aliases, contacts, organizations,
                           projects, artifacts, internal_ids),
            jsonb_build_object(
              'origin', $3::text,
              'memberPersonIds', to_jsonb($2::uuid[])
            ),
            now()
       FROM search_values
     ON CONFLICT (person_id) DO UPDATE
       SET internal_ids = EXCLUDED.internal_ids,
           canonical_name = EXCLUDED.canonical_name,
           aliases = EXCLUDED.aliases,
           contacts = EXCLUDED.contacts,
           organizations = EXCLUDED.organizations,
           projects = EXCLUDED.projects,
           artifacts = EXCLUDED.artifacts,
           search_text = EXCLUDED.search_text,
           match_metadata = EXCLUDED.match_metadata,
           rebuilt_at = now(),
           updated_at = now()`,
    [masterPersonId, memberPersonIds, AUTO_DEDUPE_POLICY_VERSION],
  );
}

async function writeAudit(
  client: PoolClient,
  input: AutoDeduplicationInput,
  event: {
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly reason: string;
    readonly after: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (actor_user_id, actor_subject, request_id, action, entity_type, entity_id,
        after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      input.actorUserId,
      input.actorSubject ?? null,
      input.requestId,
      event.action,
      event.entityType,
      event.entityId,
      JSON.stringify(event.after),
      event.reason,
    ],
  );
}

function normalizedNameTokens(value: string): string[] {
  return [...new Set(value.trim().split(/\s+/u).filter(Boolean))].sort();
}

function contactKey(type: string, normalizedValue: string): string {
  return `${type}\u0000${normalizedValue}`;
}

function compareCandidate(
  left: DeduplicationCandidateSnapshot,
  right: DeduplicationCandidateSnapshot,
): number {
  return (
    left.personAId.localeCompare(right.personAId) ||
    left.personBId.localeCompare(right.personBId) ||
    left.id.localeCompare(right.id)
  );
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function allPersonNamesCompatible(
  personIds: readonly string[],
  persons: ReadonlyMap<string, DeduplicationPersonSnapshot>,
): boolean {
  for (let leftIndex = 0; leftIndex < personIds.length; leftIndex += 1) {
    const left = persons.get(personIds[leftIndex]!);
    if (!left) return false;
    for (let rightIndex = leftIndex + 1; rightIndex < personIds.length; rightIndex += 1) {
      const right = persons.get(personIds[rightIndex]!);
      if (
        !right ||
        !areNormalizedFullNamesCompatible(left.normalizedFullName, right.normalizedFullName)
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasExternalIdentityConflict(
  personIds: readonly string[],
  identitiesByPerson: ReadonlyMap<string, readonly DeduplicationExternalIdentitySnapshot[]>,
): boolean {
  const idsByNamespace = new Map<string, Set<string>>();
  for (const personId of personIds) {
    for (const identity of identitiesByPerson.get(personId) ?? []) {
      addToSetMap(idsByNamespace, identity.sourceNamespace, identity.externalId);
      if (idsByNamespace.get(identity.sourceNamespace)!.size > 1) return true;
    }
  }
  return false;
}

function hasDirectExternalIdentityConflict(
  personAId: string,
  personBId: string,
  identitiesByPerson: ReadonlyMap<string, readonly DeduplicationExternalIdentitySnapshot[]>,
): boolean {
  const leftByNamespace = new Map<string, Set<string>>();
  for (const identity of identitiesByPerson.get(personAId) ?? []) {
    addToSetMap(leftByNamespace, identity.sourceNamespace, identity.externalId);
  }
  for (const identity of identitiesByPerson.get(personBId) ?? []) {
    const leftIds = leftByNamespace.get(identity.sourceNamespace);
    if (leftIds && [...leftIds].some((externalId) => externalId !== identity.externalId)) {
      return true;
    }
  }
  return false;
}

function resolveCurrentRoots(
  persons: ReadonlyMap<string, DeduplicationPersonSnapshot>,
): Map<string, string> {
  const roots = new Map<string, string>();
  for (const personId of persons.keys()) {
    if (roots.has(personId)) continue;
    const path: string[] = [];
    const seen = new Set<string>();
    let currentId = personId;
    for (;;) {
      const knownRoot = roots.get(currentId);
      if (knownRoot) {
        for (const pathId of path) roots.set(pathId, knownRoot);
        break;
      }
      if (seen.has(currentId)) throw new Error('Existing person merge graph contains a cycle');
      seen.add(currentId);
      path.push(currentId);
      const current = persons.get(currentId);
      if (!current) throw new Error('Existing person merge points outside the organization');
      if (current.mergedIntoPersonId === null) {
        for (const pathId of path) roots.set(pathId, currentId);
        break;
      }
      currentId = current.mergedIntoPersonId;
    }
  }
  return roots;
}

function chooseMasterPersonId(input: {
  readonly roots: readonly string[];
  readonly currentClusters: ReadonlyMap<string, readonly DeduplicationPersonSnapshot[]>;
  readonly persons: ReadonlyMap<string, DeduplicationPersonSnapshot>;
  readonly newlyCreated: ReadonlySet<string>;
  readonly contactCounts: ReadonlyMap<string, number>;
  readonly externalIdentityCounts: ReadonlyMap<string, number>;
}): string {
  return [...input.roots].sort((leftId, rightId) => {
    const left = masterScore(leftId, input);
    const right = masterScore(rightId, input);
    return (
      Number(left.isNew) - Number(right.isNew) ||
      right.nameTokens - left.nameTokens ||
      right.provenance - left.provenance ||
      right.externalIdentities - left.externalIdentities ||
      right.contacts - left.contacts ||
      right.clusterSize - left.clusterSize ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  })[0]!;
}

function masterScore(
  rootId: string,
  input: {
    readonly currentClusters: ReadonlyMap<string, readonly DeduplicationPersonSnapshot[]>;
    readonly persons: ReadonlyMap<string, DeduplicationPersonSnapshot>;
    readonly newlyCreated: ReadonlySet<string>;
    readonly contactCounts: ReadonlyMap<string, number>;
    readonly externalIdentityCounts: ReadonlyMap<string, number>;
  },
) {
  const root = input.persons.get(rootId)!;
  const members = input.currentClusters.get(rootId) ?? [root];
  return {
    id: rootId,
    isNew: input.newlyCreated.has(rootId),
    nameTokens: normalizedNameTokens(root.normalizedFullName).length,
    provenance: members.reduce((sum, member) => sum + (member.provenanceCount ?? 0), 0),
    externalIdentities: members.reduce(
      (sum, member) => sum + (input.externalIdentityCounts.get(member.id) ?? 0),
      0,
    ),
    contacts: members.reduce((sum, member) => sum + (input.contactCounts.get(member.id) ?? 0), 0),
    clusterSize: members.length,
    createdAt: root.createdAt,
  };
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const values = result.get(key) ?? [];
    values.push(item);
    result.set(key, values);
  }
  return result;
}

class DisjointSet {
  private readonly parents = new Map<string, string>();

  constructor(ids: Iterable<string>) {
    for (const id of ids) this.parents.set(id, id);
  }

  find(id: string): string {
    const parent = this.parents.get(id);
    if (!parent) throw new Error(`Unknown person in deduplication graph: ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }

  union(leftId: string, rightId: string): void {
    const leftRoot = this.find(leftId);
    const rightRoot = this.find(rightId);
    if (leftRoot === rightRoot) return;
    const [master, child] =
      leftRoot.localeCompare(rightRoot) <= 0 ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
    this.parents.set(child, master);
  }
}
