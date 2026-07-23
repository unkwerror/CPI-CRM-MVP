import {
  FixedClock,
  calculateLifecycle,
  type ActivationState,
  type ActivityStatus,
} from '@cpi-crm/domain';
import type { PoolClient } from 'pg';

export type LifecycleReason =
  | 'ARTIFACT_BECAME_COUNTABLE'
  | 'ARTIFACT_VOIDED'
  | 'TIME_WINDOW_ELAPSED'
  | 'RULE_SET_CHANGED'
  | 'LEGACY_STATE_RESOLVED'
  | 'RECONCILIATION';

interface PersonLifecycleRow {
  id: string;
  lifecycle_data_state: 'LEGACY_INCOMPLETE' | 'COMPLETE';
  activation_state: ActivationState;
  activity_status: ActivityStatus;
  next_status_transition_at: Date | null;
  applied_lifecycle_rule_set_id: string | null;
  rule_set_id: string;
  rule_version: number;
  active_window_hours: number;
  inactive_after_hours: number;
}

interface EvidenceRow {
  qualifies_for_activation: boolean;
  qualifies_for_activity: boolean;
  submitted_at: Date | null;
  recorded_at: Date | null;
}

export interface LifecycleRecalculationResult {
  readonly found: boolean;
  readonly changed: boolean;
}

export interface PlannedActivityTransition {
  readonly fromState: ActivityStatus;
  readonly toState: ActivityStatus;
  readonly effectiveAt: Date;
  readonly recoveredBoundary: boolean;
}

export interface ActivityTransitionPlanInput {
  readonly fromState: ActivityStatus;
  readonly toState: ActivityStatus;
  readonly calculatedAt: Date;
  readonly lastArtifactAt: Date | null;
  readonly activeWindowHours: number;
  readonly inactiveAfterHours: number;
  readonly recoverElapsedBoundaries: boolean;
}

const HOUR_IN_MILLISECONDS = 60 * 60 * 1_000;

/**
 * Reconstructs only elapsed time-window transitions. Other lifecycle changes
 * remain a direct transition at detection time because voids, new evidence and
 * rule changes must not rewrite the historical state under old assumptions.
 */
export function planActivityTransitions(
  input: ActivityTransitionPlanInput,
): readonly PlannedActivityTransition[] {
  if (input.fromState === input.toState) return [];

  const direct = (): readonly PlannedActivityTransition[] => [
    {
      fromState: input.fromState,
      toState: input.toState,
      effectiveAt: new Date(input.calculatedAt.getTime()),
      recoveredBoundary: false,
    },
  ];
  if (!input.recoverElapsedBoundaries || input.lastArtifactAt === null) return direct();

  const activeBoundary = addHours(input.lastArtifactAt, input.activeWindowHours);
  const inactiveBoundary = addHours(input.lastArtifactAt, input.inactiveAfterHours);

  if (input.fromState === 'ACTIVE' && input.toState === 'MEDIUM') {
    return [
      {
        fromState: 'ACTIVE',
        toState: 'MEDIUM',
        effectiveAt: activeBoundary,
        recoveredBoundary: true,
      },
    ];
  }
  if (input.fromState === 'ACTIVE' && input.toState === 'INACTIVE') {
    return [
      {
        fromState: 'ACTIVE',
        toState: 'MEDIUM',
        effectiveAt: activeBoundary,
        recoveredBoundary: true,
      },
      {
        fromState: 'MEDIUM',
        toState: 'INACTIVE',
        effectiveAt: inactiveBoundary,
        recoveredBoundary: true,
      },
    ];
  }
  if (input.fromState === 'MEDIUM' && input.toState === 'INACTIVE') {
    return [
      {
        fromState: 'MEDIUM',
        toState: 'INACTIVE',
        effectiveAt: inactiveBoundary,
        recoveredBoundary: true,
      },
    ];
  }
  return direct();
}

/** Must run inside a transaction. The person row lock makes redelivery idempotent. */
export async function recalculatePersonLifecycle(
  client: PoolClient,
  personId: string,
  requestedReason: LifecycleReason,
  relatedVersionId: string | null = null,
  now = new Date(),
): Promise<LifecycleRecalculationResult> {
  const profile = await client.query<PersonLifecycleRow>(
    `WITH requested_person AS (
       SELECT COALESCE(merged_into_person_id, id) AS canonical_person_id
         FROM persons
        WHERE id = $1 AND archived_at IS NULL
     )
     SELECT p.id, p.lifecycle_data_state, p.activation_state, p.activity_status,
            p.next_status_transition_at, p.applied_lifecycle_rule_set_id,
            lrs.id AS rule_set_id, lrs.rule_version,
            lrs.active_window_hours, lrs.inactive_after_hours
       FROM persons p
       JOIN requested_person requested ON requested.canonical_person_id = p.id
       JOIN organization_settings os ON os.organization_id = p.organization_id
       JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
      WHERE p.archived_at IS NULL AND p.merged_into_person_id IS NULL
      FOR UPDATE OF p`,
    [personId],
  );
  const current = profile.rows[0];
  if (!current) return { found: false, changed: false };
  const canonicalPersonId = current.id;

  const evidence = await client.query<EvidenceRow>(
    `SELECT av.qualifies_for_activation, av.qualifies_for_activity,
            av.submitted_at, av.recorded_at
       FROM artifact_version_contributors avc
       JOIN persons contributor ON contributor.id = avc.person_id
       JOIN artifact_versions av ON av.id = avc.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE (contributor.id = $1 OR contributor.merged_into_person_id = $1)
        AND contributor.archived_at IS NULL
        AND avc.contribution_role = 'AUTHOR'
        AND av.status = 'SUBMITTED'
        AND a.status <> 'VOIDED'`,
    [canonicalPersonId],
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
      canonicalPersonId,
      calculated.activationState,
      calculated.activityStatus,
      calculated.activatedAt,
      calculated.activationRecordedAt,
      calculated.lastArtifactAt,
      calculated.nextStatusTransitionAt,
      current.rule_set_id,
    ],
  );

  const reason =
    current.applied_lifecycle_rule_set_id !== null &&
    current.applied_lifecycle_rule_set_id !== current.rule_set_id
      ? 'RULE_SET_CHANGED'
      : requestedReason;
  let changed = false;
  if (current.activation_state !== calculated.activationState) {
    changed = true;
    await insertTransition(client, {
      personId: canonicalPersonId,
      dimension: 'ACTIVATION',
      fromState: current.activation_state,
      toState: calculated.activationState,
      reason,
      ruleSetId: current.rule_set_id,
      ruleSetVersion: current.rule_version,
      relatedVersionId,
      effectiveAt: calculated.calculatedAt,
      priorBoundary: current.next_status_transition_at,
    });
  }
  const recoverElapsedBoundaries =
    current.applied_lifecycle_rule_set_id === current.rule_set_id &&
    (reason === 'TIME_WINDOW_ELAPSED' || reason === 'RECONCILIATION');
  const activityTransitions = planActivityTransitions({
    fromState: current.activity_status,
    toState: calculated.activityStatus,
    calculatedAt: calculated.calculatedAt,
    lastArtifactAt: calculated.lastArtifactAt,
    activeWindowHours: current.active_window_hours,
    inactiveAfterHours: current.inactive_after_hours,
    recoverElapsedBoundaries,
  });
  if (activityTransitions.length > 0) {
    changed = true;
    for (const transition of activityTransitions) {
      await insertTransition(client, {
        personId: canonicalPersonId,
        dimension: 'ACTIVITY',
        fromState: transition.fromState,
        toState: transition.toState,
        reason,
        ruleSetId: current.rule_set_id,
        ruleSetVersion: current.rule_version,
        relatedVersionId,
        effectiveAt: transition.effectiveAt,
        priorBoundary: transition.recoveredBoundary
          ? transition.effectiveAt
          : current.next_status_transition_at,
        recoveredBoundary: transition.recoveredBoundary,
      });
    }
  }
  return { found: true, changed };
}

export async function recalculateVersionAuthors(
  client: PoolClient,
  versionId: string,
  reason: LifecycleReason,
  now = new Date(),
): Promise<number> {
  const authors = await client.query<{ person_id: string }>(
    `SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
       FROM artifact_version_contributors contributor
       JOIN persons person ON person.id = contributor.person_id
      WHERE contributor.artifact_version_id = $1
        AND contributor.contribution_role = 'AUTHOR'
        AND person.archived_at IS NULL
      ORDER BY person_id`,
    [versionId],
  );
  for (const author of authors.rows) {
    await recalculatePersonLifecycle(client, author.person_id, reason, versionId, now);
  }
  return authors.rows.length;
}

interface TransitionInput {
  readonly personId: string;
  readonly dimension: 'ACTIVATION' | 'ACTIVITY';
  readonly fromState: string;
  readonly toState: string;
  readonly reason: LifecycleReason;
  readonly ruleSetId: string;
  readonly ruleSetVersion: number;
  readonly relatedVersionId: string | null;
  readonly effectiveAt: Date;
  readonly priorBoundary: Date | null;
  readonly recoveredBoundary?: boolean;
}

async function insertTransition(client: PoolClient, input: TransitionInput): Promise<void> {
  const metadata = {
    ruleSetVersion: input.ruleSetVersion,
    ...(input.priorBoundary ? { scheduledBoundary: input.priorBoundary.toISOString() } : {}),
    ...(input.recoveredBoundary ? { recoveredMissedBoundary: true } : {}),
  };
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO lifecycle_status_history
       (person_id, dimension, from_state, to_state, reason, lifecycle_rule_set_id,
        artifact_version_id, effective_at, detected_at, metadata)
     SELECT $1, $2::lifecycle_dimension, $3, $4, $5::lifecycle_transition_reason,
            $6::uuid, $7::uuid, $8::timestamptz, now(), $9::jsonb
      WHERE NOT EXISTS (
        SELECT 1
          FROM lifecycle_status_history existing
         WHERE existing.person_id = $1
           AND existing.dimension = $2::lifecycle_dimension
           AND existing.from_state IS NOT DISTINCT FROM $3::text
           AND existing.to_state = $4
           AND existing.lifecycle_rule_set_id IS NOT DISTINCT FROM $6::uuid
           AND existing.artifact_version_id IS NOT DISTINCT FROM $7::uuid
           AND existing.effective_at = $8::timestamptz
      )
     RETURNING id`,
    [
      input.personId,
      input.dimension,
      input.fromState,
      input.toState,
      input.reason,
      input.ruleSetId,
      input.relatedVersionId,
      input.effectiveAt,
      JSON.stringify(metadata),
    ],
  );
  if (!inserted.rows[0]) return;
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

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * HOUR_IN_MILLISECONDS);
}
