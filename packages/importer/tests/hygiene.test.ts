import { describe, expect, it } from 'vitest';

import { assessPersonName } from '../src/hygiene.js';

describe('person name hygiene', () => {
  it.each([
    ['', 'MISSING_OR_GENERATED_PLACEHOLDER'],
    ['Неизвестный участник (Лист:2:person-1)', 'MISSING_OR_GENERATED_PLACEHOLDER'],
    ['test', 'TEST_PLACEHOLDER'],
    ['ТЕСТ-42', 'TEST_PLACEHOLDER'],
    ['абракадабра', 'GIBBERISH_PLACEHOLDER'],
    ['qwerty123', 'GIBBERISH_PLACEHOLDER'],
    ['не указано', 'SERVICE_PLACEHOLDER'],
    ['https://example.test/person', 'URL_IN_NAME'],
    ['person@example.test', 'EMAIL_IN_NAME'],
    ['+7 (999) 000-00-00', 'PHONE_OR_NUMERIC_IN_NAME'],
    ['---', 'NO_LETTERS'],
    ['Я', 'TOO_SHORT'],
    ['ааааа', 'REPEATED_CHARACTER'],
  ])('rejects deterministic garbage without exposing it as a person: %s', (value, reason) => {
    expect(assessPersonName(value)).toEqual({ accepted: false, reason });
  });

  it.each([
    'Тестов Иван Иванович',
    'Ли',
    'Мадина',
    'O’Connor Siobhan',
    'Жан-Пьер',
    'Aлексей Иванов',
  ])('keeps uncommon but plausible names: %s', (value) => {
    expect(assessPersonName(value)).toEqual({ accepted: true });
  });
});
