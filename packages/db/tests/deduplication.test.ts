import { describe, expect, it } from 'vitest';

import {
  areNormalizedFullNamesCompatible,
  buildAutoDeduplicationPlan,
  type AutoDeduplicationSnapshot,
  type DeduplicationCandidateSnapshot,
  type DeduplicationPersonSnapshot,
} from '../src/deduplication.js';

const FINGERPRINT = 'a'.repeat(64);

describe('AUTO_DEDUPE_V1 name compatibility', () => {
  it('ignores order and accepts a two-token subset of a fuller name', () => {
    expect(areNormalizedFullNamesCompatible('иванов иван', 'иван иванов')).toBe(true);
    expect(areNormalizedFullNamesCompatible('иван иванов', 'иванов иван иванович')).toBe(true);
  });

  it('rejects one-word and incompatible full names', () => {
    expect(areNormalizedFullNamesCompatible('иван', 'иван')).toBe(false);
    expect(areNormalizedFullNamesCompatible('иван иванов', 'иван петров')).toBe(false);
  });
});

describe('AUTO_DEDUPE_V1 planning', () => {
  it('merges a compatible component through clean contacts and resolves weak edges inside it', () => {
    const snapshot: AutoDeduplicationSnapshot = {
      persons: [
        person('p1', 'иван иванов', '2025-01-01T00:00:00.000Z'),
        person('p2', 'иван иванов иванович', '2025-01-02T00:00:00.000Z'),
        person('p3', 'иванов иван', '2025-01-03T00:00:00.000Z'),
      ],
      contacts: [
        { personId: 'p1', type: 'PHONE', normalizedValue: '+70000000001' },
        { personId: 'p2', type: 'PHONE', normalizedValue: '+70000000001' },
        { personId: 'p1', type: 'EMAIL', normalizedValue: 'one@example.test' },
        { personId: 'p3', type: 'EMAIL', normalizedValue: 'one@example.test' },
      ],
      externalIdentities: [],
      candidates: [
        candidate('c1', 'p1', 'p2'),
        candidate('c2', 'p1', 'p3'),
        candidate('c3', 'p2', 'p3'),
      ],
    };

    const plan = buildAutoDeduplicationPlan(snapshot);

    expect(plan.components).toHaveLength(1);
    expect(plan.components[0]).toMatchObject({
      masterPersonId: 'p2',
      memberPersonIds: ['p1', 'p2', 'p3'],
      mergedCandidateIds: ['c1', 'c2', 'c3'],
    });
    expect(plan.components[0]?.personChanges).toHaveLength(2);
    expect(plan.mergedCandidateIds).toEqual(['c1', 'c2', 'c3']);
    expect(plan.notDuplicateCandidateIds).toEqual([]);
    expect(plan.dismissedCandidateIds).toEqual([]);
  });

  it('marks a direct external-ID conflict as not duplicate and rejects its component', () => {
    const snapshot: AutoDeduplicationSnapshot = {
      persons: [person('p1', 'иван иванов'), person('p2', 'иван иванов иванович')],
      contacts: [
        { personId: 'p1', type: 'PHONE', normalizedValue: '+70000000001' },
        { personId: 'p2', type: 'PHONE', normalizedValue: '+70000000001' },
      ],
      externalIdentities: [
        { personId: 'p1', sourceNamespace: 'source', externalId: '1' },
        { personId: 'p2', sourceNamespace: 'source', externalId: '2' },
      ],
      candidates: [candidate('c1', 'p1', 'p2')],
    };

    const plan = buildAutoDeduplicationPlan(snapshot);

    expect(plan.components).toEqual([]);
    expect(plan.mergedCandidateIds).toEqual([]);
    expect(plan.notDuplicateCandidateIds).toEqual(['c1']);
    expect(plan.dismissedCandidateIds).toEqual([]);
  });

  it('dismisses evidence from a contact contaminated by an incompatible owner', () => {
    const snapshot: AutoDeduplicationSnapshot = {
      persons: [
        person('p1', 'иван иванов'),
        person('p2', 'иван иванов'),
        person('p3', 'петр петров'),
      ],
      contacts: ['p1', 'p2', 'p3'].map((personId) => ({
        personId,
        type: 'PHONE',
        normalizedValue: '+70000000001',
      })),
      externalIdentities: [],
      candidates: [candidate('c1', 'p1', 'p2')],
    };

    const plan = buildAutoDeduplicationPlan(snapshot);

    expect(plan.components).toEqual([]);
    expect(plan.dismissedCandidateIds).toEqual(['c1']);
  });

  it('rejects the whole transitive component when two full names are incompatible', () => {
    const snapshot: AutoDeduplicationSnapshot = {
      persons: [
        person('p1', 'иван иванов'),
        person('p2', 'иван иванов петрович'),
        person('p3', 'иван петрович'),
      ],
      contacts: [
        { personId: 'p1', type: 'PHONE', normalizedValue: '+70000000001' },
        { personId: 'p2', type: 'PHONE', normalizedValue: '+70000000001' },
        { personId: 'p2', type: 'EMAIL', normalizedValue: 'one@example.test' },
        { personId: 'p3', type: 'EMAIL', normalizedValue: 'one@example.test' },
      ],
      externalIdentities: [],
      candidates: [candidate('c1', 'p1', 'p2'), candidate('c2', 'p2', 'p3')],
    };

    const plan = buildAutoDeduplicationPlan(snapshot);

    expect(plan.components).toEqual([]);
    expect(plan.mergedCandidateIds).toEqual([]);
    expect(plan.dismissedCandidateIds).toEqual(['c1', 'c2']);
  });

  it('is deterministic regardless of snapshot row order and prefers an existing master', () => {
    const snapshot: AutoDeduplicationSnapshot = {
      persons: [
        person('p1', 'иван иванов', '2025-01-01T00:00:00.000Z'),
        person('p2', 'иван иванов иванович', '2025-01-02T00:00:00.000Z'),
      ],
      contacts: [
        { personId: 'p1', type: 'PHONE', normalizedValue: '+70000000001' },
        { personId: 'p2', type: 'PHONE', normalizedValue: '+70000000001' },
      ],
      externalIdentities: [],
      candidates: [candidate('c1', 'p1', 'p2')],
      newlyCreatedPersonIds: ['p2'],
    };
    const reversed: AutoDeduplicationSnapshot = {
      persons: [...snapshot.persons].reverse(),
      contacts: [...snapshot.contacts].reverse(),
      externalIdentities: [],
      candidates: [...snapshot.candidates].reverse(),
      newlyCreatedPersonIds: ['p2'],
    };

    const expected = buildAutoDeduplicationPlan(snapshot);
    expect(buildAutoDeduplicationPlan(reversed)).toEqual(expected);
    expect(expected.components[0]?.masterPersonId).toBe('p1');
  });
});

function person(
  id: string,
  normalizedFullName: string,
  createdAt = '2025-01-01T00:00:00.000Z',
): DeduplicationPersonSnapshot {
  return {
    id,
    normalizedFullName,
    mergedIntoPersonId: null,
    createdAt,
    provenanceCount: 1,
  };
}

function candidate(
  id: string,
  personAId: string,
  personBId: string,
): DeduplicationCandidateSnapshot {
  return { id, personAId, personBId, evidenceFingerprint: FINGERPRINT };
}
