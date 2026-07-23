import { describe, expect, it } from 'vitest';

import {
  ActivationState,
  ActivityStatus,
  DataOrigin,
  DEFAULT_LIFECYCLE_RULE_SET,
  FixedClock,
  LifecycleDataState,
  LifecycleInvariantError,
  assertSubmittedAtIsNotFuture,
  calculateLifecycle,
  establishInitialLifecycleDataState,
} from '../src/lifecycle.js';

const submittedAt = new Date('2026-07-01T00:00:00.000Z');

function lifecycleAt(
  instant: string,
  lifecycleDataState: LifecycleDataState = LifecycleDataState.COMPLETE,
) {
  return calculateLifecycle(
    {
      lifecycleDataState,
      evidence: [
        {
          qualifiesForActivation: true,
          qualifiesForActivity: true,
          submittedAt,
          recordedAt: new Date('2026-07-01T00:00:01.000Z'),
        },
      ],
    },
    { clock: new FixedClock(instant) },
  );
}

describe('calculateLifecycle', () => {
  it('keeps ACTIVE exactly at 252 hours and changes immediately after it', () => {
    const onBoundary = lifecycleAt('2026-07-11T12:00:00.000Z');
    const afterBoundary = lifecycleAt('2026-07-11T12:00:00.001Z');

    expect(onBoundary.activityStatus).toBe(ActivityStatus.ACTIVE);
    expect(onBoundary.nextStatusTransitionAt?.toISOString()).toBe('2026-07-11T12:00:00.000Z');
    expect(afterBoundary.activityStatus).toBe(ActivityStatus.MEDIUM);
  });

  it('keeps MEDIUM exactly at 504 hours and changes immediately after it', () => {
    expect(lifecycleAt('2026-07-22T00:00:00.000Z').activityStatus).toBe(ActivityStatus.MEDIUM);
    const inactive = lifecycleAt('2026-07-22T00:00:00.001Z');
    expect(inactive.activityStatus).toBe(ActivityStatus.INACTIVE);
    expect(inactive.nextStatusTransitionAt).toBeNull();
  });

  it('uses the newest qualifying dated version and the first dated version for activation', () => {
    const result = calculateLifecycle(
      {
        lifecycleDataState: LifecycleDataState.COMPLETE,
        evidence: [
          {
            qualifiesForActivation: true,
            qualifiesForActivity: true,
            submittedAt: new Date('2025-01-01T00:00:00Z'),
          },
          {
            qualifiesForActivation: true,
            qualifiesForActivity: true,
            submittedAt: new Date('2026-07-20T00:00:00Z'),
          },
          {
            qualifiesForActivation: false,
            qualifiesForActivity: false,
            submittedAt: new Date('2026-07-22T00:00:00Z'),
          },
        ],
      },
      { clock: new FixedClock('2026-07-22T01:00:00Z') },
    );

    expect(result.activationState).toBe(ActivationState.ACTIVATED);
    expect(result.activatedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result.lastArtifactAt?.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(result.activityStatus).toBe(ActivityStatus.ACTIVE);
  });

  it('returns UNKNOWN_LEGACY only when incomplete legacy has no proof', () => {
    const legacy = calculateLifecycle(
      {
        lifecycleDataState: LifecycleDataState.LEGACY_INCOMPLETE,
        evidence: [],
      },
      { clock: new FixedClock('2026-07-22T00:00:00Z') },
    );
    const complete = calculateLifecycle(
      { lifecycleDataState: LifecycleDataState.COMPLETE, evidence: [] },
      { clock: new FixedClock('2026-07-22T00:00:00Z') },
    );

    expect(legacy.activationState).toBe(ActivationState.UNKNOWN_LEGACY);
    expect(legacy.activityStatus).toBe(ActivityStatus.UNKNOWN);
    expect(complete.activationState).toBe(ActivationState.NOT_ACTIVATED);
    expect(complete.activityStatus).toBe(ActivityStatus.UNKNOWN);
  });

  it('activates undated legacy proof but leaves activity and activatedAt unknown', () => {
    const result = calculateLifecycle(
      {
        lifecycleDataState: LifecycleDataState.LEGACY_INCOMPLETE,
        evidence: [
          {
            qualifiesForActivation: true,
            qualifiesForActivity: false,
            submittedAt: null,
            recordedAt: new Date('2026-07-22T02:00:00Z'),
          },
        ],
      },
      { clock: new FixedClock('2026-07-22T03:00:00Z') },
    );

    expect(result.activationState).toBe(ActivationState.ACTIVATED);
    expect(result.activityStatus).toBe(ActivityStatus.UNKNOWN);
    expect(result.activatedAt).toBeNull();
    expect(result.activationRecordedAt?.toISOString()).toBe('2026-07-22T02:00:00.000Z');
  });

  it('does not erase a known historical artifact because it predates baseline', () => {
    const state = establishInitialLifecycleDataState({
      dataOrigin: DataOrigin.LEGACY_IMPORT,
      recordedAt: new Date('2026-08-01T00:00:00Z'),
      artifactBaselineAt: new Date('2026-07-01T00:00:00Z'),
    });
    const result = calculateLifecycle(
      {
        lifecycleDataState: state,
        evidence: [
          {
            qualifiesForActivation: true,
            qualifiesForActivity: true,
            submittedAt: new Date('2025-01-01T00:00:00Z'),
          },
        ],
      },
      { clock: new FixedClock('2026-08-01T00:00:00Z') },
    );

    expect(state).toBe(LifecycleDataState.LEGACY_INCOMPLETE);
    expect(result.activationState).toBe(ActivationState.ACTIVATED);
    expect(result.activityStatus).toBe(ActivityStatus.INACTIVE);
  });

  it('marks only live intake at or after baseline as initially complete', () => {
    const baseline = new Date('2026-07-01T00:00:00Z');
    expect(
      establishInitialLifecycleDataState({
        dataOrigin: DataOrigin.LIVE,
        recordedAt: baseline,
        artifactBaselineAt: baseline,
      }),
    ).toBe(LifecycleDataState.COMPLETE);
    expect(
      establishInitialLifecycleDataState({
        dataOrigin: DataOrigin.LIVE,
        recordedAt: new Date('2026-06-30T23:59:59.999Z'),
        artifactBaselineAt: baseline,
      }),
    ).toBe(LifecycleDataState.LEGACY_INCOMPLETE);
  });

  it('applies a supplied versioned rule set instead of hard-coding defaults', () => {
    const result = calculateLifecycle(
      {
        lifecycleDataState: LifecycleDataState.COMPLETE,
        evidence: [
          {
            qualifiesForActivation: true,
            qualifiesForActivity: true,
            submittedAt,
          },
        ],
      },
      {
        clock: new FixedClock('2026-07-01T02:00:00.001Z'),
        ruleSet: {
          id: 'test-v2',
          version: 2,
          activeWindowHours: 1,
          inactiveAfterHours: 2,
        },
      },
    );

    expect(result.activityStatus).toBe(ActivityStatus.INACTIVE);
    expect(result.appliedRuleSetId).toBe('test-v2');
    expect(DEFAULT_LIFECYCLE_RULE_SET.activeWindowHours).toBe(252);
  });

  it('rejects impossible activity evidence and submissions beyond five-minute skew', () => {
    expect(() =>
      calculateLifecycle(
        {
          lifecycleDataState: LifecycleDataState.COMPLETE,
          evidence: [
            {
              qualifiesForActivation: false,
              qualifiesForActivity: true,
              submittedAt,
            },
          ],
        },
        { clock: new FixedClock('2026-07-22T00:00:00Z') },
      ),
    ).toThrow(LifecycleInvariantError);

    const clock = new FixedClock('2026-07-22T00:00:00Z');
    expect(() =>
      assertSubmittedAtIsNotFuture(new Date('2026-07-22T00:05:00.000Z'), clock),
    ).not.toThrow();
    expect(() => assertSubmittedAtIsNotFuture(new Date('2026-07-22T00:05:00.001Z'), clock)).toThrow(
      LifecycleInvariantError,
    );
  });
});
