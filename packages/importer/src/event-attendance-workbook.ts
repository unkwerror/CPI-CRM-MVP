import { parseRussianFullName } from '@cpi-crm/domain';
import ExcelJS from 'exceljs';

const MAX_ATTENDANCE_ROWS = 5_000;

export interface AttendanceWorkbookPerson {
  readonly rowNumber: number;
  readonly rawFullName: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly patronymic: string;
  readonly canonicalFullName: string;
  readonly normalizedFullName: string;
}

export interface InvalidAttendanceWorkbookPerson {
  readonly rowNumber: number;
  readonly rawFullName: string;
  readonly reason: 'INVALID_FIO';
}

export interface AttendanceWorkbookResult {
  readonly worksheetName: string;
  readonly dataRows: number;
  readonly attendedRows: number;
  readonly duplicateAttendedRows: number;
  readonly people: readonly AttendanceWorkbookPerson[];
  readonly invalidPeople: readonly InvalidAttendanceWorkbookPerson[];
}

export interface EventParticipantWorkbookRow {
  readonly number: number;
  readonly lastName: string;
  readonly firstName: string;
  readonly patronymic: string;
  readonly canonicalFullName: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly telegram?: string | null;
  readonly telegramUserId?: string | null;
  readonly attended?: boolean | null;
  readonly decision?: string | null;
  readonly eventName: string;
}

function normalizedHeader(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^a-zа-я0-9]+/gu, ' ')
    .trim();
}

function plainCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).normalize('NFKC').trim();
  }
  if (value instanceof Date) return value.toISOString();
  if ('formula' in value || 'sharedFormula' in value) return '';
  if ('richText' in value)
    return value.richText
      .map((item) => item.text)
      .join('')
      .trim();
  if ('text' in value) return value.text.trim();
  return '';
}

function isAttended(value: string): boolean {
  return /^(?:да|yes|true|1|\+|посетил(?:а)?|участвовал(?:а)?)$/iu.test(value.trim());
}

export async function readEventAttendanceWorkbook(
  bytes: Uint8Array,
): Promise<AttendanceWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('В XLSX нет листов');

  let headerRowNumber = 0;
  let fullNameColumn = 0;
  let attendanceColumn = 0;
  for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const header = normalizedHeader(plainCellText(cell));
      if (header === 'фио' || header === 'ф и о') fullNameColumn = column;
      if (
        header === 'посещал мероприятие' ||
        header === 'посещение' ||
        header === 'присутствовал'
      ) {
        attendanceColumn = column;
      }
    });
    if (fullNameColumn > 0 && attendanceColumn > 0) {
      headerRowNumber = rowNumber;
      break;
    }
    fullNameColumn = 0;
    attendanceColumn = 0;
  }
  if (headerRowNumber === 0) {
    throw new Error('Нужны колонки «ФИО» и «Посещал мероприятие»');
  }
  if (worksheet.rowCount - headerRowNumber > MAX_ATTENDANCE_ROWS) {
    throw new Error(`В таблице может быть не больше ${MAX_ATTENDANCE_ROWS} строк`);
  }

  const people: AttendanceWorkbookPerson[] = [];
  const invalidPeople: InvalidAttendanceWorkbookPerson[] = [];
  const seenNames = new Set<string>();
  let dataRows = 0;
  let attendedRows = 0;
  let duplicateAttendedRows = 0;
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const fullName = plainCellText(worksheet.getCell(rowNumber, fullNameColumn));
    const attendance = plainCellText(worksheet.getCell(rowNumber, attendanceColumn));
    if (!fullName && !attendance) continue;
    dataRows += 1;
    if (!isAttended(attendance)) continue;
    attendedRows += 1;
    const fio = parseRussianFullName(fullName);
    if (!fio) {
      invalidPeople.push({ rowNumber, rawFullName: fullName, reason: 'INVALID_FIO' });
      continue;
    }
    if (seenNames.has(fio.normalizedFullName)) {
      duplicateAttendedRows += 1;
      continue;
    }
    seenNames.add(fio.normalizedFullName);
    people.push({ rowNumber, rawFullName: fullName, ...fio });
  }
  return Object.freeze({
    worksheetName: worksheet.name,
    dataRows,
    attendedRows,
    duplicateAttendedRows,
    people: Object.freeze(people),
    invalidPeople: Object.freeze(invalidPeople),
  });
}

function safeSpreadsheetText(value: string | null | undefined): string {
  if (!value) return '';
  return /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export async function createEventParticipantsWorkbook(input: {
  readonly eventName: string;
  readonly rows: readonly EventParticipantWorkbookRow[];
}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ЦПИ CRM';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Участники', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const headers = [
    '№',
    'ФИО',
    'Фамилия',
    'Имя',
    'Отчество',
    'Email',
    'Телефон',
    'Telegram',
    'Telegram ID',
    'Посещал мероприятие',
    'Статус заявки',
    'Мероприятия',
  ];
  worksheet.addRow(headers);
  for (const row of input.rows) {
    worksheet.addRow([
      row.number,
      safeSpreadsheetText(row.canonicalFullName),
      safeSpreadsheetText(row.lastName),
      safeSpreadsheetText(row.firstName),
      safeSpreadsheetText(row.patronymic),
      safeSpreadsheetText(row.email),
      safeSpreadsheetText(row.phone),
      safeSpreadsheetText(row.telegram),
      safeSpreadsheetText(row.telegramUserId),
      row.attended === true ? 'Да' : row.attended === false ? 'Нет' : '',
      safeSpreadsheetText(row.decision),
      safeSpreadsheetText(row.eventName),
    ]);
  }
  worksheet.autoFilter = { from: 'A1', to: `L${Math.max(1, worksheet.rowCount)}` };
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF335C4A' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  const widths = [8, 38, 22, 20, 24, 30, 22, 24, 18, 24, 20, 42];
  worksheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 20;
  });
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getRow(rowNumber).alignment = { vertical: 'top', wrapText: true };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
