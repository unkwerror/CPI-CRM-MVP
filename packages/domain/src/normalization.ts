export interface TelegramContactInput {
  readonly raw: string;
  readonly stableId?: string | number | bigint | null;
}

export interface NormalizedTelegramContact {
  /** Kept verbatim for contact_points.raw_value. */
  readonly raw: string;
  readonly username: string | null;
  /** Stable messenger identity is deliberately not inferred from the username. */
  readonly stableId: string | null;
}

export interface NormalizedPhone {
  readonly e164: string;
  readonly digits: string;
  /** Present for +7 numbers and intended for the Russian last-10-digits index. */
  readonly russianNationalDigits: string | null;
  readonly searchKeys: readonly string[];
}

export function normalizeUnicode(value: string): string {
  return value.normalize('NFKC');
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Search representation: NFKC, lowercase, collapsed whitespace, and ё → е. */
export function normalizeFullName(value: string): string {
  return collapseWhitespace(normalizeUnicode(value)).toLowerCase().replaceAll('ё', 'е');
}

/** NFKC + trim + lowercase. Dots and +tags are intentionally preserved. */
export function normalizeEmail(value: string): string {
  return normalizeUnicode(value).trim().toLowerCase();
}

/**
 * Converts common Russian forms to E.164 and accepts already international
 * +numbers. It returns null instead of inventing a country for ambiguous input.
 */
export function normalizePhone(value: string): NormalizedPhone | null {
  let candidate = normalizeUnicode(value).trim();
  // Excel commonly stores Russian phones as a formula-like `=+7913...` string.
  candidate = candidate.replace(/^=\s*/u, '');
  if (candidate.startsWith('00')) {
    candidate = `+${candidate.slice(2)}`;
  }

  if (!/^\+?[\d\s().-]+$/u.test(candidate)) {
    return null;
  }
  const hasInternationalPrefix = candidate.startsWith('+');
  const digits = candidate.replace(/\D/gu, '');
  let e164: string;

  if (hasInternationalPrefix) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+7${digits}`;
  } else if (digits.length === 11 && digits.startsWith('8')) {
    e164 = `+7${digits.slice(1)}`;
  } else if (digits.length === 11 && digits.startsWith('7')) {
    e164 = `+${digits}`;
  } else {
    return null;
  }

  if (!/^\+[1-9]\d{7,14}$/u.test(e164)) {
    return null;
  }

  const normalizedDigits = e164.slice(1);
  const russianNationalDigits =
    normalizedDigits.length === 11 && normalizedDigits.startsWith('7')
      ? normalizedDigits.slice(1)
      : null;
  const searchKeys = Object.freeze(
    russianNationalDigits === null ? [e164] : [e164, russianNationalDigits],
  );

  return Object.freeze({
    e164,
    digits: normalizedDigits,
    russianNationalDigits,
    searchKeys,
  });
}

export function normalizeTelegramUsername(value: string): string | null {
  let candidate = normalizeUnicode(value).trim();
  if (candidate.length === 0) {
    return null;
  }

  candidate = candidate.replace(/^@+/u, '');
  const urlCandidate = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//iu;
  if (urlCandidate.test(candidate)) {
    const withScheme = /^https?:\/\//iu.test(candidate) ? candidate : `https://${candidate}`;
    try {
      const parsed = new URL(withScheme);
      candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    } catch {
      return null;
    }
  } else {
    candidate = candidate.split(/[?#]/u, 1)[0] ?? '';
  }

  candidate = candidate.replace(/^@+/u, '').replace(/\/+$/u, '').toLowerCase();
  return /^[a-z0-9_]{1,64}$/u.test(candidate) ? candidate : null;
}

export function normalizeTelegramContact(input: TelegramContactInput): NormalizedTelegramContact {
  const stableId =
    input.stableId === undefined || input.stableId === null
      ? null
      : normalizeUnicode(String(input.stableId)).trim() || null;

  return Object.freeze({
    raw: input.raw,
    username: normalizeTelegramUsername(input.raw),
    stableId,
  });
}
