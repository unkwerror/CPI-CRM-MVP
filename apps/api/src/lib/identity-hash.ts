import { createHash } from 'node:crypto';

/**
 * Отпечатки удалённого участника.
 *
 * После безвозвратного удаления сверять новые записи не с чем: карточки и
 * контактов больше нет. Поэтому храним sha256 от нормализованных значений с
 * префиксом вида, чтобы телефон и Telegram ID с одинаковыми цифрами не совпали.
 */
export type IdentityKind =
  'EMAIL' | 'PHONE' | 'TELEGRAM' | 'TELEGRAM_ID' | 'MAX_ID' | 'LOCKER_USER' | 'NAME';

export function hashIdentityKey(kind: IdentityKind, value: string): string {
  return createHash('sha256').update(`${kind}:${value.trim().toLowerCase()}`).digest('hex');
}
