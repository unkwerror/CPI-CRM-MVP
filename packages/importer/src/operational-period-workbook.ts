import ExcelJS from 'exceljs';

import {
  addParticipantsWorksheet,
  type ParticipantWorkbookRow,
} from './participants-export-workbook.js';

export interface OperationalPeriodWorkbookInput {
  readonly period: { from: string; to: string };
  readonly summary: readonly {
    label: string;
    value: string | number;
    note?: string | null;
  }[];
  readonly quality: {
    reviewed: number;
    awaitingReview: number;
    accepted: number;
    rejected: number;
    averageScore?: number | null;
    medianScore?: number | null;
    scoreDistribution: readonly { score: number; count: number }[];
  };
  readonly artifacts: readonly {
    versionId: string;
    artifactId: string;
    submittedAt: string;
    title: string;
    typeName: string;
    authors: string;
    eventName?: string | null;
    projectName?: string | null;
    source: string;
    score?: number | null;
    decision?: string | null;
    externalUrls?: string | null;
    archivePaths?: string | null;
    archiveFiles?: readonly {
      fileName: string;
      /** Путь от XLSX до файла внутри распакованного ZIP-пакета. */
      relativePath: string;
      /** Путь от корня ZIP для отображения в таблице. */
      archivePath: string;
    }[];
  }[];
  readonly people: readonly ParticipantWorkbookRow[];
  readonly tasks: readonly {
    id: string;
    createdAt: string;
    completedAt?: string | null;
    status: string;
    title: string;
    personName?: string | null;
    assigneeName?: string | null;
    dueAt?: string | null;
    attachments?: string | null;
  }[];
  readonly events: readonly {
    id: string;
    eventName: string;
    personName: string;
    createdAt: string;
    decision: string;
    attendance: string;
    result?: string | null;
    source: string;
  }[];
  readonly interactions: readonly {
    id: string;
    occurredAt: string;
    personName: string;
    channel: string;
    direction: string;
    outcome?: string | null;
    comment?: string | null;
    responsibleName?: string | null;
    nextContactAt?: string | null;
    attachments?: string | null;
  }[];
  readonly projects: readonly {
    id: string;
    name: string;
    status: string;
    description?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    ownerName?: string | null;
    memberCount: number;
    artifactCount: number;
    eventCount: number;
  }[];
  readonly projectMembers: readonly {
    projectId: string;
    projectName: string;
    personId: string;
    personName: string;
    role: string;
    joinedAt: string;
  }[];
  readonly projectArtifacts: readonly {
    projectId: string;
    projectName: string;
    artifactId: string;
    title: string;
    typeName: string;
    status: string;
    latestVersionStatus?: string | null;
    submittedAt?: string | null;
    authors: string;
    eventName?: string | null;
    score?: number | null;
    decision?: string | null;
  }[];
  readonly projectEvents: readonly {
    projectId: string;
    projectName: string;
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

function safe(value: string | number | boolean | null | undefined): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  return /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function styleSheet(sheet: ExcelJS.Worksheet, widths: readonly number[]): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.rowCount > 0 && widths.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: widths.length },
    };
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 20;
  });
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getRow(row).alignment = { vertical: 'top', wrapText: true };
  }
}

function addTable(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
  widths: readonly number[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row.map(safe));
  styleSheet(sheet, widths);
}

/**
 * В XLSX разделитель аргументов формулы всегда запятая, в том числе в русской
 * версии Excel. Кавычки удваиваются, чтобы имена файлов не меняли формулу.
 */
function hyperlinkCell(relativePath: string, label: string): ExcelJS.CellFormulaValue {
  const escape = (value: string) => value.replaceAll('"', '""');
  return {
    formula: `HYPERLINK("${escape(relativePath)}","${escape(label)}")`,
    result: label,
  };
}

function addArtifactsTable(
  workbook: ExcelJS.Workbook,
  artifacts: OperationalPeriodWorkbookInput['artifacts'],
): void {
  const sheet = workbook.addWorksheet('Артефакты');
  sheet.addRow([
    'ID версии',
    'ID артефакта',
    'Дата отправки',
    'Название',
    'Тип',
    'Авторы',
    'Проект',
    'Мероприятие',
    'Источник',
    'Оценка 1–10',
    'Решение',
    'Внешние ссылки',
    'Файл в ZIP (ссылка)',
    'Путь внутри ZIP',
  ]);

  for (const item of artifacts) {
    const archiveFiles = item.archiveFiles ?? [];
    const files = archiveFiles.length > 0 ? archiveFiles : [null];
    for (const file of files) {
      const row = sheet.addRow([
        safe(item.versionId),
        safe(item.artifactId),
        safe(item.submittedAt),
        safe(item.title),
        safe(item.typeName),
        safe(item.authors),
        safe(item.projectName),
        safe(item.eventName),
        safe(item.source),
        safe(item.score),
        safe(item.decision),
        safe(item.externalUrls),
        file ? hyperlinkCell(file.relativePath, file.fileName) : safe(item.archivePaths),
        safe(file?.archivePath),
      ]);
      if (file) row.getCell(13).font = { color: { argb: 'FF1F5FBF' }, underline: true };
    }
  }

  styleSheet(sheet, [38, 38, 24, 42, 24, 38, 34, 34, 14, 14, 18, 44, 44, 72]);
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  period: OperationalPeriodWorkbookInput['period'],
  summary: OperationalPeriodWorkbookInput['summary'],
  quality: OperationalPeriodWorkbookInput['quality'],
): void {
  const sheet = workbook.addWorksheet('Сводка');
  sheet.addRow(['Показатель', 'Значение', 'Комментарий']);
  sheet.addRow(['Период', `${period.from} — ${period.to}`, '']);
  for (const item of summary) sheet.addRow([safe(item.label), safe(item.value), safe(item.note)]);

  const reviewed = Math.max(0, quality.reviewed);
  const reviewTotal = reviewed + Math.max(0, quality.awaitingReview);
  const metrics: readonly (readonly [string, string | number])[] = [
    ['Средняя оценка', quality.averageScore?.toFixed(2) ?? '—'],
    ['Медианная оценка', quality.medianScore?.toFixed(2) ?? '—'],
    ['Оценено', quality.reviewed],
    ['Ждут оценки', quality.awaitingReview],
    [
      'Покрытие оценкой',
      reviewTotal ? `${((quality.reviewed / reviewTotal) * 100).toFixed(1)}%` : '—',
    ],
    ['Принято', quality.accepted],
    ['Не принято', quality.rejected],
  ];
  sheet.addRow([]);
  const qualityHeaderRow = sheet.addRow([
    'Качество артефактов: оценка 1–10',
    'Количество',
    'Доля оценённых',
    'Показатель',
    'Значение',
  ]);
  qualityHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  qualityHeaderRow.fill = HEADER_FILL;
  qualityHeaderRow.alignment = { vertical: 'middle', wrapText: true };
  qualityHeaderRow.height = 34;

  const distribution = Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    const count = quality.scoreDistribution.find((item) => item.score === score)?.count ?? 0;
    return [
      score,
      count,
      reviewed ? `${((count / reviewed) * 100).toFixed(1)}%` : '0.0%',
      metrics[index]?.[0] ?? '',
      metrics[index]?.[1] ?? '',
    ] as const;
  });
  for (const row of distribution) sheet.addRow(row.map(safe));

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const firstHeader = sheet.getRow(1);
  firstHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  firstHeader.fill = HEADER_FILL;
  firstHeader.alignment = { vertical: 'middle', wrapText: true };
  firstHeader.height = 34;
  [42, 24, 58, 28, 18].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getRow(row).alignment = { vertical: 'top', wrapText: true };
  }
}

function addWorkSheet(workbook: ExcelJS.Workbook, input: OperationalPeriodWorkbookInput): void {
  addTable(
    workbook,
    'Работа CRM',
    [
      'Тип строки',
      'ID',
      'Дата',
      'Завершено',
      'Участник',
      'Задача / канал',
      'Статус / направление',
      'Результат',
      'Комментарий',
      'Исполнитель / ответственный',
      'Срок / следующий контакт',
      'Файлы',
    ],
    [
      ...input.tasks.map((item) => [
        'Задача',
        item.id,
        item.createdAt,
        item.completedAt,
        item.personName,
        item.title,
        item.status,
        '',
        '',
        item.assigneeName,
        item.dueAt,
        item.attachments,
      ]),
      ...input.interactions.map((item) => [
        'Взаимодействие',
        item.id,
        item.occurredAt,
        '',
        item.personName,
        item.channel,
        item.direction,
        item.outcome,
        item.comment,
        item.responsibleName,
        item.nextContactAt,
        item.attachments,
      ]),
    ],
    [20, 38, 24, 24, 38, 48, 24, 40, 58, 30, 26, 46],
  );
}

function addProjectsSheet(workbook: ExcelJS.Workbook, input: OperationalPeriodWorkbookInput): void {
  addTable(
    workbook,
    'Проекты',
    [
      'Тип строки',
      'ID проекта',
      'Проект',
      'Статус проекта',
      'Описание',
      'Начало',
      'Окончание',
      'Ответственный',
      'Участников',
      'Артефактов',
      'Мероприятий',
      'ID объекта',
      'Объект / участник',
      'Роль / тип артефакта',
      'Добавлен / отправлен',
      'Статус объекта',
      'Решение',
      'Посещение / оценка',
      'Результат',
      'Авторы / связанное мероприятие',
    ],
    [
      ...input.projects.map((item) => [
        'Проект',
        item.id,
        item.name,
        item.status,
        item.description,
        item.startsAt,
        item.endsAt,
        item.ownerName,
        item.memberCount,
        item.artifactCount,
        item.eventCount,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]),
      ...input.projectMembers.map((item) => [
        'Участник проекта',
        item.projectId,
        item.projectName,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        item.personId,
        item.personName,
        item.role,
        item.joinedAt,
        '',
        '',
        '',
        '',
        '',
      ]),
      ...input.projectArtifacts.map((item) => [
        'Артефакт проекта',
        item.projectId,
        item.projectName,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        item.artifactId,
        item.title,
        item.typeName,
        item.submittedAt,
        [item.status, item.latestVersionStatus].filter(Boolean).join(' / '),
        item.decision,
        item.score,
        '',
        [item.authors, item.eventName].filter(Boolean).join(' · '),
      ]),
      ...input.projectEvents.map((item) => [
        'Мероприятие проекта',
        item.projectId,
        item.projectName,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        item.eventId,
        item.eventName,
        '',
        item.registeredAt,
        '',
        item.decision,
        item.attendance,
        item.result,
        '',
      ]),
    ],
    [20, 38, 40, 20, 60, 24, 24, 30, 14, 14, 14, 38, 46, 34, 26, 24, 20, 22, 58, 58],
  );
}

/** Компактный полный отчёт: шесть листов вместо разрозненных таблиц. */
export async function createOperationalPeriodWorkbook(
  input: OperationalPeriodWorkbookInput,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ЦПИ CRM';
  workbook.created = new Date();
  workbook.subject = `Операционный отчёт ${input.period.from} — ${input.period.to}`;

  addSummarySheet(workbook, input.period, input.summary, input.quality);
  addParticipantsWorksheet(workbook, input.people, 'Участники');
  addArtifactsTable(workbook, input.artifacts);
  addTable(
    workbook,
    'Мероприятия',
    [
      'ID участия',
      'Мероприятие',
      'Участник',
      'Создано',
      'Решение',
      'Посещение',
      'Результат',
      'Источник',
    ],
    input.events.map((item) => [
      item.id,
      item.eventName,
      item.personName,
      item.createdAt,
      item.decision,
      item.attendance,
      item.result,
      item.source,
    ]),
    [38, 40, 38, 24, 18, 18, 58, 18],
  );
  addProjectsSheet(workbook, input);
  addWorkSheet(workbook, input);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
