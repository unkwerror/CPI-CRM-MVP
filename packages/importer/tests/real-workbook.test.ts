import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { normalizeFullName } from '@cpi-crm/domain';

import { auditImportPlan } from '../src/audit.js';
import { extractLegacyArtifactMaterials } from '../src/artifacts.js';
import { summarizePersonNameHygiene } from '../src/hygiene.js';
import {
  CATALYST_2025_NAMESPACE,
  CATALYST_2025_SHEET_NAME,
  DEFAULT_WORKBOOK_FILENAME,
  EXPECTED_CONTROL_TOTALS,
  HEADER_ROW_TWO_SHEETS,
  LYNCH_SHEET_NAME,
} from '../src/constants.js';
import type { AuditReport, WorkbookImportPlan } from '../src/types.js';
import { readWorkbookImportPlan, sourceRowAsRawJson } from '../src/workbook.js';

const here = dirname(fileURLToPath(import.meta.url));
const workbookPath = resolve(here, '..', '..', '..', DEFAULT_WORKBOOK_FILENAME);

describe('real CPI workbook controls', () => {
  let plan: WorkbookImportPlan;
  let report: AuditReport;

  beforeAll(async () => {
    plan = await readWorkbookImportPlan(workbookPath);
    report = auditImportPlan(plan);
  }, 30_000);

  it('extracts every factual source row and observation', () => {
    expect(report.controlsPassed).toBe(true);
    expect(report.totals).toMatchObject({
      sheets: EXPECTED_CONTROL_TOTALS.sheets,
      sourceRows: EXPECTED_CONTROL_TOTALS.sourceRows,
      personObservations: EXPECTED_CONTROL_TOTALS.personObservations,
    });
    expect(report.source.sha256).toBe(
      '340ed6a5aa8dd3f15cdc7fb2361d7bb39294fe41ff830295c8ed6fb7d8e9c179',
    );
  });

  it('rejects only deterministic invalid names while retaining their observations', () => {
    expect(summarizePersonNameHygiene(plan)).toMatchObject({
      acceptedObservations: 12_110,
      rejectedObservations: 12,
      ignoredSourceRows: 11,
      reasons: {
        TEST_PLACEHOLDER: 4,
        MISSING_OR_GENERATED_PLACEHOLDER: 7,
        TOO_SHORT: 1,
      },
    });
    expect(report.outcomes).toMatchObject({
      readyPersonObservations: 12_110,
      rejectedPersonObservations: 12,
      ignoredSourceRows: 11,
    });
  });

  it('uses explicit and factual header rows', () => {
    for (const sheetName of HEADER_ROW_TWO_SHEETS) {
      expect(plan.sheets.find((sheet) => sheet.sheetName === sheetName)?.headerRow).toBe(2);
    }
    expect(plan.sheets.find((sheet) => sheet.sheetName === 'Студстартапы 2025')?.headerRow).toBe(2);
  });

  it('uses six coordinate slots for Lynch without placeholder people', () => {
    const lynch = plan.sheets.find((sheet) => sheet.sheetName === LYNCH_SHEET_NAME);
    expect(lynch).toMatchObject({ sourceRows: 179, personObservations: 562 });
    expect(
      plan.observations
        .filter((entry) => entry.sheetName === LYNCH_SHEET_NAME)
        .every((entry) => /^person-[1-6]$/u.test(entry.slotKey)),
    ).toBe(true);
  });

  it('parses Catalyst stable IDs, events and duplicate facts exactly', () => {
    expect(report.catalyst2025).toEqual({
      sourceRows: EXPECTED_CONTROL_TOTALS.catalyst2025Rows,
      distinctExternalIds: EXPECTED_CONTROL_TOTALS.catalyst2025ExternalIds,
      distinctEvents: EXPECTED_CONTROL_TOTALS.catalyst2025Events,
      duplicatePersonEvents: EXPECTED_CONTROL_TOTALS.catalyst2025DuplicatePersonEvents,
    });
    expect(
      plan.observations
        .filter((entry) => entry.sheetName === CATALYST_2025_SHEET_NAME)
        .every(
          (entry) => entry.sourceNamespace === CATALYST_2025_NAMESPACE && entry.externalId !== null,
        ),
    ).toBe(true);
  });

  it('plans exact event and person-event facts without merging people by names or contacts', () => {
    const events = new Set(plan.observations.map((entry) => normalizeFullName(entry.eventName)));
    const participationFacts = new Set(
      plan.observations.map((entry) => {
        const personKey =
          entry.sourceNamespace !== null && entry.externalId !== null
            ? `${entry.sourceNamespace}:${entry.externalId}`
            : `${entry.sourceRowHash}:${entry.slotKey}`;
        return JSON.stringify([personKey, normalizeFullName(entry.eventName)]);
      }),
    );
    const catalystEvents = new Set(
      plan.observations
        .filter((entry) => entry.sheetName === CATALYST_2025_SHEET_NAME)
        .map((entry) => normalizeFullName(entry.eventName)),
    );

    // Every sheet maps to exactly one event, so Catalyst 2025 no longer fans
    // out into 36 sub-events; its column-22 names stay only in source rows.
    expect([...events]).not.toContain('');
    expect(events.size).toBe(34);
    expect(catalystEvents.size).toBe(1);
    expect(participationFacts.size).toBe(2_910);
    expect(plan.observations.length - participationFacts.size).toBe(9_212);
  });

  it('extracts legacy event materials and every author from their source rows', () => {
    const materials = extractLegacyArtifactMaterials(plan.sourceRows);
    const observationsByRow = new Map<string, number>();
    for (const observation of plan.observations) {
      observationsByRow.set(
        observation.sourceRowHash,
        (observationsByRow.get(observation.sourceRowHash) ?? 0) + 1,
      );
    }

    expect(materials).toHaveLength(61);
    expect(new Set(materials.map((entry) => entry.sheetName))).toHaveLength(6);
    expect(materials.filter((entry) => entry.contentType === 'EXTERNAL_URL')).toHaveLength(60);
    expect(materials.filter((entry) => entry.contentType === 'TEXT')).toHaveLength(1);
    expect(materials.filter((entry) => entry.typeCode === 'PITCH_DECK')).toHaveLength(48);
    expect(materials.filter((entry) => entry.typeCode === 'OTHER')).toHaveLength(13);
    expect(
      materials.reduce(
        (total, material) => total + (observationsByRow.get(material.sourceRowHash) ?? 0),
        0,
      ),
    ).toBe(123);
    expect(
      materials
        .filter((entry) => entry.contentType === 'EXTERNAL_URL')
        .every((entry) => /^https?:\/\//u.test(entry.externalUrl ?? '')),
    ).toBe(true);
  });

  it('keeps sensitive columns out of normalized observations', () => {
    for (const observation of plan.observations) {
      const keysOnly = [
        ...Object.keys(observation.rawValues),
        ...Object.keys(observation.normalizedValues),
      ]
        .join(' ')
        .toLocaleLowerCase('ru');
      expect(keysOnly).not.toMatch(/снилс|дата рождения/u);
    }
  });

  it('redacts sensitive values before database staging', () => {
    const stagedCells = plan.sourceRows.flatMap(
      (row) =>
        (
          sourceRowAsRawJson(row) as {
            cells: Array<{
              normalizedHeader: string | null;
              value: unknown;
              displayText: string | null;
              redacted?: boolean;
            }>;
          }
        ).cells,
    );
    const sensitive = stagedCells.filter((cell) =>
      /(?:^| )снилс(?: |$)|дата рождения/u.test(cell.normalizedHeader ?? ''),
    );
    expect(sensitive).toHaveLength(report.totals.sensitiveRawCells);
    expect(
      sensitive.every(
        (cell) => cell.redacted === true && cell.value === null && cell.displayText === null,
      ),
    ).toBe(true);
  });

  it('returns deeply frozen staging rows', () => {
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sourceRows)).toBe(true);
    expect(Object.isFrozen(plan.sourceRows[0])).toBe(true);
    expect(Object.isFrozen(plan.sourceRows[0]?.cells)).toBe(true);
  });
});
