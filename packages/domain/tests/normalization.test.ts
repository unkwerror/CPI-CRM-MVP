import { describe, expect, it } from 'vitest';

import {
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
  normalizeTelegramContact,
  normalizeTelegramUsername,
} from '../src/normalization.js';

describe('contact and name normalization', () => {
  it('uses NFKC, lowercase, collapsed spaces and ё → е for name search', () => {
    expect(normalizeFullName('  АЛЁНА\t  Ёлкина  ')).toBe('алена елкина');
    expect(normalizeFullName('Иван ＩＶ')).toBe('иван iv');
  });

  it('normalizes email without removing dots or +tags', () => {
    expect(normalizeEmail('  User.Name+CRM@Example.COM ')).toBe('user.name+crm@example.com');
  });

  it.each([
    ['+7 (913) 123-45-67', '+79131234567'],
    ['8 913 123 45 67', '+79131234567'],
    ['9131234567', '+79131234567'],
    ['=+79131234567', '+79131234567'],
    ['00442079460958', '+442079460958'],
  ])('normalizes %s to E.164', (raw, expected) => {
    expect(normalizePhone(raw)?.e164).toBe(expected);
  });

  it('provides last-ten-digits search only for Russian numbers', () => {
    expect(normalizePhone('+79131234567')?.searchKeys).toEqual(['+79131234567', '9131234567']);
    expect(normalizePhone('+442079460958')?.searchKeys).toEqual(['+442079460958']);
    expect(normalizePhone('not a phone')).toBeNull();
  });

  it.each([
    ['@Yadro_CPI', 'yadro_cpi'],
    ['t.me/Yadro_CPI', 'yadro_cpi'],
    ['https://t.me/Yadro_CPI?start=crm', 'yadro_cpi'],
  ])('normalizes Telegram username from %s', (raw, expected) => {
    expect(normalizeTelegramUsername(raw)).toBe(expected);
  });

  it('keeps Telegram raw value and stable ID separate from username', () => {
    expect(normalizeTelegramContact({ raw: '@Yadro_CPI', stableId: 123456789n })).toEqual({
      raw: '@Yadro_CPI',
      username: 'yadro_cpi',
      stableId: '123456789',
    });
  });
});
