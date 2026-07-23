import { basename, extname, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import ExcelJS from 'exceljs';

import {
  CATALYST_2025_SHEET_NAME,
  DEFAULT_MAX_FILE_BYTES,
  HEADER_ROW_TWO_SHEETS,
} from './constants.js';
import {
  canonicalHeader,
  isSensitiveHeader,
  safeCellValue,
  serializeCell,
  serializedCellText,
} from './cell.js';
import { deepFreeze, fingerprint, sha256 } from './hash.js';
import { extractPersonObservations } from './observations.js';
import type {
  SerializedCell,
  SheetExtractionSummary,
  SourceRow,
  WorkbookImportPlan,
} from './types.js';

export interface ReadWorkbookOptions {
  readonly maxFileBytes?: number;
}

function meaningfulCells(row: ExcelJS.Row): readonly ExcelJS.Cell[] {
  const cells: ExcelJS.Cell[] = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.isMerged && cell.master.address !== cell.address) return;
    if (safeCellValue(cell.value) !== null) cells.push(cell);
  });
  return cells;
}

function resolveHeaderRow(worksheet: ExcelJS.Worksheet): number {
  if (HEADER_ROW_TWO_SHEETS.has(worksheet.name)) return 2;

  // Most sheets use row 1. One legacy sheet has an entirely blank first row;
  // selecting the first factual row preserves the 11,739-row control total.
  const scanUntil = Math.min(worksheet.rowCount, 20);
  for (let rowNumber = 1; rowNumber <= scanUntil; rowNumber += 1) {
    if (meaningfulCells(worksheet.getRow(rowNumber)).length > 0) return rowNumber;
  }
  return 1;
}

function headersFor(worksheet: ExcelJS.Worksheet, headerRow: number): ReadonlyMap<number, string> {
  const headers = new Map<number, string>();
  for (const cell of meaningfulCells(worksheet.getRow(headerRow))) {
    const safe = safeCellValue(cell.value);
    if (safe !== null && safe.scalarText.trim().length > 0) {
      headers.set(cell.fullAddress.col, safe.scalarText.trim());
    }
  }
  return headers;
}

function extractRows(
  worksheet: ExcelJS.Worksheet,
  sourceFilename: string,
): {
  readonly rows: readonly SourceRow[];
  readonly formulaCells: number;
  readonly sensitiveRawCells: number;
  readonly headerRow: number;
} {
  const headerRow = resolveHeaderRow(worksheet);
  const headers = headersFor(worksheet, headerRow);
  const rows: SourceRow[] = [];
  let formulaCells = 0;
  let sensitiveRawCells = 0;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.number <= headerRow) return;

    const cells: SerializedCell[] = [];
    for (const excelCell of meaningfulCells(row)) {
      const header = headers.get(excelCell.fullAddress.col) ?? null;
      const serialized = serializeCell(excelCell, header);
      if (serialized === null) continue;
      if (serialized.kind === 'formula') formulaCells += 1;
      if (isSensitiveHeader(serialized.header)) sensitiveRawCells += 1;
      cells.push(serialized);
    }
    if (cells.length === 0) return;

    const rawIdentity = {
      sourceFilename,
      sheetName: worksheet.name,
      headerRow,
      rowNumber: row.number,
      cells,
    };
    rows.push(
      deepFreeze({
        ...rawIdentity,
        rowHash: fingerprint(rawIdentity),
      }) as SourceRow,
    );
  });

  return deepFreeze({ rows, formulaCells, sensitiveRawCells, headerRow });
}

function catalystStatistics(rows: readonly SourceRow[]): WorkbookImportPlan['catalyst2025'] {
  const externalIds = new Set<string>();
  const events = new Set<string>();
  const pairs = new Set<string>();
  let duplicatePersonEvents = 0;

  for (const row of rows) {
    if (row.sheetName !== CATALYST_2025_SHEET_NAME) continue;
    const externalId = serializedCellText(
      row.cells.find((cell) => cell.column === 1) ??
        ({ value: '', kind: 'string' } as SerializedCell),
    ).trim();
    const eventName = serializedCellText(
      row.cells.find((cell) => cell.column === 22) ??
        ({ value: '', kind: 'string' } as SerializedCell),
    ).trim();
    externalIds.add(externalId);
    events.add(eventName);
    const pair = JSON.stringify([externalId, eventName]);
    if (pairs.has(pair)) duplicatePersonEvents += 1;
    else pairs.add(pair);
  }

  return deepFreeze({
    sourceRows: rows.filter((row) => row.sheetName === CATALYST_2025_SHEET_NAME).length,
    distinctExternalIds: externalIds.size,
    distinctEvents: events.size,
    duplicatePersonEvents,
  });
}

export async function readWorkbookImportPlan(
  path: string,
  options: ReadWorkbookOptions = {},
): Promise<WorkbookImportPlan> {
  const absolutePath = resolve(path);
  if (extname(absolutePath).toLocaleLowerCase('en') !== '.xlsx') {
    throw new Error('Only .xlsx workbooks are accepted');
  }

  const fileStat = await stat(absolutePath);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!fileStat.isFile()) throw new Error('Workbook path is not a regular file');
  if (fileStat.size > maxFileBytes) {
    throw new Error(`Workbook exceeds the ${maxFileBytes}-byte safety limit`);
  }

  const bytes = await readFile(absolutePath);
  const workbookSha256 = sha256(bytes);
  const workbook = new ExcelJS.Workbook();

  // ExcelJS does not calculate formulas. safeCellValue additionally ignores
  // cached results and exposes formula text only, so no spreadsheet code runs.
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const sourceFilename = basename(absolutePath);
  const sourceRows: SourceRow[] = [];
  const sheetDrafts: Array<{
    readonly sheetName: string;
    readonly headerRow: number;
    readonly sourceRows: number;
    readonly formulaCells: number;
    readonly sensitiveRawCells: number;
  }> = [];

  for (const worksheet of workbook.worksheets) {
    const extraction = extractRows(worksheet, sourceFilename);
    sourceRows.push(...extraction.rows);
    sheetDrafts.push({
      sheetName: worksheet.name,
      headerRow: extraction.headerRow,
      sourceRows: extraction.rows.length,
      formulaCells: extraction.formulaCells,
      sensitiveRawCells: extraction.sensitiveRawCells,
    });
  }

  const observations = extractPersonObservations(sourceRows);
  const observationCounts = new Map<string, number>();
  for (const observation of observations) {
    observationCounts.set(
      observation.sheetName,
      (observationCounts.get(observation.sheetName) ?? 0) + 1,
    );
  }
  const sheets: SheetExtractionSummary[] = sheetDrafts.map(
    (sheet) =>
      deepFreeze({
        ...sheet,
        personObservations: observationCounts.get(sheet.sheetName) ?? 0,
      }) as SheetExtractionSummary,
  );

  return deepFreeze({
    absolutePath,
    sourceFilename,
    sizeBytes: bytes.byteLength,
    sha256: workbookSha256,
    sourceRows,
    observations,
    sheets,
    catalyst2025: catalystStatistics(sourceRows),
  }) as WorkbookImportPlan;
}

export function sourceRowAsRawJson(row: SourceRow) {
  return deepFreeze({
    sourceFilename: row.sourceFilename,
    sheetName: row.sheetName,
    headerRow: row.headerRow,
    rowNumber: row.rowNumber,
    cells: row.cells.map((cell) => {
      const redacted = isSensitiveHeader(cell.header);
      return {
        column: cell.column,
        address: cell.address,
        header: cell.header,
        normalizedHeader: cell.header === null ? null : canonicalHeader(cell.header),
        kind: cell.kind,
        value: redacted ? null : cell.value,
        numberFormat: cell.numberFormat,
        displayText: redacted ? null : cell.displayText,
        ...(redacted ? { redacted: true } : {}),
      };
    }),
  });
}
