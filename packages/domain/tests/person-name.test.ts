import { describe, expect, it } from 'vitest';

import {
  assessParticipantComment,
  buildRussianFullName,
  parseRussianFullName,
} from '../src/person-name.js';

describe('strict Russian participant identity', () => {
  it('splits, normalizes case and preserves a hyphenated component', () => {
    expect(parseRussianFullName('  петрова-сидорова   АННА  сергеевна ')).toEqual({
      lastName: 'Петрова-Сидорова',
      firstName: 'Анна',
      patronymic: 'Сергеевна',
      canonicalFullName: 'Петрова-Сидорова Анна Сергеевна',
      normalizedFullName: 'петрова-сидорова анна сергеевна',
    });
  });

  it.each([
    'Иван Иванов',
    'Иванов Иван Иванович Иванович',
    'Titenko Alina Sergeevna',
    'Иванов Иван Sergeevich',
    'Иванов Иван И.',
  ])('rejects a non-conforming identity: %s', (value) => {
    expect(parseRussianFullName(value)).toBeNull();
  });

  it('builds a name only from three valid separate components', () => {
    expect(
      buildRussianFullName({ lastName: 'Иванов', firstName: 'Иван', patronymic: 'Иванович' }),
    )?.toMatchObject({ canonicalFullName: 'Иванов Иван Иванович' });
    expect(
      buildRussianFullName({ lastName: 'Иванов', firstName: 'Иван  Пётр', patronymic: 'Иванович' }),
    ).toBeNull();
  });
});

describe('participant comments', () => {
  it('normalizes line endings and trims a meaningful comment', () => {
    expect(assessParticipantComment('  Проект: Робот\r\nГород: Новосибирск  ')).toEqual({
      accepted: true,
      value: 'Проект: Робот\nГород: Новосибирск',
    });
  });

  it.each(['нет', '---', '\u0000Комментарий'])('rejects invalid comment %j', (value) => {
    expect(assessParticipantComment(value).accepted).toBe(false);
  });

  it('maps an empty comment to null', () => {
    expect(assessParticipantComment('   ')).toEqual({ accepted: true, value: null });
  });
});
