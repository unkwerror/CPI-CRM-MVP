import { describe, expect, it } from 'vitest';

import { resolveLegacySubmissionDate } from '../src/legacy-artifact-dating.js';

const RECORDED_AT = new Date('2026-07-22T00:00:00.000Z');
const NOW = new Date('2026-08-08T00:00:00.000Z');

function resolve(input: {
  cells?: Array<Record<string, unknown>>;
  eventName?: string | null;
  recordedAt?: Date;
}) {
  return resolveLegacySubmissionDate({
    cells: input.cells ?? [],
    eventName: input.eventName ?? null,
    recordedAt: input.recordedAt ?? RECORDED_AT,
    now: NOW,
  });
}

describe('resolveLegacySubmissionDate', () => {
  it('takes the single date of the imported row', () => {
    const resolution = resolve({
      cells: [
        { kind: 'string', header: 'ФИО', value: 'Иванов Иван Иванович' },
        {
          kind: 'date',
          header: 'Отметка времени',
          normalizedHeader: 'отметка времени',
          value: '2021-11-27T12:29:10.594Z',
        },
      ],
    });

    expect(resolution).toEqual({
      kind: 'RESOLVED',
      date: {
        submittedAt: new Date('2021-11-27T12:29:10.594Z'),
        source: 'SOURCE_ROW_TIMESTAMP',
        evidence: 'Отметка времени',
      },
    });
  });

  it('picks the submission column when the row carries several dates', () => {
    const resolution = resolve({
      cells: [
        {
          kind: 'date',
          header: 'Дата рождения',
          normalizedHeader: 'дата рождения',
          value: '1998-03-04T00:00:00.000Z',
        },
        {
          kind: 'date',
          header: 'Время создания',
          normalizedHeader: 'время создания',
          value: '2024-05-22T15:30:51.000Z',
        },
      ],
    });

    expect(resolution).toMatchObject({
      kind: 'RESOLVED',
      date: { submittedAt: new Date('2024-05-22T15:30:51.000Z'), evidence: 'Время создания' },
    });
  });

  it('refuses to guess between unnamed dates', () => {
    const resolution = resolve({
      cells: [
        { kind: 'date', header: 'Дата рождения', value: '1998-03-04T00:00:00.000Z' },
        { kind: 'date', header: 'Дата окончания вуза', value: '2020-06-30T00:00:00.000Z' },
      ],
      eventName: 'Питч 04.2026',
    });

    expect(resolution).toEqual({ kind: 'SKIPPED', why: 'AMBIGUOUS_DATE_COLUMNS' });
  });

  it('falls back to the month written in the event name and takes its last day', () => {
    const resolution = resolve({ eventName: 'инвести_питч_студенты 04.2026' });

    expect(resolution).toEqual({
      kind: 'RESOLVED',
      date: {
        submittedAt: new Date('2026-04-30T00:00:00.000Z'),
        source: 'EVENT_NAME_MONTH',
        evidence: '04.2026',
      },
    });
  });

  it('prefers a full date in the event name over its month', () => {
    const resolution = resolve({ eventName: 'Круглый стол 27.04.2026' });

    expect(resolution).toMatchObject({
      kind: 'RESOLVED',
      date: { submittedAt: new Date('2026-04-27T00:00:00.000Z'), evidence: '27.04.2026' },
    });
  });

  it('leaves the material undated when no date exists anywhere', () => {
    expect(resolve({ eventName: 'Хакатон стартап-студии' })).toEqual({
      kind: 'SKIPPED',
      why: 'NO_DATE_IN_SOURCE_ROW',
    });
  });

  it('rejects a date later than the moment the fact entered the system', () => {
    const resolution = resolve({
      cells: [{ kind: 'date', header: 'Отметка времени', value: '2026-07-30T00:00:00.000Z' }],
    });

    expect(resolution).toEqual({ kind: 'SKIPPED', why: 'DATE_OUT_OF_RANGE' });
  });

  it('rejects a placeholder year that cannot be a submission', () => {
    const resolution = resolve({
      cells: [{ kind: 'date', header: 'Отметка времени', value: '1899-12-30T00:00:00.000Z' }],
    });

    expect(resolution).toEqual({ kind: 'SKIPPED', why: 'DATE_OUT_OF_RANGE' });
  });

  it('ignores a text cell that merely looks like a date', () => {
    const resolution = resolve({
      cells: [{ kind: 'string', header: 'Отметка времени', value: '27.11.2021' }],
      eventName: 'Регистрации Линч',
    });

    expect(resolution).toEqual({ kind: 'SKIPPED', why: 'NO_DATE_IN_SOURCE_ROW' });
  });
});
