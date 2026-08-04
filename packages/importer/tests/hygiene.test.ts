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
    ['Ли', 'NOT_THREE_PART_RUSSIAN_FULL_NAME'],
    ['Мадина', 'NOT_THREE_PART_RUSSIAN_FULL_NAME'],
    ['O’Connor Siobhan', 'NOT_THREE_PART_RUSSIAN_FULL_NAME'],
    ['Жан-Пьер', 'NOT_THREE_PART_RUSSIAN_FULL_NAME'],
    ['Aлексей Иванов', 'NOT_THREE_PART_RUSSIAN_FULL_NAME'],
  ])('rejects deterministic garbage without exposing it as a person: %s', (value, reason) => {
    expect(assessPersonName(value)).toEqual({ accepted: false, reason });
  });

  it.each(['Тестов Иван Иванович', 'Петрова-Сидорова Анна Сергеевна'])(
    'keeps a complete Russian FIO: %s',
    (value) => {
      expect(assessPersonName(value)).toEqual({ accepted: true });
    },
  );
});
