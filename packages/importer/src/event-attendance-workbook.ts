import { parseRussianFullName } from '@cpi-crm/domain';
import ExcelJS from 'exceljs';

const MAX_ATTENDANCE_ROWS = 5_000;

export interface AttendanceWorkbookPerson {
  readonly rowNumber: number;
  readonly rawFullName: string;
  readonly lastName: string | null;
  readonly firstName: string | null;
  readonly patronymic: string | null;
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

/**
 * Артефакт участника в выгрузке.
 *
 * `archivePath` — относительный путь внутри ZIP-пакета; по нему в таблице
 * строится формула HYPERLINK, которая работает после распаковки архива.
 */
export interface EventParticipantWorkbookArtifact {
  readonly title: string;
  readonly typeName: string;
  readonly score?: number | null;
  readonly decision?: string | null;
  readonly result?: string | null;
  readonly submittedAt?: string | null;
  readonly fileName?: string | null;
  readonly archivePath?: string | null;
  readonly externalUrl?: string | null;
}

export interface EventParticipantWorkbookRow {
  readonly number: number;
  readonly lastName: string | null;
  readonly firstName: string | null;
  readonly patronymic: string | null;
  readonly canonicalFullName: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly telegram?: string | null;
  readonly telegramUserId?: string | null;
  readonly attended?: boolean | null;
  readonly decision?: string | null;
  readonly result?: string | null;
  readonly eventName: string;
  readonly projects?: readonly { readonly name: string; readonly role: string }[];
  readonly artifacts?: readonly EventParticipantWorkbookArtifact[];
}

export interface EventParticipantWorkbookProject {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status: string;
  readonly ownerName?: string | null;
  readonly decision?: string | null;
  readonly attendance?: string | null;
  readonly result?: string | null;
  readonly registeredAt?: string | null;
  readonly members: readonly {
    readonly personId: string;
    readonly personName: string;
    readonly role: string;
    readonly isOwner?: boolean;
  }[];
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly title: string;
    readonly typeName: string;
    readonly status: string;
    readonly versionStatus?: string | null;
    readonly submittedAt?: string | null;
    readonly authors?: string | null;
    readonly eventName?: string | null;
    readonly score?: number | null;
    readonly decision?: string | null;
    readonly externalUrls?: string | null;
    readonly archivePaths?: string | null;
  }[];
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

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF335C4A' },
};

function styleSheet(worksheet: ExcelJS.Worksheet, widths: readonly number[]): void {
  const lastColumn = String.fromCharCode(64 + widths.length);
  worksheet.autoFilter = { from: 'A1', to: `${lastColumn}${Math.max(1, worksheet.rowCount)}` };
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  worksheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 20;
  });
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getRow(rowNumber).alignment = { vertical: 'top', wrapText: true };
  }
}

/**
 * Относительная ссылка на файл внутри распакованного архива.
 *
 * В формате XLSX разделитель аргументов всегда запятая, независимо от того,
 * что показывает Excel в русской локали.
 */
function hyperlinkCell(archivePath: string, label: string): ExcelJS.CellFormulaValue {
  const escape = (value: string) => value.replaceAll('"', '""');
  return {
    formula: `HYPERLINK("${escape(archivePath)}","${escape(label)}")`,
    result: label,
  };
}

function artifactSummary(artifacts: readonly EventParticipantWorkbookArtifact[]): string {
  return artifacts.map((artifact) => artifact.title).join('\n');
}

function scoreSummary(artifacts: readonly EventParticipantWorkbookArtifact[]): string {
  return artifacts
    .map((artifact) =>
      artifact.score === null || artifact.score === undefined ? '—' : String(artifact.score),
    )
    .join('\n');
}

function decisionSummary(artifacts: readonly EventParticipantWorkbookArtifact[]): string {
  return artifacts.map((artifact) => reviewDecisionLabel(artifact.decision)).join('\n');
}

function reviewDecisionLabel(decision: string | null | undefined): string {
  if (decision === 'ACCEPTED') return 'Принят';
  if (decision === 'REJECTED') return 'Не принят';
  if (decision === 'NEEDS_REVISION') return 'На доработку';
  return 'Не оценён';
}

export async function createEventParticipantsWorkbook(input: {
  readonly eventName: string;
  readonly rows: readonly EventParticipantWorkbookRow[];
  readonly projects?: readonly EventParticipantWorkbookProject[];
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
    'Результат участия',
    'Мероприятия',
    'Проекты в мероприятии',
    'Роли в проектах',
    'Артефакты',
    'Оценка',
    'Решение',
    'Файл',
  ];
  worksheet.addRow(headers);
  for (const row of input.rows) {
    const artifacts = row.artifacts ?? [];
    const projects = row.projects ?? [];
    const linkable = artifacts.find((artifact) => artifact.archivePath);
    const added = worksheet.addRow([
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
      safeSpreadsheetText(row.result),
      safeSpreadsheetText(row.eventName),
      projects.map((project) => safeSpreadsheetText(project.name)).join('\n'),
      projects.map((project) => safeSpreadsheetText(project.role)).join('\n'),
      artifactSummary(artifacts),
      scoreSummary(artifacts),
      decisionSummary(artifacts),
      linkable?.archivePath
        ? hyperlinkCell(linkable.archivePath, linkable.fileName ?? 'Открыть файл')
        : '',
    ]);
    if (linkable?.archivePath) {
      added.getCell(19).font = { color: { argb: 'FF1F5FBF' }, underline: true };
    }
  }
  styleSheet(
    worksheet,
    [8, 38, 22, 20, 24, 30, 22, 24, 18, 24, 20, 44, 42, 34, 28, 40, 12, 18, 34],
  );

  const allArtifacts = input.rows.flatMap((row) =>
    (row.artifacts ?? []).map((artifact) => ({ row, artifact })),
  );
  if (allArtifacts.length > 0) {
    const artifactSheet = workbook.addWorksheet('Артефакты', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    artifactSheet.addRow([
      '№',
      'Автор',
      'Артефакт',
      'Тип',
      'Отправлен',
      'Оценка',
      'Решение',
      'Файл',
      'Ссылка',
    ]);
    allArtifacts.forEach(({ row, artifact }, index) => {
      const added = artifactSheet.addRow([
        index + 1,
        safeSpreadsheetText(row.canonicalFullName),
        safeSpreadsheetText(artifact.title),
        safeSpreadsheetText(artifact.typeName),
        safeSpreadsheetText(artifact.submittedAt),
        artifact.score ?? '',
        reviewDecisionLabel(artifact.decision),
        artifact.archivePath
          ? hyperlinkCell(artifact.archivePath, artifact.fileName ?? 'Открыть файл')
          : safeSpreadsheetText(artifact.fileName),
        safeSpreadsheetText(artifact.externalUrl),
      ]);
      if (artifact.archivePath) {
        added.getCell(8).font = { color: { argb: 'FF1F5FBF' }, underline: true };
      }
    });
    styleSheet(artifactSheet, [8, 34, 40, 22, 22, 12, 18, 40, 44]);
  }

  const projects = input.projects ?? [];
  if (projects.length > 0) {
    const projectSheet = workbook.addWorksheet('Проекты', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    projectSheet.addRow([
      '№',
      'ID проекта',
      'Проект',
      'Описание',
      'Статус проекта',
      'Владелец',
      'Решение по мероприятию',
      'Участие',
      'Результат',
      'Добавлен в мероприятие',
      'Участников',
      'Артефактов',
    ]);
    projects.forEach((project, index) => {
      projectSheet.addRow([
        index + 1,
        project.id,
        safeSpreadsheetText(project.name),
        safeSpreadsheetText(project.description),
        safeSpreadsheetText(project.status),
        safeSpreadsheetText(project.ownerName),
        safeSpreadsheetText(project.decision),
        safeSpreadsheetText(project.attendance),
        safeSpreadsheetText(project.result),
        safeSpreadsheetText(project.registeredAt),
        project.members.length,
        project.artifacts.length,
      ]);
    });
    styleSheet(projectSheet, [8, 38, 38, 55, 18, 34, 24, 18, 60, 24, 14, 14]);

    const memberSheet = workbook.addWorksheet('Участники проектов', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    memberSheet.addRow(['№', 'Проект', 'ID участника', 'Участник', 'Роль', 'Владелец проекта']);
    let memberNumber = 0;
    for (const project of projects) {
      for (const member of project.members) {
        memberNumber += 1;
        memberSheet.addRow([
          memberNumber,
          safeSpreadsheetText(project.name),
          member.personId,
          safeSpreadsheetText(member.personName),
          safeSpreadsheetText(member.role),
          member.isOwner ? 'Да' : 'Нет',
        ]);
      }
    }
    styleSheet(memberSheet, [8, 38, 38, 38, 34, 20]);

    const projectArtifactSheet = workbook.addWorksheet('Артефакты проектов', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    projectArtifactSheet.addRow([
      '№',
      'Проект',
      'ID артефакта',
      'Артефакт',
      'Тип',
      'Статус',
      'Статус версии',
      'Отправлен',
      'Авторы',
      'Связанное мероприятие',
      'Оценка 1–10',
      'Решение',
      'Внешние ссылки',
      'Файлы в ZIP',
    ]);
    let projectArtifactNumber = 0;
    for (const project of projects) {
      for (const artifact of project.artifacts) {
        projectArtifactNumber += 1;
        projectArtifactSheet.addRow([
          projectArtifactNumber,
          safeSpreadsheetText(project.name),
          artifact.artifactId,
          safeSpreadsheetText(artifact.title),
          safeSpreadsheetText(artifact.typeName),
          safeSpreadsheetText(artifact.status),
          safeSpreadsheetText(artifact.versionStatus),
          safeSpreadsheetText(artifact.submittedAt),
          safeSpreadsheetText(artifact.authors),
          safeSpreadsheetText(artifact.eventName),
          artifact.score ?? '',
          safeSpreadsheetText(artifact.decision),
          safeSpreadsheetText(artifact.externalUrls),
          safeSpreadsheetText(artifact.archivePaths),
        ]);
      }
    }
    styleSheet(projectArtifactSheet, [8, 36, 38, 42, 22, 18, 20, 24, 42, 38, 14, 18, 48, 60]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
