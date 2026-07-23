const HOUR_IN_MILLISECONDS = 60 * 60 * 1_000;

export const LifecycleDataState = {
  LEGACY_INCOMPLETE: 'LEGACY_INCOMPLETE',
  COMPLETE: 'COMPLETE',
} as const;

export type LifecycleDataState = (typeof LifecycleDataState)[keyof typeof LifecycleDataState];

export const DataOrigin = {
  LEGACY_IMPORT: 'LEGACY_IMPORT',
  LIVE: 'LIVE',
} as const;

export type DataOrigin = (typeof DataOrigin)[keyof typeof DataOrigin];

export const ActivationState = {
  UNKNOWN_LEGACY: 'UNKNOWN_LEGACY',
  NOT_ACTIVATED: 'NOT_ACTIVATED',
  ACTIVATED: 'ACTIVATED',
} as const;

export type ActivationState = (typeof ActivationState)[keyof typeof ActivationState];

export const ActivityStatus = {
  UNKNOWN: 'UNKNOWN',
  ACTIVE: 'ACTIVE',
  MEDIUM: 'MEDIUM',
  INACTIVE: 'INACTIVE',
} as const;

export type ActivityStatus = (typeof ActivityStatus)[keyof typeof ActivityStatus];

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  readonly #instant: Date;

  public constructor(instant: Date | string | number) {
    this.#instant = validDate(instant, 'instant');
  }

  public now(): Date {
    return new Date(this.#instant.getTime());
  }
}

export interface LifecycleRuleSet {
  readonly id: string;
  readonly version: number;
  readonly activeWindowHours: number;
  readonly inactiveAfterHours: number;
}

/** The only built-in copy of the initial 252/504-hour thresholds. */
export const DEFAULT_LIFECYCLE_RULE_SET: Readonly<LifecycleRuleSet> = Object.freeze({
  id: 'cpi-lifecycle-v1',
  version: 1,
  activeWindowHours: 252,
  inactiveAfterHours: 504,
});

export interface ArtifactLifecycleEvidence {
  /** Computed server-side; callers must only pass evidence for the selected person-author. */
  readonly qualifiesForActivation: boolean;
  /** Requires a trustworthy submittedAt in addition to activation evidence. */
  readonly qualifiesForActivity: boolean;
  readonly submittedAt: Date | null;
  /** When the proof was entered into the system, especially useful for undated legacy proof. */
  readonly recordedAt?: Date | null;
}

export interface LifecycleCalculationInput {
  readonly lifecycleDataState: LifecycleDataState;
  readonly evidence: readonly ArtifactLifecycleEvidence[];
}

export interface LifecycleCalculationOptions {
  readonly clock: Clock;
  readonly ruleSet?: LifecycleRuleSet;
}

export interface LifecycleCalculation {
  readonly activationState: ActivationState;
  readonly activityStatus: ActivityStatus;
  readonly activatedAt: Date | null;
  readonly activationRecordedAt: Date | null;
  readonly lastArtifactAt: Date | null;
  /** The boundary instant. The old status remains valid exactly at this instant. */
  readonly nextStatusTransitionAt: Date | null;
  readonly calculatedAt: Date;
  readonly appliedRuleSetId: string;
  readonly appliedRuleSetVersion: number;
}

export class LifecycleInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LifecycleInvariantError';
  }
}

export interface InitialLifecycleDataStateInput {
  readonly dataOrigin: DataOrigin;
  /** Time of initial intake into the complete-tracking contour, not persons.created_at. */
  readonly recordedAt: Date;
  readonly artifactBaselineAt: Date;
}

/**
 * Establishes the explicit state once, at intake. It must not be used later to
 * re-derive legacy state from a person's created_at timestamp.
 */
export function establishInitialLifecycleDataState(
  input: InitialLifecycleDataStateInput,
): LifecycleDataState {
  const recordedAt = validDate(input.recordedAt, 'recordedAt');
  const baselineAt = validDate(input.artifactBaselineAt, 'artifactBaselineAt');

  if (input.dataOrigin === DataOrigin.LEGACY_IMPORT) {
    return LifecycleDataState.LEGACY_INCOMPLETE;
  }

  return recordedAt.getTime() >= baselineAt.getTime()
    ? LifecycleDataState.COMPLETE
    : LifecycleDataState.LEGACY_INCOMPLETE;
}

export function validateLifecycleRuleSet(ruleSet: LifecycleRuleSet): Readonly<LifecycleRuleSet> {
  if (ruleSet.id.trim().length === 0) {
    throw new LifecycleInvariantError('Lifecycle rule set id must not be empty');
  }
  if (!Number.isSafeInteger(ruleSet.version) || ruleSet.version < 1) {
    throw new LifecycleInvariantError('Lifecycle rule set version must be a positive integer');
  }
  if (!Number.isFinite(ruleSet.activeWindowHours) || ruleSet.activeWindowHours <= 0) {
    throw new LifecycleInvariantError('activeWindowHours must be a positive finite number');
  }
  if (
    !Number.isFinite(ruleSet.inactiveAfterHours) ||
    ruleSet.inactiveAfterHours <= ruleSet.activeWindowHours
  ) {
    throw new LifecycleInvariantError('inactiveAfterHours must be greater than activeWindowHours');
  }

  const activeWindowMilliseconds = ruleSet.activeWindowHours * HOUR_IN_MILLISECONDS;
  const inactiveAfterMilliseconds = ruleSet.inactiveAfterHours * HOUR_IN_MILLISECONDS;
  if (
    !Number.isSafeInteger(activeWindowMilliseconds) ||
    !Number.isSafeInteger(inactiveAfterMilliseconds)
  ) {
    throw new LifecycleInvariantError(
      'Lifecycle thresholds must be exactly representable in milliseconds',
    );
  }

  return Object.freeze({ ...ruleSet });
}

export function calculateLifecycle(
  input: LifecycleCalculationInput,
  options: LifecycleCalculationOptions,
): LifecycleCalculation {
  const ruleSet = validateLifecycleRuleSet(options.ruleSet ?? DEFAULT_LIFECYCLE_RULE_SET);
  const calculatedAt = validDate(options.clock.now(), 'clock.now()');
  const activationEvidence: Array<{
    submittedAt: Date | null;
    recordedAt: Date | null;
  }> = [];
  const datedActivityEvidence: Date[] = [];

  for (const [index, item] of input.evidence.entries()) {
    const submittedAt =
      item.submittedAt === null
        ? null
        : validDate(item.submittedAt, `evidence[${index}].submittedAt`);
    const recordedAt =
      item.recordedAt === undefined || item.recordedAt === null
        ? null
        : validDate(item.recordedAt, `evidence[${index}].recordedAt`);

    if (item.qualifiesForActivity && !item.qualifiesForActivation) {
      throw new LifecycleInvariantError(
        `evidence[${index}] cannot qualify for activity without activation`,
      );
    }
    if (item.qualifiesForActivity && submittedAt === null) {
      throw new LifecycleInvariantError(
        `evidence[${index}] requires submittedAt to qualify for activity`,
      );
    }

    if (item.qualifiesForActivation) {
      activationEvidence.push({ submittedAt, recordedAt });
    }
    if (item.qualifiesForActivity && submittedAt !== null) {
      datedActivityEvidence.push(submittedAt);
    }
  }

  if (activationEvidence.length === 0) {
    return resultWithoutDatedEvidence(
      input.lifecycleDataState === LifecycleDataState.LEGACY_INCOMPLETE
        ? ActivationState.UNKNOWN_LEGACY
        : ActivationState.NOT_ACTIVATED,
      null,
      calculatedAt,
      ruleSet,
    );
  }

  const activationRecordedAt = minimumDate(activationEvidence.map((item) => item.recordedAt));

  if (datedActivityEvidence.length === 0) {
    return resultWithoutDatedEvidence(
      ActivationState.ACTIVATED,
      activationRecordedAt,
      calculatedAt,
      ruleSet,
    );
  }

  const activatedAt = minimumDate(datedActivityEvidence);
  const lastArtifactAt = maximumDate(datedActivityEvidence);
  if (activatedAt === null || lastArtifactAt === null) {
    throw new LifecycleInvariantError('Dated lifecycle evidence was lost');
  }

  const ageMilliseconds = calculatedAt.getTime() - lastArtifactAt.getTime();
  const activeBoundary = addHours(lastArtifactAt, ruleSet.activeWindowHours);
  const inactiveBoundary = addHours(lastArtifactAt, ruleSet.inactiveAfterHours);
  const activeWindowMilliseconds = ruleSet.activeWindowHours * HOUR_IN_MILLISECONDS;
  const inactiveAfterMilliseconds = ruleSet.inactiveAfterHours * HOUR_IN_MILLISECONDS;

  let activityStatus: ActivityStatus;
  let nextStatusTransitionAt: Date | null;
  if (ageMilliseconds <= activeWindowMilliseconds) {
    activityStatus = ActivityStatus.ACTIVE;
    nextStatusTransitionAt = activeBoundary;
  } else if (ageMilliseconds <= inactiveAfterMilliseconds) {
    activityStatus = ActivityStatus.MEDIUM;
    nextStatusTransitionAt = inactiveBoundary;
  } else {
    activityStatus = ActivityStatus.INACTIVE;
    nextStatusTransitionAt = null;
  }

  return Object.freeze({
    activationState: ActivationState.ACTIVATED,
    activityStatus,
    activatedAt,
    activationRecordedAt,
    lastArtifactAt,
    nextStatusTransitionAt,
    calculatedAt,
    appliedRuleSetId: ruleSet.id,
    appliedRuleSetVersion: ruleSet.version,
  });
}

export const MAX_FUTURE_SUBMISSION_SKEW_MILLISECONDS = 5 * 60 * 1_000;

export function assertSubmittedAtIsNotFuture(
  submittedAt: Date,
  clock: Clock,
  allowedFutureSkewMilliseconds = MAX_FUTURE_SUBMISSION_SKEW_MILLISECONDS,
): void {
  const submitted = validDate(submittedAt, 'submittedAt');
  const now = validDate(clock.now(), 'clock.now()');
  if (
    !Number.isSafeInteger(allowedFutureSkewMilliseconds) ||
    allowedFutureSkewMilliseconds < 0 ||
    allowedFutureSkewMilliseconds > MAX_FUTURE_SUBMISSION_SKEW_MILLISECONDS
  ) {
    throw new LifecycleInvariantError(
      'Future submission tolerance must be an integer from 0 to 5 minutes',
    );
  }
  if (submitted.getTime() - now.getTime() > allowedFutureSkewMilliseconds) {
    throw new LifecycleInvariantError(
      'submittedAt cannot be more than the allowed tolerance in the future',
    );
  }
}

function resultWithoutDatedEvidence(
  activationState: ActivationState,
  activationRecordedAt: Date | null,
  calculatedAt: Date,
  ruleSet: LifecycleRuleSet,
): LifecycleCalculation {
  return Object.freeze({
    activationState,
    activityStatus: ActivityStatus.UNKNOWN,
    activatedAt: null,
    activationRecordedAt,
    lastArtifactAt: null,
    nextStatusTransitionAt: null,
    calculatedAt,
    appliedRuleSetId: ruleSet.id,
    appliedRuleSetVersion: ruleSet.version,
  });
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_IN_MILLISECONDS);
}

function minimumDate(dates: ReadonlyArray<Date | null>): Date | null {
  let minimum: Date | null = null;
  for (const date of dates) {
    if (date !== null && (minimum === null || date.getTime() < minimum.getTime())) {
      minimum = date;
    }
  }
  return minimum === null ? null : new Date(minimum.getTime());
}

function maximumDate(dates: readonly Date[]): Date | null {
  let maximum: Date | null = null;
  for (const date of dates) {
    if (maximum === null || date.getTime() > maximum.getTime()) {
      maximum = date;
    }
  }
  return maximum === null ? null : new Date(maximum.getTime());
}

function validDate(value: Date | string | number, field: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new LifecycleInvariantError(`${field} must be a valid date`);
  }
  return date;
}
