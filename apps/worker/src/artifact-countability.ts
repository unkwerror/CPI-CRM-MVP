import { createContentFingerprint } from '@cpi-crm/domain';
import type { PoolClient } from 'pg';

import {
  countabilityReasons,
  evaluateVersionCountability,
  type CountabilityDecision,
  type FileStatus,
} from './countability.js';
import { recalculateVersionAuthors } from './lifecycle.js';

interface VersionRow {
  id: string;
  artifact_id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'VOIDED';
  artifact_status: 'ACTIVE' | 'ARCHIVED' | 'VOIDED';
  text_content: string | null;
  submitted_at: Date | null;
  qualifies_for_activation: boolean;
  qualifies_for_activity: boolean;
}

interface AssetRow {
  asset_type: 'FILE' | 'EXTERNAL_URL';
  external_url: string | null;
  file_status: FileStatus | null;
  file_sha256: string | null;
}

export interface CountabilityUpdateResult {
  readonly found: boolean;
  readonly becameCountable: boolean;
  readonly qualifiesForActivation: boolean;
  readonly qualifiesForActivity: boolean;
}

/**
 * Re-evaluates one immutable version while holding its row lock. Redelivery cannot
 * emit a second became-countable event because the false -> true edge is persisted
 * in the same transaction as the event.
 */
export async function reevaluateArtifactVersion(
  client: PoolClient,
  versionId: string,
  now = new Date(),
): Promise<CountabilityUpdateResult> {
  const versionResult = await client.query<VersionRow>(
    `SELECT av.id, av.artifact_id, av.status, a.status AS artifact_status,
            av.text_content, av.submitted_at, av.qualifies_for_activation,
            av.qualifies_for_activity
       FROM artifact_versions av
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE av.id = $1
      FOR UPDATE OF av`,
    [versionId],
  );
  const version = versionResult.rows[0];
  if (!version) {
    return {
      found: false,
      becameCountable: false,
      qualifiesForActivation: false,
      qualifiesForActivity: false,
    };
  }

  const [authorResult, assetResult] = await Promise.all([
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM artifact_version_contributors
        WHERE artifact_version_id = $1 AND contribution_role = 'AUTHOR'`,
      [versionId],
    ),
    client.query<AssetRow>(
      `SELECT aa.asset_type, aa.external_url, fo.status AS file_status,
              fo.sha256 AS file_sha256
         FROM artifact_assets aa
         LEFT JOIN file_objects fo ON fo.id = aa.file_object_id
        WHERE aa.artifact_version_id = $1
        ORDER BY aa.display_order`,
      [versionId],
    ),
  ]);
  let decision: CountabilityDecision = evaluateVersionCountability({
    versionStatus: version.status,
    artifactStatus: version.artifact_status,
    textContent: version.text_content,
    submittedAt: version.submitted_at,
    authorCount: authorResult.rows[0]?.count ?? 0,
    assets: assetResult.rows.map((asset) => ({
      assetType: asset.asset_type,
      externalUrl: asset.external_url,
      fileStatus: asset.file_status,
      fileSha256: asset.file_sha256,
    })),
  });

  let fingerprint: string | null = null;
  let duplicateVersionId: string | null = null;
  if (decision.qualifiesForActivation) {
    fingerprint = createContentFingerprint({
      text: version.text_content,
      urls: decision.externalUrls,
      fileSha256s: decision.fileSha256s,
    });
    const duplicate = await client.query<{ id: string }>(
      `SELECT id
         FROM artifact_versions
        WHERE artifact_id = $1 AND id <> $2 AND content_fingerprint = $3
          AND status <> 'VOIDED'
        LIMIT 1`,
      [version.artifact_id, versionId, fingerprint],
    );
    duplicateVersionId = duplicate.rows[0]?.id ?? null;
    if (duplicateVersionId) {
      decision = {
        ...decision,
        qualifiesForActivation: false,
        qualifiesForActivity: false,
        blockers: [...decision.blockers, 'DUPLICATE_CONTENT'],
      };
      fingerprint = null;
    }
  }

  const reasons = {
    ...countabilityReasons(decision),
    ...(duplicateVersionId ? { duplicateVersionId } : {}),
  };
  await client.query(
    `UPDATE artifact_versions
        SET qualifies_for_activation = $2, qualifies_for_activity = $3,
            content_fingerprint = COALESCE($4, content_fingerprint),
            countability_reasons = $5::jsonb, updated_at = now()
      WHERE id = $1`,
    [
      versionId,
      decision.qualifiesForActivation,
      decision.qualifiesForActivity,
      fingerprint,
      JSON.stringify(reasons),
    ],
  );

  const becameCountable = !version.qualifies_for_activation && decision.qualifiesForActivation;
  const qualificationsChanged =
    version.qualifies_for_activation !== decision.qualifiesForActivation ||
    version.qualifies_for_activity !== decision.qualifiesForActivity;
  if (becameCountable) {
    await client.query(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('artifact_version_became_countable', 'artifact_version', $1, $2::jsonb)`,
      [
        versionId,
        JSON.stringify({
          versionId,
          submittedAt: version.submitted_at?.toISOString() ?? null,
          detectedAt: now.toISOString(),
        }),
      ],
    );
  }
  if (qualificationsChanged) {
    await recalculateVersionAuthors(
      client,
      versionId,
      becameCountable ? 'ARTIFACT_BECAME_COUNTABLE' : 'RECONCILIATION',
      now,
    );
  }

  return {
    found: true,
    becameCountable,
    qualifiesForActivation: decision.qualifiesForActivation,
    qualifiesForActivity: decision.qualifiesForActivity,
  };
}

export async function reevaluateVersionsUsingFile(
  client: PoolClient,
  fileObjectId: string,
  now = new Date(),
): Promise<number> {
  const versions = await client.query<{ artifact_version_id: string }>(
    `SELECT DISTINCT aa.artifact_version_id
       FROM artifact_assets aa
       JOIN artifact_versions av ON av.id = aa.artifact_version_id
      WHERE aa.file_object_id = $1 AND av.status = 'SUBMITTED'
      ORDER BY aa.artifact_version_id`,
    [fileObjectId],
  );
  for (const version of versions.rows) {
    await reevaluateArtifactVersion(client, version.artifact_version_id, now);
  }
  return versions.rows.length;
}
