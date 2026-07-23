export type FileStatus = 'PENDING' | 'SCANNING' | 'AVAILABLE' | 'REJECTED' | 'QUARANTINED';

export interface VersionAssetState {
  readonly assetType: 'FILE' | 'EXTERNAL_URL';
  readonly externalUrl: string | null;
  readonly fileStatus: FileStatus | null;
  readonly fileSha256: string | null;
}

export interface VersionCountabilityInput {
  readonly versionStatus: 'DRAFT' | 'SUBMITTED' | 'VOIDED';
  readonly artifactStatus: 'ACTIVE' | 'ARCHIVED' | 'VOIDED';
  readonly textContent: string | null;
  readonly submittedAt: Date | null;
  readonly authorCount: number;
  readonly assets: readonly VersionAssetState[];
}

export type CountabilityBlocker =
  | 'VERSION_NOT_SUBMITTED'
  | 'ARTIFACT_VOIDED'
  | 'AUTHOR_MISSING'
  | 'CONTENT_MISSING'
  | 'FILE_SCAN_PENDING'
  | 'FILE_REJECTED'
  | 'FILE_QUARANTINED'
  | 'FILE_HASH_MISSING'
  | 'DUPLICATE_CONTENT';

export interface CountabilityDecision {
  readonly qualifiesForActivation: boolean;
  readonly qualifiesForActivity: boolean;
  readonly blockers: readonly CountabilityBlocker[];
  readonly externalUrls: readonly string[];
  readonly fileSha256s: readonly string[];
}

/** Pure server-side decision; no client-provided countability flag is accepted. */
export function evaluateVersionCountability(input: VersionCountabilityInput): CountabilityDecision {
  const blockers = new Set<CountabilityBlocker>();
  if (input.versionStatus !== 'SUBMITTED') blockers.add('VERSION_NOT_SUBMITTED');
  if (input.artifactStatus === 'VOIDED') blockers.add('ARTIFACT_VOIDED');
  if (input.authorCount < 1) blockers.add('AUTHOR_MISSING');

  const externalUrls: string[] = [];
  const fileSha256s: string[] = [];
  let fileCount = 0;
  for (const asset of input.assets) {
    if (asset.assetType === 'EXTERNAL_URL') {
      if (asset.externalUrl) externalUrls.push(asset.externalUrl);
      continue;
    }

    fileCount += 1;
    switch (asset.fileStatus) {
      case 'AVAILABLE':
        if (asset.fileSha256) fileSha256s.push(asset.fileSha256);
        else blockers.add('FILE_HASH_MISSING');
        break;
      case 'REJECTED':
        blockers.add('FILE_REJECTED');
        break;
      case 'QUARANTINED':
        blockers.add('FILE_QUARANTINED');
        break;
      case 'PENDING':
      case 'SCANNING':
      case null:
        blockers.add('FILE_SCAN_PENDING');
        break;
    }
  }

  const hasContent = Boolean(input.textContent?.trim()) || externalUrls.length > 0 || fileCount > 0;
  if (!hasContent) blockers.add('CONTENT_MISSING');

  const qualifiesForActivation = blockers.size === 0;
  return {
    qualifiesForActivation,
    qualifiesForActivity: qualifiesForActivation && input.submittedAt !== null,
    blockers: [...blockers],
    externalUrls,
    fileSha256s,
  };
}

export function countabilityReasons(decision: CountabilityDecision): Record<string, unknown> {
  if (!decision.qualifiesForActivation) return { blockers: decision.blockers };
  if (!decision.qualifiesForActivity) {
    return {
      countableForActivation: true,
      countableForActivity: false,
      pending: 'SUBMITTED_AT_UNKNOWN',
    };
  }
  return { countableForActivation: true, countableForActivity: true };
}
