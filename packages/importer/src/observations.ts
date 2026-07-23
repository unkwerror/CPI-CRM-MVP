import {
  collapseWhitespace,
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
  normalizeTelegramUsername,
} from '@cpi-crm/domain';

import {
  CATALYST_2025_NAMESPACE,
  CATALYST_2025_SHEET_NAME,
  LYNCH_SHEET_NAME,
  PARSER_VERSION,
} from './constants.js';
import {
  canonicalHeader,
  isFormulaLiteralPhone,
  isSensitiveHeader,
  safeCellValue,
  serializedCellText,
} from './cell.js';
import { deepFreeze, fingerprint } from './hash.js';
import type {
  ContactObservation,
  ContactType,
  JsonObject,
  PersonObservation,
  SerializedCell,
  SourceRow,
} from './types.js';

export const LYNCH_SLOTS = Object.freeze([
  { name: 3, phone: 4, student: 5, faculty: 6, education: 7, course: 8, email: 2 },
  { name: 9, phone: 10, student: 11, faculty: 12, education: 13, course: 14 },
  { name: 15, phone: 16, student: 17, faculty: 18, education: 19, course: 20 },
  { name: 21, phone: 22, student: 23, faculty: 24, education: 25, course: 26 },
  { name: 31, phone: 32, student: 33, faculty: 34, education: 35, course: 36 },
  { name: 37, phone: 38, student: 39, faculty: 40, education: 41, course: 42 },
]);

function cellAt(row: SourceRow, column: number): SerializedCell | undefined {
  return row.cells.find((cell) => cell.column === column);
}

function textAt(row: SourceRow, column: number): string {
  const cell = cellAt(row, column);
  return cell === undefined ? '' : serializedCellText(cell).trim();
}

export function isPlausiblePersonName(value: string): boolean {
  const normalized = collapseWhitespace(value);
  if (normalized.length < 2 || normalized.startsWith('=')) return false;
  if (/^[-—–_.]+$/u.test(normalized)) return false;
  if (/^(?:нет|нету|неизвестно|отсутствует|без команды)$/iu.test(normalized)) return false;
  return /\p{L}/u.test(normalized);
}

function contact(type: ContactType, rawInput: string, formula = false): ContactObservation | null {
  const raw = collapseWhitespace(rawInput);
  if (raw.length === 0) return null;
  if (formula && type !== 'PHONE') return null;

  let normalized: string | null = null;
  if (type === 'EMAIL') {
    const candidate = normalizeEmail(raw);
    normalized = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : null;
  } else if (type === 'PHONE') {
    const phone = normalizePhone(raw);
    normalized = phone?.e164 ?? null;
  } else if (type === 'TELEGRAM') {
    normalized = normalizeTelegramUsername(raw);
  } else if (type === 'MAX') {
    normalized = raw.toLocaleLowerCase('ru');
  } else {
    normalized = raw.toLocaleLowerCase('ru');
  }

  if (normalized === null || normalized.length === 0) return null;
  return deepFreeze({ type, raw, normalized }) as ContactObservation;
}

function dedupeContacts(
  values: readonly (ContactObservation | null)[],
): readonly ContactObservation[] {
  const contacts = new Map<string, ContactObservation>();
  for (const value of values) {
    if (value === null) continue;
    contacts.set(`${value.type}\u0000${value.normalized}`, value);
  }
  return deepFreeze([...contacts.values()]) as readonly ContactObservation[];
}

export function contactTypeForHeader(header: string): ContactType | null {
  const normalized = canonicalHeader(header);
  if (/telegram|телеграм|telegam|(?:^| )тг(?: |$)/iu.test(normalized)) return 'TELEGRAM';
  if (/(?:e ?mail|email|электронн\w* почт|почта|почты|почту)/iu.test(normalized)) return 'EMAIL';
  if (normalized === 'номер' || /(?:телефон|номер телефона|контактный номер)/iu.test(normalized))
    return 'PHONE';
  if (/(?:^| )max(?: |$)/iu.test(normalized)) return 'MAX';
  if (/(?:контакт|связь)/iu.test(normalized)) return 'OTHER';
  return null;
}

function splitCandidates(value: string): readonly string[] {
  const parts = value
    .split(/[;\n]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length === 0 ? [] : parts;
}

function contactsFromGenericCell(cell: SerializedCell): readonly ContactObservation[] {
  if (cell.header === null || isSensitiveHeader(cell.header)) return [];
  const declaredType = contactTypeForHeader(cell.header);
  if (declaredType === null) return [];

  const safe = safeCellValue(
    cell.kind === 'formula'
      ? { formula: serializedCellText(cell).replace(/^=/u, '') }
      : serializedCellText(cell),
  );
  if (safe === null) return [];
  const formula = safe.isFormula;
  if (formula && !isFormulaLiteralPhone(safe)) return [];

  const found: Array<ContactObservation | null> = [];
  for (const candidate of splitCandidates(safe.scalarText)) {
    if (declaredType !== 'OTHER') {
      found.push(contact(declaredType, candidate, formula));
      continue;
    }
    if (candidate.includes('@') && !candidate.trim().startsWith('@')) {
      found.push(contact('EMAIL', candidate, formula));
    }
    found.push(contact('PHONE', candidate, formula));
    if (candidate.trim().startsWith('@') || /(?:t\.me|telegram\.me)/iu.test(candidate)) {
      found.push(contact('TELEGRAM', candidate, formula));
    }
  }
  return dedupeContacts(found);
}

function scoreNameHeader(header: string): number {
  const normalized = canonicalHeader(header);
  if (isSensitiveHeader(header)) return -1;
  if (normalized === 'фио') return 100;
  if (/фио (?:заявителя|лидера|участника|руководителя проекта)/u.test(normalized)) return 95;
  if (normalized.startsWith('фио ') && !normalized.includes('научного руководителя')) return 80;
  if (normalized === 'имя') return 40;
  return -1;
}

function genericFullName(row: SourceRow): string {
  let best: { readonly score: number; readonly column: number; readonly value: string } | null =
    null;
  for (const cell of row.cells) {
    if (cell.header === null) continue;
    const score = scoreNameHeader(cell.header);
    const value = serializedCellText(cell).trim();
    if (score < 0 || !isPlausiblePersonName(value)) continue;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && cell.column < best.column)
    ) {
      best = { score, column: cell.column, value };
    }
  }
  return best?.value ?? '';
}

function buildObservation(input: {
  readonly row: SourceRow;
  readonly slotKey: string;
  readonly fullName: string;
  readonly contacts: readonly ContactObservation[];
  readonly eventName: string;
  readonly sourceNamespace?: string | null;
  readonly externalId?: string | null;
  readonly extraRawValues?: JsonObject;
}): PersonObservation {
  const suppliedName = collapseWhitespace(input.fullName);
  const canonicalFullName = isPlausiblePersonName(suppliedName)
    ? suppliedName
    : `Неизвестный участник (${input.row.sheetName}:${input.row.rowNumber}:${input.slotKey})`;
  const normalizedFullName = normalizeFullName(canonicalFullName);
  const sourceNamespace = input.sourceNamespace ?? null;
  const externalId = input.externalId ?? null;

  const rawValues: JsonObject = deepFreeze({
    ...(suppliedName.length === 0 ? {} : { fullName: suppliedName }),
    contacts: input.contacts.map((entry) => ({ type: entry.type, raw: entry.raw })),
    eventName: input.eventName,
    ...(externalId === null ? {} : { externalId }),
    ...(input.extraRawValues ?? {}),
  }) as JsonObject;
  const normalizedValues: JsonObject = deepFreeze({
    fullName: normalizedFullName,
    contacts: input.contacts.map((entry) => ({ type: entry.type, value: entry.normalized })),
    eventName: collapseWhitespace(input.eventName).toLocaleLowerCase('ru'),
    ...(externalId === null ? {} : { externalId }),
  }) as JsonObject;

  const identity = {
    sourceRowHash: input.row.rowHash,
    slotKey: input.slotKey,
    parserVersion: PARSER_VERSION,
    sourceNamespace,
    externalId,
    rawValues,
    normalizedValues,
  };
  return deepFreeze({
    sourceRowHash: input.row.rowHash,
    sheetName: input.row.sheetName,
    rowNumber: input.row.rowNumber,
    slotKey: input.slotKey,
    parserVersion: PARSER_VERSION,
    sourceNamespace,
    externalId,
    eventName: input.eventName,
    rawValues,
    normalizedValues,
    canonicalFullName,
    normalizedFullName,
    contacts: input.contacts,
    observationFingerprint: fingerprint(identity),
  }) as PersonObservation;
}

function extractLynch(row: SourceRow): readonly PersonObservation[] {
  const observations: PersonObservation[] = [];
  for (const [index, slot] of LYNCH_SLOTS.entries()) {
    const fullName = textAt(row, slot.name);
    if (!isPlausiblePersonName(fullName)) continue;
    const phoneCell = cellAt(row, slot.phone);
    const phoneRaw = phoneCell === undefined ? '' : serializedCellText(phoneCell);
    const contacts: Array<ContactObservation | null> = [
      contact('PHONE', phoneRaw, phoneCell?.kind === 'formula'),
    ];
    if ('email' in slot) contacts.push(contact('EMAIL', textAt(row, slot.email)));

    const extraRawValues: JsonObject = deepFreeze({
      studentStatus: textAt(row, slot.student),
      faculty: textAt(row, slot.faculty),
      educationLevel: textAt(row, slot.education),
      course: textAt(row, slot.course),
    }) as JsonObject;
    observations.push(
      buildObservation({
        row,
        slotKey: `person-${index + 1}`,
        fullName,
        contacts: dedupeContacts(contacts),
        eventName: row.sheetName,
        extraRawValues,
      }),
    );
  }
  return observations;
}

function extractGeneric(row: SourceRow): PersonObservation {
  const contacts = dedupeContacts(row.cells.flatMap((cell) => contactsFromGenericCell(cell)));
  const catalyst = row.sheetName === CATALYST_2025_SHEET_NAME;
  return buildObservation({
    row,
    slotKey: 'person-1',
    fullName: catalyst ? textAt(row, 2) : genericFullName(row),
    contacts,
    eventName: catalyst ? textAt(row, 22) : row.sheetName,
    sourceNamespace: catalyst ? CATALYST_2025_NAMESPACE : null,
    externalId: catalyst ? textAt(row, 1) : null,
  });
}

export function extractPersonObservations(
  sourceRows: readonly SourceRow[],
): readonly PersonObservation[] {
  const observations: PersonObservation[] = [];
  for (const row of sourceRows) {
    if (row.sheetName === LYNCH_SHEET_NAME) observations.push(...extractLynch(row));
    else observations.push(extractGeneric(row));
  }
  return deepFreeze(observations) as readonly PersonObservation[];
}
