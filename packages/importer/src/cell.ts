import type ExcelJS from 'exceljs';

import type { JsonValue, SerializedCell, SerializedCellKind } from './types.js';

interface FormulaValueLike {
  readonly formula?: unknown;
  readonly sharedFormula?: unknown;
  readonly result?: unknown;
}

interface HyperlinkValueLike {
  readonly text?: unknown;
  readonly hyperlink?: unknown;
  readonly tooltip?: unknown;
}

interface RichTextValueLike {
  readonly richText?: readonly { readonly text?: unknown }[];
}

interface ErrorValueLike {
  readonly error?: unknown;
}

export interface SafeCellValue {
  readonly kind: SerializedCellKind;
  readonly value: JsonValue;
  readonly scalarText: string;
  readonly isFormula: boolean;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/**
 * Converts an ExcelJS value without ever reading a formula's cached result.
 * ExcelJS parses formula text but has no calculation engine; this extra rule
 * ensures even attacker-controlled cached values cannot enter normalization.
 */
export function safeCellValue(value: unknown): SafeCellValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    if (value.trim().length === 0) return null;
    return { kind: 'string', value, scalarText: value, isFormula: false };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const scalarText = String(value);
    return { kind: 'number', value, scalarText, isFormula: false };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', value, scalarText: String(value), isFormula: false };
  }
  if (value instanceof Date) {
    const iso = value.toISOString();
    return { kind: 'date', value: iso, scalarText: iso, isFormula: false };
  }

  if (typeof value !== 'object') {
    return null;
  }

  const formula = value as FormulaValueLike;
  if (formula.formula !== undefined || formula.sharedFormula !== undefined) {
    const expression = stringValue(formula.formula ?? formula.sharedFormula).replace(/^=/u, '');
    if (expression.trim().length === 0) return null;
    const rawExpression = `=${expression}`;
    return {
      kind: 'formula',
      value: Object.freeze({ expression: rawExpression }),
      scalarText: rawExpression,
      isFormula: true,
    };
  }

  const hyperlink = value as HyperlinkValueLike;
  if (hyperlink.hyperlink !== undefined) {
    const text = stringValue(hyperlink.text);
    const url = stringValue(hyperlink.hyperlink);
    if (text.trim().length === 0 && url.trim().length === 0) return null;
    return {
      kind: 'hyperlink',
      value: Object.freeze({
        text,
        url,
        ...(hyperlink.tooltip === undefined ? {} : { tooltip: stringValue(hyperlink.tooltip) }),
      }),
      scalarText: text || url,
      isFormula: false,
    };
  }

  const richText = value as RichTextValueLike;
  if (Array.isArray(richText.richText)) {
    const text = richText.richText.map((part) => stringValue(part.text)).join('');
    if (text.trim().length === 0) return null;
    return { kind: 'rich-text', value: text, scalarText: text, isFormula: false };
  }

  const error = value as ErrorValueLike;
  if (error.error !== undefined) {
    const code = stringValue(error.error);
    return {
      kind: 'error',
      value: Object.freeze({ code }),
      scalarText: '',
      isFormula: false,
    };
  }

  return null;
}

export function isFormulaLiteralPhone(value: SafeCellValue): boolean {
  return value.isFormula && /^=\s*\+?[\d\s().-]+$/u.test(value.scalarText);
}

export function serializeCell(cell: ExcelJS.Cell, header: string | null): SerializedCell | null {
  // A merged slave can mirror its master and must not manufacture a second fact.
  if (cell.isMerged && cell.master.address !== cell.address) {
    return null;
  }
  const safe = safeCellValue(cell.value);
  if (safe === null) return null;
  let displayText: string | null = null;
  if (!safe.isFormula) {
    try {
      displayText = cell.text;
    } catch {
      displayText = safe.scalarText;
    }
  }

  return Object.freeze({
    column: cell.fullAddress.col,
    address: cell.address,
    header,
    kind: safe.kind,
    value: safe.value,
    numberFormat: cell.numFmt || null,
    displayText,
  });
}

export function serializedCellText(cell: SerializedCell): string {
  if (cell.kind !== 'formula' && cell.displayText !== null && cell.displayText.length > 0) {
    return cell.displayText;
  }
  if (typeof cell.value === 'string') return cell.value;
  if (typeof cell.value === 'number' || typeof cell.value === 'boolean') {
    return String(cell.value);
  }
  if (cell.kind === 'formula' && !Array.isArray(cell.value) && cell.value !== null) {
    return stringValue((cell.value as { readonly expression?: unknown }).expression);
  }
  if (cell.kind === 'hyperlink' && !Array.isArray(cell.value) && cell.value !== null) {
    const link = cell.value as { readonly text?: unknown; readonly url?: unknown };
    return stringValue(link.text) || stringValue(link.url);
  }
  return '';
}

export function canonicalHeader(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isSensitiveHeader(header: string | null): boolean {
  if (header === null) return false;
  const normalized = canonicalHeader(header);
  return /(?:^| )снилс(?: |$)/u.test(normalized) || normalized.includes('дата рождения');
}
