import { describe, expect, it } from 'vitest';

import { extractPersonAttributes } from '../src/attributes.js';
import type { SerializedCell } from '../src/types.js';

function cell(column: number, header: string | null, value: string): SerializedCell {
  return {
    column,
    address: `C${column}`,
    header,
    kind: 'string',
    value,
    numberFormat: null,
    displayText: value,
  };
}

describe('extractPersonAttributes', () => {
  it('maps curated headers to semantic fields', () => {
    const attributes = extractPersonAttributes(
      {
        sheetName: 'Каталист 2025',
        cells: [
          cell(1, '№', '77'),
          cell(2, 'ФИО', 'Иванов Иван'),
          cell(3, 'Возраст', '21'),
          cell(4, 'Компания', 'ООО Ромашка'),
          cell(5, 'Должность', 'Аналитик'),
          cell(6, 'Город', 'Новосибирск'),
          cell(7, 'Место учебы', 'НГУ'),
          cell(8, 'Статус заявки', 'Одобрена'),
          cell(9, 'Дата посещения', '15.10.2025'),
          cell(10, 'Email', 'ivanov@example.com'),
          cell(11, 'Мероприятие', 'Каталист'),
        ],
      },
      'person-1',
    );

    const byField = new Map(attributes.map((attr) => [attr.field, attr]));
    expect(byField.get('age')?.value).toBe('21');
    expect(byField.get('company')?.value).toBe('ООО Ромашка');
    expect(byField.get('jobTitle')?.value).toBe('Аналитик');
    expect(byField.get('city')?.value).toBe('Новосибирск');
    expect(byField.get('university')?.label).toBe('Вуз / место учёбы');
    expect(byField.get('applicationStatus')?.value).toBe('Одобрена');
    expect(byField.get('attendanceDate')?.value).toBe('15.10.2025');
    // Names, contacts, identifiers and the event column never become attributes.
    expect(attributes.some((attr) => attr.value === 'Иванов Иван')).toBe(false);
    expect(attributes.some((attr) => attr.value === 'ivanov@example.com')).toBe(false);
    expect(attributes.some((attr) => attr.value === '77')).toBe(false);
    expect(attributes.some((attr) => attr.value === 'Каталист')).toBe(false);
  });

  it('keeps unmapped participant columns as labelled "other" attributes', () => {
    const attributes = extractPersonAttributes(
      {
        sheetName: 'Студстартапы 2025',
        cells: [
          cell(1, 'Победители', 'да'),
          cell(2, 'Принимаю условия обработки персональных данных', 'да'),
          cell(3, 'СНИЛС', '123-456-789 00'),
        ],
      },
      'person-1',
    );

    expect(attributes).toEqual([{ field: 'other', label: 'Победители', value: 'да' }]);
  });

  it('scopes Lynch attributes to the requested slot and shares project columns', () => {
    const row = {
      sheetName: 'Регистрации Линч',
      cells: [
        cell(3, 'ФИО', 'Первый Участник'),
        cell(5, 'Является студентом, аспирантом или ординатором НГУ', 'Да'),
        cell(6, 'Факультет/Кафедра', 'ФФ'),
        cell(7, 'Уровень высшего образования', 'Бакалавриат'),
        cell(8, 'Курс', '3'),
        cell(9, 'ФИО', 'Второй Участник'),
        cell(12, 'Факультет', 'ММФ'),
        cell(28, 'Примечания', 'придут вдвоём'),
        cell(29, 'Название проекта', 'Нейродиагностика'),
      ],
    };

    const first = extractPersonAttributes(row, 'person-1');
    expect(first).toContainEqual({ field: 'faculty', label: 'Факультет', value: 'ФФ' });
    expect(first).toContainEqual({ field: 'courseYear', label: 'Курс', value: '3' });
    expect(first).toContainEqual({
      field: 'projectName',
      label: 'Название проекта',
      value: 'Нейродиагностика',
    });
    expect(first).toContainEqual({ field: 'note', label: 'Комментарий', value: 'придут вдвоём' });

    const second = extractPersonAttributes(row, 'person-2');
    expect(second).toContainEqual({ field: 'faculty', label: 'Факультет', value: 'ММФ' });
    expect(second.some((attr) => attr.value === 'ФФ')).toBe(false);
  });

  it('ignores formulas, empty values and cells without headers', () => {
    const attributes = extractPersonAttributes(
      {
        sheetName: 'Лист',
        cells: [
          {
            column: 1,
            address: 'A1',
            header: 'Комментарий',
            kind: 'formula',
            value: { expression: '=HYPERLINK("http://x")' },
            numberFormat: null,
            displayText: null,
          },
          cell(2, 'Комментарии', '   '),
          cell(3, null, 'бесхозное значение'),
        ],
      },
      'person-1',
    );
    expect(attributes).toEqual([]);
  });
});
