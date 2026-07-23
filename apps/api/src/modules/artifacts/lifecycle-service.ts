import {
  SystemClock,
  calculateLifecycle,
  type ActivityStatus,
  type ActivationState,
} from '@cpi-crm/domain';
import type { PoolClient } from 'pg';

export async function recalculatePersonLifecycle(
  client: PoolClient,
  personId: string,
  reason: 'ARTIFACT_BECAME_COUNTABLE' | 'ARTIFACT_VOIDED' | 'RECONCILIATION',
  relatedVersionId?: string,
): Promise<void> {
  const profile = await client.query<{
    id: string;
    lifecycle_data_state: 'LEGACY_INCOMPLETE' | 'COMPLETE';
    activation_state: ActivationState;
    activity_status: ActivityStatus;
    rule_set_id: string;
    rule_version: number;
    active_window_hours: number;
    inactive_after_hours: number;
  }>(
    `WITH requested_person AS (
       SELECT COALESCE(merged_into_person_id, id) AS canonical_person_id
         FROM persons
        WHERE id = $1 AND archived_at IS NULL
     )
     SELECT p.id, p.lifecycle_data_state, p.activation_state, p.activity_status,
            lrs.id AS rule_set_id, lrs.rule_version, lrs.active_window_hours, lrs.inactive_after_hours
       FROM persons p
       JOIN requested_person requested ON requested.canonical_person_id = p.id
       JOIN organization_settings os ON os.organization_id = p.organization_id
       JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
      WHERE p.archived_at IS NULL AND p.merged_into_person_id IS NULL
      FOR UPDATE OF p`,
    [personId],
  );
  const current = profile.rows[0];
  if (!current) return;
  const canonicalPersonId = current.id;
  const evidence = await client.query<{
    qualifies_for_activation: boolean;
    qualifies_for_activity: boolean;
    submitted_at: Date | null;
    recorded_at: Date | null;
  }>(
    `SELECT av.qualifies_for_activation, av.qualifies_for_activity, av.submitted_at, av.recorded_at
       FROM artifact_version_contributors avc
       JOIN artifact_versions av ON av.id = avc.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE avc.person_id IN (
        SELECT id FROM persons WHERE id = $1 OR merged_into_person_id = $1
      )
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
      clock: new SystemClock(),
      ruleSet: {
        id: current.rule_set_id,
        version: current.rule_version,
        activeWindowHours: current.active_window_hours,
        inactiveAfterHours: current.inactive_after_hours,
      },
    },
  );
  await client.query(
    `UPDATE persons SET
       activation_state = $2,
       activity_status = $3,
       activated_at = $4,
       activation_recorded_at = $5,
       last_artifact_at = $6,
       next_status_transition_at = $7,
       applied_lifecycle_rule_set_id = $8,
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
  if (current.activation_state !== calculated.activationState) {
    await insertHistory(
      client,
      canonicalPersonId,
      'ACTIVATION',
      current.activation_state,
      calculated.activationState,
      reason,
      current.rule_set_id,
      relatedVersionId,
    );
  }
  if (current.activity_status !== calculated.activityStatus) {
    await insertHistory(
      client,
      canonicalPersonId,
      'ACTIVITY',
      current.activity_status,
      calculated.activityStatus,
      reason,
      current.rule_set_id,
      relatedVersionId,
    );
  }
}

async function insertHistory(
  client: PoolClient,
  personId: string,
  dimension: 'ACTIVATION' | 'ACTIVITY',
  fromState: string,
  toState: string,
  reason: string,
  ruleSetId: string,
  versionId?: string,
) {
  await client.query(
    `INSERT INTO lifecycle_status_history
       (person_id, dimension, from_state, to_state, reason, lifecycle_rule_set_id,
        artifact_version_id, effective_at, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
    [personId, dimension, fromState, toState, reason, ruleSetId, versionId ?? null],
  );
}
