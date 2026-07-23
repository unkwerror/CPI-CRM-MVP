import { collapseWhitespace } from '@cpi-crm/domain';

import { LYNCH_SHEET_NAME } from './constants.js';
import { canonicalHeader, isSensitiveHeader, serializedCellText } from './cell.js';
import { LYNCH_SLOTS, contactTypeForHeader } from './observations.js';
import type { SerializedCell } from './types.js';

/**
 * A structured participant attribute recovered from a source row. Every value
 * the CRM does not map into a first-class column (university, faculty, project,
 * application status, …) used to survive only inside source_records.raw_json;
 * these attributes make that information a queryable person-level fact.
 */
export interface PersonAttributeObservation {
  readonly field: string;
  readonly label: string;
  readonly value: string;
}

/** Minimal row shape shared by in-memory SourceRow and source_records.raw_json. */
export interface AttributeSourceRow {
  readonly sheetName: string;
  readonly cells: readonly SerializedCell[];
}

const MAX_ATTRIBUTE_VALUE_LENGTH = 4000;

interface AttributeRule {
  readonly field: string;
  readonly label: string;
  readonly test: (canonical: string) => boolean;
}

const eq =
  (...names: readonly string[]) =>
  (canonical: string) =>
    names.includes(canonical);
const startsWith = (prefix: string) => (canonical: string) => canonical.startsWith(prefix);

/**
 * Curated header mapping, checked in order. Supervisor fields must run before
 * the generic name/position exclusions below.
 */
const ATTRIBUTE_RULES: readonly AttributeRule[] = [
  { field: 'supervisorName', label: 'Научный руководитель', test: eq('фио научного руководителя') },
  {
    field: 'supervisorPosition',
    label: 'Должность научного руководителя',
    test: eq('должность научного руководителя'),
  },
  { field: 'age', label: 'Возраст', test: eq('возраст') },
  {
    field: 'university',
    label: 'Вуз / место учёбы',
    test: eq('вуз', 'место учебы', 'наименование учебного заведения'),
  },
  { field: 'workplace', label: 'Обучение / место работы', test: eq('обучение место работы') },
  {
    field: 'universityRelation',
    label: 'Отношение к университету',
    test: eq('отношение к университету'),
  },
  {
    field: 'faculty',
    label: 'Факультет',
    test: eq('факультет', 'факультет кафедра', 'факультет подразделение', 'предполагаемый факультет'),
  },
  { field: 'courseYear', label: 'Курс', test: eq('курс', 'курс обучений') },
  {
    field: 'educationLevel',
    label: 'Уровень образования',
    test: eq('уровень образования', 'уровень обучения', 'уровень высшего образования'),
  },
  {
    field: 'educationForm',
    label: 'Форма обучения',
    test: eq('форма обучения', 'форма обучения баллы'),
  },
  { field: 'educationBasis', label: 'Основа обучения', test: eq('основа обучения') },
  {
    field: 'specialty',
    label: 'Специальность',
    test: eq('специальность', 'направление обучения специальность'),
  },
  { field: 'studentStatus', label: 'Статус студента', test: startsWith('является студентом') },
  { field: 'studyStart', label: 'Начало обучения', test: eq('начало обучения') },
  { field: 'studyEnd', label: 'Окончание обучения', test: eq('окончание обучения') },
  { field: 'company', label: 'Компания', test: eq('компания') },
  { field: 'jobTitle', label: 'Должность', test: eq('должность', 'должность подраздение') },
  { field: 'workStart', label: 'Начало работы', test: startsWith('начало работы') },
  { field: 'workEnd', label: 'Окончание работы', test: startsWith('конец работы') },
  { field: 'city', label: 'Город', test: eq('город') },
  { field: 'region', label: 'Регион', test: eq('регион') },
  { field: 'role', label: 'Роль на мероприятии', test: eq('роль') },
  { field: 'participationFormat', label: 'Формат участия', test: eq('формат участия') },
  { field: 'applicationStatus', label: 'Статус заявки', test: eq('статус заявки') },
  {
    field: 'applicationDate',
    label: 'Дата заявки',
    test: eq('дата заявки', 'дата время поступления заявки'),
  },
  { field: 'attendanceDate', label: 'Дата посещения', test: eq('дата посещения') },
  { field: 'attendedEvent', label: 'Посещал мероприятие', test: eq('посещал мероприятие') },
  { field: 'eventsAttended', label: 'Мероприятия (из источника)', test: eq('мероприятия') },
  { field: 'blackMark', label: 'Чёрная метка', test: eq('черная метка') },
  {
    field: 'projectName',
    label: 'Название проекта',
    test: eq('название проекта', 'наименование проекта', 'название вашего проекта'),
  },
  {
    field: 'projectDescription',
    label: 'Описание проекта',
    test: eq('описание вашего проекта', 'о чем проект', 'краткое описание проекта идеи'),
  },
  { field: 'projectTeam', label: 'Команда проекта', test: eq('команда проекта') },
  { field: 'teamSize', label: 'Размер команды', test: eq('кол во человек в команде чел') },
  {
    field: 'projectDirection',
    label: 'Технологическое направление',
    test: eq('технологическое направление проекта'),
  },
  { field: 'projectStage', label: 'Стадия проекта', test: startsWith('стадия готовности проекта') },
  { field: 'competencies', label: 'Компетенции', test: eq('мои компетенции') },
  { field: 'communicationStatus', label: 'Статус коммуникации', test: eq('статус коммуникации') },
  { field: 'testScore', label: 'Баллы за тест', test: eq('баллы') },
  { field: 'note', label: 'Комментарий', test: eq('комментарий', 'комментарии', 'примечания') },
  {
    field: 'materials',
    label: 'Материалы',
    test: (canonical) =>
      eq(
        'материалы',
        'материалы проекта',
        'cv',
        'презентация',
        'презентация наш диск',
        'заполненные справка и пояснительная записка',
      )(canonical) ||
      canonical.startsWith('ваш pitch deck') ||
      canonical.startsWith('презентация описание схема'),
  },
];

/**
 * Headers that never become attributes: names and contacts are first-class
 * CRM data, consent flags and technical identifiers carry no participant
 * knowledge, and the event columns are already the participation itself.
 */
const EXCLUDED_HEADER_PATTERNS: readonly RegExp[] = [
  /^фио/u,
  /^(?:имя|фамилия)$/u,
  /(?:согласие|согласен|принимаю условия|политик)/u,
  /^(?:меро|мероприятие)$/u,
  // NFKC turns '№' into 'no', so the id-column exclusion matches both spellings.
  /^(?:id|№|no|№ заявки|no заявки|номер заявки)$/u,
  /^(?:отметка времени|время создания)$/u,
];

function attributeValue(cell: SerializedCell): string {
  if (cell.kind === 'formula' || cell.kind === 'error') return '';
  const text = collapseWhitespace(serializedCellText(cell));
  if (text.length === 0) return '';
  return text.length > MAX_ATTRIBUTE_VALUE_LENGTH
    ? `${text.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH)}…`
    : text;
}

function attributeFromCell(cell: SerializedCell): PersonAttributeObservation | null {
  const header = cell.header?.trim() ?? '';
  if (header.length === 0 || isSensitiveHeader(header)) return null;
  if (contactTypeForHeader(header) !== null) return null;

  const canonical = canonicalHeader(header);
  if (canonical.length === 0) return null;

  const rule = ATTRIBUTE_RULES.find((candidate) => candidate.test(canonical));
  if (rule === undefined && EXCLUDED_HEADER_PATTERNS.some((pattern) => pattern.test(canonical))) {
    return null;
  }

  const value = attributeValue(cell);
  if (value.length === 0) return null;
  return rule === undefined
    ? { field: 'other', label: header, value }
    : { field: rule.field, label: rule.label, value };
}

/** Row-level Lynch columns that describe the whole team, shared by every slot. */
const LYNCH_ROW_LEVEL_RULES = ATTRIBUTE_RULES.filter((rule) =>
  ['projectName', 'note', 'materials'].includes(rule.field),
);

function extractLynchAttributes(
  row: AttributeSourceRow,
  slotKey: string,
): readonly PersonAttributeObservation[] {
  const slotIndex = Number.parseInt(slotKey.replace('person-', ''), 10) - 1;
  const slot = LYNCH_SLOTS[slotIndex];
  if (slot === undefined) return [];

  const byColumn = new Map(row.cells.map((cell) => [cell.column, cell]));
  const slotFields: ReadonlyArray<{ readonly column: number; readonly rule: AttributeRule }> = [
    {
      column: slot.student,
      rule: { field: 'studentStatus', label: 'Статус студента', test: () => true },
    },
    { column: slot.faculty, rule: { field: 'faculty', label: 'Факультет', test: () => true } },
    {
      column: slot.education,
      rule: { field: 'educationLevel', label: 'Уровень образования', test: () => true },
    },
    { column: slot.course, rule: { field: 'courseYear', label: 'Курс', test: () => true } },
  ];

  const attributes: PersonAttributeObservation[] = [];
  for (const { column, rule } of slotFields) {
    const cell = byColumn.get(column);
    if (cell === undefined) continue;
    const value = attributeValue(cell);
    if (value.length === 0) continue;
    attributes.push({ field: rule.field, label: rule.label, value });
  }
  for (const cell of row.cells) {
    const header = cell.header?.trim() ?? '';
    if (header.length === 0) continue;
    const canonical = canonicalHeader(header);
    const rule = LYNCH_ROW_LEVEL_RULES.find((candidate) => candidate.test(canonical));
    if (rule === undefined) continue;
    const value = attributeValue(cell);
    if (value.length === 0) continue;
    attributes.push({ field: rule.field, label: rule.label, value });
  }
  return attributes;
}

/**
 * Extracts structured attributes for one person observation. Works both with
 * in-memory SourceRow cells and with the JSON persisted in
 * source_records.raw_json (where sensitive values are already nulled).
 */
export function extractPersonAttributes(
  row: AttributeSourceRow,
  slotKey: string,
): readonly PersonAttributeObservation[] {
  if (row.sheetName === LYNCH_SHEET_NAME) return extractLynchAttributes(row, slotKey);

  const attributes: PersonAttributeObservation[] = [];
  const seen = new Set<string>();
  for (const cell of row.cells) {
    const attribute = attributeFromCell(cell);
    if (attribute === null) continue;
    const key = `${attribute.field}\u0000${attribute.label}\u0000${attribute.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attributes.push(attribute);
  }
  return attributes;
}
