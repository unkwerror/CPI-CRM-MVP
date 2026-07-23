import {
  EXPECTED_CONTROL_TOTALS,
  IMPORTER_VERSION,
  PARSER_VERSION,
  RULES_VERSION,
} from './constants.js';
import { deepFreeze } from './hash.js';
import { summarizePersonNameHygiene } from './hygiene.js';
import type { AuditReport, CommitResult, ControlResult, WorkbookImportPlan } from './types.js';

function control(key: string, expected: number, actual: number): ControlResult {
  return Object.freeze({ key, expected, actual, passed: expected === actual });
}

export function auditImportPlan(
  plan: WorkbookImportPlan,
  mode: 'DRY_RUN' | 'COMMIT' = 'DRY_RUN',
  commit: CommitResult | null = null,
): AuditReport {
  const controls = [
    control('sheets', EXPECTED_CONTROL_TOTALS.sheets, plan.sheets.length),
    control('sourceRows', EXPECTED_CONTROL_TOTALS.sourceRows, plan.sourceRows.length),
    control(
      'personObservations',
      EXPECTED_CONTROL_TOTALS.personObservations,
      plan.observations.length,
    ),
    control(
      'catalyst2025.sourceRows',
      EXPECTED_CONTROL_TOTALS.catalyst2025Rows,
      plan.catalyst2025.sourceRows,
    ),
    control(
      'catalyst2025.distinctExternalIds',
      EXPECTED_CONTROL_TOTALS.catalyst2025ExternalIds,
      plan.catalyst2025.distinctExternalIds,
    ),
    control(
      'catalyst2025.distinctEvents',
      EXPECTED_CONTROL_TOTALS.catalyst2025Events,
      plan.catalyst2025.distinctEvents,
    ),
    control(
      'catalyst2025.duplicatePersonEvents',
      EXPECTED_CONTROL_TOTALS.catalyst2025DuplicatePersonEvents,
      plan.catalyst2025.duplicatePersonEvents,
    ),
  ];
  const formulaCells = plan.sheets.reduce((sum, sheet) => sum + sheet.formulaCells, 0);
  const sensitiveRawCells = plan.sheets.reduce((sum, sheet) => sum + sheet.sensitiveRawCells, 0);
  const nameHygiene = summarizePersonNameHygiene(plan);

  return deepFreeze({
    importerVersion: IMPORTER_VERSION,
    parserVersion: PARSER_VERSION,
    rulesVersion: RULES_VERSION,
    mode,
    generatedAt: new Date().toISOString(),
    source: {
      filename: plan.sourceFilename,
      sizeBytes: plan.sizeBytes,
      sha256: plan.sha256,
    },
    totals: {
      sheets: plan.sheets.length,
      sourceRows: plan.sourceRows.length,
      personObservations: plan.observations.length,
      formulaCells,
      sensitiveRawCells,
    },
    outcomes: {
      parsedSourceRows: plan.sourceRows.length,
      readyPersonObservations: nameHygiene.acceptedObservations,
      rejectedPersonObservations: nameHygiene.rejectedObservations,
      quarantinedSourceRows: 0,
      ignoredSourceRows: nameHygiene.ignoredSourceRows,
    },
    catalyst2025: plan.catalyst2025,
    controls,
    controlsPassed: controls.every((entry) => entry.passed),
    sheets: plan.sheets,
    warnings: [
      ...(formulaCells === 0
        ? []
        : [
            {
              code: 'FORMULAS_STORED_AS_TEXT_NOT_EXECUTED',
              sheetName: '*',
              count: formulaCells,
            },
          ]),
      ...(sensitiveRawCells === 0
        ? []
        : [
            {
              code: 'SENSITIVE_VALUES_REDACTED_FROM_DATABASE_STAGING',
              sheetName: '*',
              count: sensitiveRawCells,
            },
          ]),
      ...(nameHygiene.rejectedObservations === 0
        ? []
        : [
            {
              code: 'INVALID_PERSON_NAMES_REJECTED',
              sheetName: '*',
              count: nameHygiene.rejectedObservations,
            },
          ]),
    ],
    commit,
  }) as AuditReport;
}

export function assertControlsPassed(report: AuditReport): void {
  if (report.controlsPassed) return;
  const failed = report.controls
    .filter((entry) => !entry.passed)
    .map((entry) => `${entry.key}: expected ${entry.expected}, got ${entry.actual}`)
    .join('; ');
  throw new Error(`Workbook control totals failed: ${failed}`);
}
