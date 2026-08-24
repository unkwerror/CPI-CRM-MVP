declare const qualityScoreBrand: unique symbol;

export type QualityScore = number & {
  readonly [qualityScoreBrand]: 'QualityScore';
};

export class QualityScoreValidationError extends TypeError {
  public readonly code = 'INVALID_QUALITY_SCORE';

  public constructor(value: unknown) {
    super(`Quality score must be an integer from 1 to 10; received ${String(value)}`);
    this.name = 'QualityScoreValidationError';
  }
}

/** Балл артефакта — субъективная целая оценка 1–10; отсутствие оценки — null. */
export function isQualityScore(value: unknown): value is QualityScore {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
}

export function parseQualityScore(value: unknown): QualityScore {
  if (!isQualityScore(value)) {
    throw new QualityScoreValidationError(value);
  }
  return value;
}

/** Отсутствие оценки представляется только через null. */
export function parseNullableQualityScore(value: unknown): QualityScore | null {
  return value === null ? null : parseQualityScore(value);
}
