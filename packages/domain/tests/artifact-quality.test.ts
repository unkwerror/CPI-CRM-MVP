import { describe, expect, it } from 'vitest';

import {
  ArtifactCriteriaValidationError,
  computeArtifactScore,
  isQualityArtifact,
  parseArtifactCriteria,
} from '../src/artifact-quality.js';

const fullCriteria = {
  relevance: 2,
  completeness: 2,
  verifiability: 2,
  applicability: 2,
  timeliness: 2,
} as const;

describe('parseArtifactCriteria', () => {
  it('accepts a complete rubric with values 0..2', () => {
    expect(parseArtifactCriteria({ ...fullCriteria, completeness: 0 })).toEqual({
      ...fullCriteria,
      completeness: 0,
    });
  });

  it('rejects missing criteria, out-of-range and unknown keys', () => {
    expect(() => parseArtifactCriteria({ relevance: 2 })).toThrow(ArtifactCriteriaValidationError);
    expect(() => parseArtifactCriteria({ ...fullCriteria, relevance: 3 })).toThrow(
      ArtifactCriteriaValidationError,
    );
    expect(() => parseArtifactCriteria({ ...fullCriteria, extra: 1 })).toThrow(
      ArtifactCriteriaValidationError,
    );
    expect(() => parseArtifactCriteria(null)).toThrow(ArtifactCriteriaValidationError);
  });
});

describe('computeArtifactScore', () => {
  it('sums five legacy criteria into Q_artifact', () => {
    expect(computeArtifactScore(fullCriteria)).toBe(10);
    expect(computeArtifactScore({ ...fullCriteria, relevance: 0, timeliness: 1 })).toBe(7);
  });
});

describe('isQualityArtifact', () => {
  it('treats an accepted artifact as quality regardless of score', () => {
    expect(isQualityArtifact('ACCEPTED')).toBe(true);
  });

  it('treats anything but acceptance as not quality', () => {
    expect(isQualityArtifact('REJECTED')).toBe(false);
    expect(isQualityArtifact('NEEDS_REVISION')).toBe(false);
    expect(isQualityArtifact(null)).toBe(false);
    expect(isQualityArtifact(undefined)).toBe(false);
  });
});
