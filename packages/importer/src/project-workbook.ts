import ExcelJS from 'exceljs';

export interface ProjectWorkbookInput {
  project: {
    id: string;
    name: string;
    status: string;
    description?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    ownerName?: string | null;
  };
  members: readonly {
    personId: string;
    personName: string;
    role: string;
    joinedAt: string;
  }[];
  artifacts: readonly {
    artifactId: string;
    title: string;
    typeName: string;
    status: string;
    versionStatus?: string | null;
    submittedAt?: string | null;
    authors: string;
    eventName?: string | null;
    score?: number | null;
    decision?: string | null;
    externalUrls?: string | null;
    archivePaths?: string | null;
  }[];
  events: readonly {
    eventId: string;
    eventName: string;
    registeredAt: string;
    decision: string;
    attendance: string;
    result?: string | null;
  }[];
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF335C4A' },
};

function safe(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' && /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function table(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  widths: number[],
) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row.map(safe));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: headers.length },
  };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 20;
  });
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    sheet.getRow(index).alignment = { vertical: 'top', wrapText: true };
  }
}

export async function createProjectWorkbook(input: ProjectWorkbookInput): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ЦПИ CRM';
  workbook.created = new Date();
  workbook.subject = `Проект ${input.project.name}`;
  table(
    workbook,
    'Проект',
    ['Поле', 'Значение'],
    [
      ['ID', input.project.id],
      ['Название', input.project.name],
      ['Статус', input.project.status],
      ['Описание', input.project.description],
      ['Начало', input.project.startsAt],
      ['Окончание', input.project.endsAt],
      ['Ответственный', input.project.ownerName],
      ['Участники', input.members.length],
      ['Артефакты', input.artifacts.length],
      ['Мероприятия', input.events.length],
    ],
    [28, 90],
  );
  table(
    workbook,
    'Участники',
    ['ID участника', 'Участник', 'Роль', 'Добавлен'],
    input.members.map((item) => [item.personId, item.personName, item.role, item.joinedAt]),
    [38, 42, 38, 24],
  );
  table(
    workbook,
    'Артефакты',
    [
      'ID',
      'Артефакт',
      'Тип',
      'Статус',
      'Статус версии',
      'Отправлен',
      'Авторы',
      'Мероприятие',
      'Оценка 1–10',
      'Решение',
      'Внешние ссылки',
      'Файлы в ZIP',
    ],
    input.artifacts.map((item) => [
      item.artifactId,
      item.title,
      item.typeName,
      item.status,
      item.versionStatus,
      item.submittedAt,
      item.authors,
      item.eventName,
      item.score,
      item.decision,
      item.externalUrls,
      item.archivePaths,
    ]),
    [38, 42, 24, 18, 20, 24, 42, 36, 14, 18, 46, 60],
  );
  table(
    workbook,
    'Мероприятия',
    ['ID мероприятия', 'Мероприятие', 'Добавлен', 'Решение', 'Посещение', 'Результат'],
    input.events.map((item) => [
      item.eventId,
      item.eventName,
      item.registeredAt,
      item.decision,
      item.attendance,
      item.result,
    ]),
    [38, 44, 24, 18, 18, 60],
  );
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
