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
          projects: [{ name: 'Робот-садовник', role: 'Основатель' }],
        },
      ],
      projects: [
        {
          id: 'project-1',
          name: 'Робот-садовник',
          description: 'Автоматизация теплиц',
          status: 'ACTIVE',
          ownerName: 'Иванов Иван Иванович',
          decision: 'ACCEPTED',
          attendance: 'ATTENDED',
          result: 'Финалист',
          registeredAt: '2026-08-24T10:00:00.000Z',
          members: [
            {
              personId: 'person-1',
              personName: 'Иванов Иван Иванович',
              role: 'Основатель',
              isOwner: true,
            },
          ],
          artifacts: [
            {
              artifactId: 'artifact-1',
              title: 'Презентация проекта',
              typeName: 'Презентация',
              status: 'SUBMITTED',
              authors: 'Иванов Иван Иванович',
              archivePaths: 'Проекты/Робот-садовник/Артефакты/Презентация/Описание.txt',
            },
          ],
        },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const exported = workbook.getWorksheet('Участники')!;
    expect(exported.getRow(1).getCell(14).text).toBe('Проекты в мероприятии');
    expect(exported.getRow(2).getCell(14).text).toBe('Робот-садовник');
    expect(exported.getRow(2).getCell(15).text).toBe('Основатель');
    expect(workbook.getWorksheet('Проекты')?.getRow(2).getCell(3).text).toBe('Робот-садовник');
    expect(workbook.getWorksheet('Участники проектов')?.getRow(2).getCell(5).text).toBe(
      'Основатель',
    );
    expect(workbook.getWorksheet('Артефакты проектов')?.getRow(2).getCell(4).text).toBe(
      'Презентация проекта',
    );
    const parsed = await readEventAttendanceWorkbook(bytes);
    expect(parsed.people[0]).toMatchObject({
      lastName: 'Иванов',
      firstName: 'Иван',
      patronymic: 'Иванович',
    });
  });
});
