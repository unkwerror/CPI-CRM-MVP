import { collapseWhitespace, normalizeFullName, normalizeUnicode } from './normalization.js';

const RUSSIAN_NAME_COMPONENT = /^[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*$/u;
const COMMENT_PLACEHOLDER = /^(?:нет|не\s+указано|отсутствует|none|null|n\/?a|test|тест|[-—.]+)$/iu;
const DISALLOWED_COMMENT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export const MAX_PARTICIPANT_COMMENT_LENGTH = 10_000;

export interface RussianFullName {
  readonly lastName: string;
  readonly firstName: string;
  readonly patronymic: string;
  readonly canonicalFullName: string;
  readonly normalizedFullName: string;
}

function titleCasePart(part: string): string {
  return part
    .toLocaleLowerCase('ru-RU')
    .split('-')
    .map((segment) => {
      const [first, ...rest] = [...segment];
      return `${first?.toLocaleUpperCase('ru-RU') ?? ''}${rest.join('')}`;
    })
    .join('-');
}

export function isRussianNameComponent(value: string): boolean {
  return RUSSIAN_NAME_COMPONENT.test(value);
}

/** Strict CRM identity name: surname, given name and patronymic in Russian Cyrillic. */
export function parseRussianFullName(value: unknown): RussianFullName | null {
  if (typeof value !== 'string') return null;
  const parts = collapseWhitespace(normalizeUnicode(value)).split(' ');
  if (parts.length !== 3 || parts.some((part) => !isRussianNameComponent(part))) return null;
  return buildRussianFullName({
    lastName: parts[0]!,
    firstName: parts[1]!,
    patronymic: parts[2]!,
  });
}

export function buildRussianFullName(input: {
  readonly lastName: string;
  readonly firstName: string;
  readonly patronymic: string;
}): RussianFullName | null {
  const rawParts = [input.lastName, input.firstName, input.patronymic].map((part) =>
    collapseWhitespace(normalizeUnicode(part)),
  );
  if (rawParts.some((part) => !isRussianNameComponent(part))) return null;
  const [lastName, firstName, patronymic] = rawParts.map(titleCasePart) as [string, string, string];
  const canonicalFullName = `${lastName} ${firstName} ${patronymic}`;
  return Object.freeze({
    lastName,
    firstName,
    patronymic,
    canonicalFullName,
    normalizedFullName: normalizeFullName(canonicalFullName),
  });
}

export type ParticipantCommentAssessment =
  | { readonly accepted: true; readonly value: string | null }
  | {
      readonly accepted: false;
      readonly reason: 'TOO_LONG' | 'CONTROL_CHARACTERS' | 'PLACEHOLDER' | 'NO_CONTENT';
    };

export function assessParticipantComment(value: unknown): ParticipantCommentAssessment {
  if (value === null || value === undefined || value === '') {
    return { accepted: true, value: null };
  }
  if (typeof value !== 'string') return { accepted: false, reason: 'NO_CONTENT' };
  const normalized = normalizeUnicode(value).replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (normalized.length === 0) return { accepted: true, value: null };
  if (normalized.length > MAX_PARTICIPANT_COMMENT_LENGTH) {
    return { accepted: false, reason: 'TOO_LONG' };
  }
  if (DISALLOWED_COMMENT_CONTROL.test(normalized)) {
    return { accepted: false, reason: 'CONTROL_CHARACTERS' };
  }
  if (COMMENT_PLACEHOLDER.test(normalized)) return { accepted: false, reason: 'PLACEHOLDER' };
  if (!/[0-9A-Za-zА-Яа-яЁё]/u.test(normalized)) {
    return { accepted: false, reason: 'NO_CONTENT' };
  }
  return { accepted: true, value: normalized };
}
