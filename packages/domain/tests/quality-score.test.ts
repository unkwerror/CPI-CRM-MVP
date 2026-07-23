import { describe, expect, it } from 'vitest';

import {
  QualityScoreValidationError,
  isQualityScore,
  parseNullableQualityScore,
  parseQualityScore,
} from '../src/quality-score.js';

describe('quality score', () => {
  it.each([1, 2, 5, 9, 10])('accepts integer score %s', (score) => {
    expect(isQualityScore(score)).toBe(true);
    expect(parseQualityScore(score)).toBe(score);
  });

  it.each([0, 11, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '7', null])(
    'rejects invalid score %s',
    (score) => {
      expect(isQualityScore(score)).toBe(false);
      expect(() => parseQualityScore(score)).toThrow(QualityScoreValidationError);
    },
  );

  it('uses null, never zero, for an absent score', () => {
    expect(parseNullableQualityScore(null)).toBeNull();
    expect(() => parseNullableQualityScore(0)).toThrow(QualityScoreValidationError);
  });
});
