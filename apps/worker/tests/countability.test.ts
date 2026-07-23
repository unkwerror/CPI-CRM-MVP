import { describe, expect, it } from 'vitest';

import { evaluateVersionCountability } from '../src/countability.js';

const sha = 'a'.repeat(64);

describe('evaluateVersionCountability', () => {
  it('counts a submitted version only after every required file is available', () => {
    const decision = evaluateVersionCountability({
      versionStatus: 'SUBMITTED',
      artifactStatus: 'ACTIVE',
      textContent: 'Описание',
      submittedAt: new Date('2026-07-22T10:00:00.000Z'),
      authorCount: 2,
      assets: [
        {
          assetType: 'FILE',
          externalUrl: null,
          fileStatus: 'AVAILABLE',
          fileSha256: sha,
        },
        {
          assetType: 'EXTERNAL_URL',
          externalUrl: 'https://example.test/result',
          fileStatus: null,
          fileSha256: null,
        },
      ],
    });

    expect(decision.qualifiesForActivation).toBe(true);
    expect(decision.qualifiesForActivity).toBe(true);
    expect(decision.fileSha256s).toEqual([sha]);
  });

  it('blocks the whole mixed version while one file is scanning', () => {
    const decision = evaluateVersionCountability({
      versionStatus: 'SUBMITTED',
      artifactStatus: 'ACTIVE',
      textContent: 'Текст сам по себе есть',
      submittedAt: new Date('2026-07-22T10:00:00.000Z'),
      authorCount: 1,
      assets: [
        {
          assetType: 'FILE',
          externalUrl: null,
          fileStatus: 'SCANNING',
          fileSha256: null,
        },
      ],
    });

    expect(decision.qualifiesForActivation).toBe(false);
    expect(decision.blockers).toContain('FILE_SCAN_PENDING');
  });

  it('never activates on a rejected file', () => {
    const decision = evaluateVersionCountability({
      versionStatus: 'SUBMITTED',
      artifactStatus: 'ACTIVE',
      textContent: null,
      submittedAt: new Date('2026-07-22T10:00:00.000Z'),
      authorCount: 1,
      assets: [
        {
          assetType: 'FILE',
          externalUrl: null,
          fileStatus: 'REJECTED',
          fileSha256: sha,
        },
      ],
    });

    expect(decision.qualifiesForActivation).toBe(false);
    expect(decision.qualifiesForActivity).toBe(false);
    expect(decision.blockers).toContain('FILE_REJECTED');
  });

  it('allows legacy activation without inventing a dated activity fact', () => {
    const decision = evaluateVersionCountability({
      versionStatus: 'SUBMITTED',
      artifactStatus: 'ACTIVE',
      textContent: 'Историческое доказательство',
      submittedAt: null,
      authorCount: 1,
      assets: [],
    });

    expect(decision.qualifiesForActivation).toBe(true);
    expect(decision.qualifiesForActivity).toBe(false);
  });
});
