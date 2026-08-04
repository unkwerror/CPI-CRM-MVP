import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  createEventParticipantsWorkbook,
  readEventAttendanceWorkbook,
} from '../src/event-attendance-workbook.js';

describe('event attendance workbook', () => {
  it('reads only attended rows, deduplicates and rejects invalid FIO', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Посещения');
    sheet.addRow(['ФИО', 'Посещал мероприятие']);
    sheet.addRow(['Иванов Иван Иванович', 'Да']);
    sheet.addRow(['Иванов Иван Иванович', 'Да']);
    sheet.addRow(['Петров Пётр Петрович', 'Нет']);
    sheet.addRow(['Куракин Антон', 'Да']);
    sheet.addRow([{ formula: 'A2', result: 'Скрытое ФИО' }, 'Да']);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const result = await readEventAttendanceWorkbook(bytes);

    expect(result).toMatchObject({
      dataRows: 5,
      attendedRows: 4,
      duplicateAttendedRows: 1,
    });
    expect(result.people.map((person) => person.canonicalFullName)).toEqual([
      'Иванов Иван Иванович',
    ]);
    expect(result.invalidPeople.map((person) => person.rowNumber)).toEqual([5, 6]);
  });

  it('creates a compatible XLSX with separate FIO fields', async () => {
    const bytes = await createEventParticipantsWorkbook({
      eventName: 'Демо-день',
      rows: [
        {
          number: 1,
          lastName: 'Иванов',
          firstName: 'Иван',
          patronymic: 'Иванович',
          canonicalFullName: 'Иванов Иван Иванович',
          telegram: '@ivanov',
          telegramUserId: '12345',
          attended: true,
          decision: 'Принят',
          eventName: 'Демо-день',
        },
      ],
    });
    const parsed = await readEventAttendanceWorkbook(bytes);
    expect(parsed.people[0]).toMatchObject({
      lastName: 'Иванов',
      firstName: 'Иван',
      patronymic: 'Иванович',
    });
  });
});
