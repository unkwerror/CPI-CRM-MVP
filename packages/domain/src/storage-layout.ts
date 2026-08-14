/**
 * Раскладка объектов в общем хранилище артефактов.
 *
 * Бакет один на CRM и на бот сбора артефактов, поэтому владельца определяет
 * верхняя папка: `crm/` и `locker/` не пересекаются, и по SFTP это выглядит как
 * два независимых дерева.
 *
 * Внутри CRM файл проходит три стоянки. `incoming` — байты, которые ещё не
 * видел антивирус. `checked` — проверенные, но пока ни к чему не привязанные:
 * файл загружают раньше, чем выбирают мероприятие и автора. `artifacts` —
 * итоговое место с человеческими именами папок, куда файл переезжает после
 * отправки артефакта.
 *
 * Имя папки фиксируется в момент переезда и потом не переписывается:
 * переименование мероприятия не должно менять ключи уже сохранённых
 * доказательств.
 */

const MAX_SEGMENT_LENGTH = 80;

/** Символы, из-за которых папку не открыть в проводнике или по SFTP. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f/\\:*?"<>|]/gu;

export function sanitizePathSegment(value: string, fallback = 'без названия'): string {
  const cleaned = value
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[.\s]+/u, '')
    .replace(/[.\s]+$/u, '');
  if (!cleaned) return fallback;
  return cleaned.length > MAX_SEGMENT_LENGTH
    ? cleaned.slice(0, MAX_SEGMENT_LENGTH).trim()
    : cleaned;
}

/** Имя файла режется по основе, чтобы расширение осталось на месте. */
export function sanitizeFileName(value: string, fallback = 'файл'): string {
  const cleaned = value
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) return fallback;
  const dot = cleaned.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < cleaned.length - 1 && cleaned.length - dot <= 12;
  const base = hasExtension ? cleaned.slice(0, dot) : cleaned;
  const extension = hasExtension ? cleaned.slice(dot).toLowerCase() : '';
  const safeBase = sanitizePathSegment(base, fallback).slice(0, MAX_SEGMENT_LENGTH);
  return `${safeBase || fallback}${extension}`;
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/gu, '');
  return trimmed ? `${trimmed}/` : '';
}

/** Не проверенные антивирусом байты. Идентификатор в пути делает ключ уникальным. */
export function incomingObjectKey(
  prefix: string,
  input: { readonly uploadId: string; readonly fileName: string; readonly now?: Date },
): string {
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  return `${normalizePrefix(prefix)}incoming/${day}/${input.uploadId}/${sanitizeFileName(input.fileName)}`;
}

/** Проверенный файл, который ещё не привязан к артефакту или рассылке. */
export function checkedObjectKey(
  prefix: string,
  input: { readonly fileObjectId: string; readonly fileName: string },
): string {
  return `${normalizePrefix(prefix)}checked/${input.fileObjectId}/${sanitizeFileName(input.fileName)}`;
}

/** Итоговое место артефакта: мероприятие, участник, файл. */
export function artifactObjectKey(
  prefix: string,
  input: {
    readonly eventName: string | null;
    readonly personName: string;
    readonly fileName: string;
  },
): string {
  const event = sanitizePathSegment(input.eventName ?? '', 'Без мероприятия');
  const person = sanitizePathSegment(input.personName, 'Без участника');
  return `${normalizePrefix(prefix)}artifacts/${event}/${person}/${sanitizeFileName(input.fileName)}`;
}

/** Вложение рассылки лежит рядом со своей рассылкой. */
export function campaignObjectKey(
  prefix: string,
  input: { readonly campaignName: string; readonly fileName: string },
): string {
  return `${normalizePrefix(prefix)}campaigns/${sanitizePathSegment(input.campaignName, 'Без названия')}/${sanitizeFileName(input.fileName)}`;
}

/** Занятое имя разводится суффиксом, как это делает проводник. */
export function withCopySuffix(objectKey: string, attempt: number): string {
  if (attempt <= 1) return objectKey;
  const slash = objectKey.lastIndexOf('/');
  const directory = objectKey.slice(0, slash + 1);
  const name = objectKey.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1 && name.length - dot <= 12;
  const base = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';
  return `${directory}${base} (${String(attempt)})${extension}`;
}

/** Проверка принадлежности ключа своему разделу: чужие байты сканировать нельзя. */
export function isInsideSection(objectKey: string, prefix: string, section: string): boolean {
  return objectKey.startsWith(`${normalizePrefix(prefix)}${section}/`);
}
