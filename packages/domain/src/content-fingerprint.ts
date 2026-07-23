import { createHash } from 'node:crypto';

export const CONTENT_FINGERPRINT_ALGORITHM = 'sha256:cpi-artifact-content:v1' as const;

export interface ContentFingerprintInput {
  readonly text?: string | null;
  readonly urls?: readonly string[];
  /** Lower/upper-case hexadecimal SHA-256 values of attached files. */
  readonly fileSha256s?: readonly string[];
}

export class ContentFingerprintValidationError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = 'ContentFingerprintValidationError';
  }
}

/** NFKC, normalized line endings and collapsed Unicode whitespace; case is preserved. */
export function normalizeFingerprintText(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
}

export function normalizeExternalUrl(value: string): string {
  const candidate = value.normalize('NFKC').trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ContentFingerprintValidationError(`External URL is invalid: ${candidate}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ContentFingerprintValidationError('External URL must use http or https');
  }
  return parsed.href;
}

/**
 * Generates the server-owned fingerprint from canonical text, lexically sorted
 * canonical URLs, and sorted file hashes. Array order therefore cannot create a
 * false "new version".
 */
export function createContentFingerprint(input: ContentFingerprintInput): string {
  const normalizedText =
    input.text === undefined || input.text === null
      ? null
      : normalizeFingerprintText(input.text) || null;
  const normalizedUrls = [...(input.urls ?? [])].map(normalizeExternalUrl).sort(compareCodeUnits);
  const normalizedFileHashes = [...(input.fileSha256s ?? [])]
    .map((hash, index) => normalizeFileHash(hash, index))
    .sort(compareCodeUnits);

  const canonicalPayload = JSON.stringify({
    algorithm: CONTENT_FINGERPRINT_ALGORITHM,
    text: normalizedText,
    urls: normalizedUrls,
    fileSha256s: normalizedFileHashes,
  });

  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

function normalizeFileHash(hash: string, index: number): string {
  const normalized = hash.normalize('NFKC').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ContentFingerprintValidationError(
      `fileSha256s[${index}] must be a 64-character hexadecimal SHA-256`,
    );
  }
  return normalized;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
