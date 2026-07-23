import type { AutoDeduplicationResult } from '@cpi-crm/db';

import type { PersonNameHygieneCleanupResult, PersonNameHygieneSummary } from './hygiene.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type SerializedCellKind =
  'string' | 'number' | 'boolean' | 'date' | 'formula' | 'hyperlink' | 'rich-text' | 'error';

export interface SerializedCell {
  readonly column: number;
  readonly address: string;
  readonly header: string | null;
  readonly kind: SerializedCellKind;
  /** Cached formula results are deliberately never represented here. */
  readonly value: JsonValue;
  /** Excel formatting is retained so raw numeric identifiers remain reconstructable. */
  readonly numberFormat: string | null;
  /** Never populated for formulas because Cell.text may expose their cached result. */
  readonly displayText: string | null;
}

export interface SourceRow {
  readonly sourceFilename: string;
  readonly sheetName: string;
  readonly headerRow: number;
  readonly rowNumber: number;
  readonly cells: readonly SerializedCell[];
  readonly rowHash: string;
}

export type ContactType = 'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX' | 'OTHER';

export interface ContactObservation {
  readonly type: ContactType;
  readonly raw: string;
  readonly normalized: string;
}

export interface PersonObservation {
  readonly sourceRowHash: string;
  readonly sheetName: string;
  readonly rowNumber: number;
  readonly slotKey: string;
  readonly parserVersion: string;
  readonly sourceNamespace: string | null;
  readonly externalId: string | null;
  readonly eventName: string;
  readonly rawValues: JsonObject;
  readonly normalizedValues: JsonObject;
  readonly canonicalFullName: string;
  readonly normalizedFullName: string;
  readonly contacts: readonly ContactObservation[];
  readonly observationFingerprint: string;
}

export interface SheetExtractionSummary {
  readonly sheetName: string;
  readonly headerRow: number;
  readonly sourceRows: number;
  readonly personObservations: number;
  readonly formulaCells: number;
  readonly sensitiveRawCells: number;
}

export interface WorkbookImportPlan {
  readonly absolutePath: string;
  readonly sourceFilename: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly sourceRows: readonly SourceRow[];
  readonly observations: readonly PersonObservation[];
  readonly sheets: readonly SheetExtractionSummary[];
  readonly catalyst2025: {
    readonly sourceRows: number;
    readonly distinctExternalIds: number;
    readonly distinctEvents: number;
    readonly duplicatePersonEvents: number;
  };
}

export interface ControlResult {
  readonly key: string;
  readonly expected: number;
  readonly actual: number;
  readonly passed: boolean;
}

export interface AuditWarning {
  readonly code: string;
  readonly sheetName: string;
  readonly rowNumber?: number;
  readonly count?: number;
}

export interface AuditReport {
  readonly importerVersion: string;
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly mode: 'DRY_RUN' | 'COMMIT';
  readonly generatedAt: string;
  readonly source: {
    readonly filename: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly totals: {
    readonly sheets: number;
    readonly sourceRows: number;
    readonly personObservations: number;
    readonly formulaCells: number;
    readonly sensitiveRawCells: number;
  };
  readonly outcomes: {
    readonly parsedSourceRows: number;
    readonly readyPersonObservations: number;
    readonly rejectedPersonObservations: number;
    readonly quarantinedSourceRows: number;
    readonly ignoredSourceRows: number;
  };
  readonly catalyst2025: WorkbookImportPlan['catalyst2025'];
  readonly controls: readonly ControlResult[];
  readonly controlsPassed: boolean;
  readonly sheets: readonly SheetExtractionSummary[];
  readonly warnings: readonly AuditWarning[];
  readonly commit: CommitResult | null;
}

export interface CommitOptions {
  readonly databaseUrl: string;
  readonly organizationId: string;
  readonly initiatedByUserId: string;
  readonly sourceFileObjectId?: string;
  readonly timezone?: string;
  /** Successful dry-run that approved this immutable batch. */
  readonly basedOnRunId?: string;
}

export interface CommitResult {
  readonly batchId: string;
  readonly runId: string;
  readonly reusedBatch: boolean;
  readonly deduplication: AutoDeduplicationResult;
  readonly dataHygiene: {
    readonly summary: PersonNameHygieneSummary;
    readonly cleanup: PersonNameHygieneCleanupResult;
  };
  readonly created: {
    readonly sourceRecords: number;
    readonly personObservations: number;
    readonly persons: number;
    readonly contacts: number;
    readonly events: number;
    readonly eventParticipations: number;
    readonly artifacts: number;
    readonly artifactVersions: number;
    readonly artifactContributors: number;
    readonly provenanceLinks: number;
    readonly fieldObservations: number;
    readonly duplicateCandidates: number;
  };
}
