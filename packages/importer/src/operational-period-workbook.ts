import ExcelJS from 'exceljs';

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
  readonly people: readonly {
    id: string;
    fullName: string;
    createdAt: string;
    source: string;
    ownerName?: string | null;
    artifactCount: number;
    profileNeedsReview: boolean;
  }[];
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
    'Файлы в ZIP',
  ]);

  for (const item of artifacts) {
    const archiveFiles = item.archiveFiles ?? [];
    const firstFile = archiveFiles[0];
    const linkLabel = firstFile
      ? archiveFiles.length === 1
        ? firstFile.fileName
        : `${firstFile.fileName} (+${archiveFiles.length - 1})`
      : null;
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
      firstFile && linkLabel
        ? hyperlinkCell(firstFile.relativePath, linkLabel)
        : safe(item.archivePaths),
    ]);
    if (firstFile) row.getCell(13).font = { color: { argb: 'FF1F5FBF' }, underline: true };
  }

  styleSheet(sheet, [38, 38, 24, 42, 24, 38, 34, 34, 14, 14, 18, 44, 58]);

  const files = artifacts.flatMap((artifact) =>
    (artifact.archiveFiles ?? []).map((file) => ({ artifact, file })),
  );
  if (files.length === 0) return;

  const fileSheet = workbook.addWorksheet('Файлы артефактов');
  fileSheet.addRow([
    'ID версии',
    'ID артефакта',
    'Дата отправки',
    'Артефакт',
    'Авторы',
    'Проект',
    'Мероприятие',
    'Файл (ссылка)',
    'Путь внутри ZIP',
  ]);
  for (const { artifact, file } of files) {
    const row = fileSheet.addRow([
      safe(artifact.versionId),
      safe(artifact.artifactId),
      safe(artifact.submittedAt),
      safe(artifact.title),
      safe(artifact.authors),
      safe(artifact.projectName),
      safe(artifact.eventName),
      hyperlinkCell(file.relativePath, file.fileName),
      safe(file.archivePath),
    ]);
    row.getCell(8).font = { color: { argb: 'FF1F5FBF' }, underline: true };
  }
  styleSheet(fileSheet, [38, 38, 24, 42, 38, 34, 34, 44, 72]);
}

function addQualityTable(
  workbook: ExcelJS.Workbook,
  quality: OperationalPeriodWorkbookInput['quality'],
): void {
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
  addTable(
    workbook,
    'Качество артефактов',
    ['Оценка 1–10', 'Количество', 'Доля оценённых', 'Показатель', 'Значение'],
    distribution,
    [18, 16, 20, 28, 18],
  );
}

/** Один XLSX вместо набора CSV: каждый набор данных остаётся на отдельном листе. */
export async function createOperationalPeriodWorkbook(
  input: OperationalPeriodWorkbookInput,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ЦПИ CRM';
  workbook.created = new Date();
  workbook.subject = `Операционный отчёт ${input.period.from} — ${input.period.to}`;

  addTable(
    workbook,
    'Сводка',
    ['Показатель', 'Значение', 'Комментарий'],
    [
      ['Период', `${input.period.from} — ${input.period.to}`, ''],
      ...input.summary.map((item) => [item.label, item.value, item.note ?? '']),
    ],
    [42, 24, 58],
  );
  addQualityTable(workbook, input.quality);
  addArtifactsTable(workbook, input.artifacts);
  addTable(
    workbook,
    'Новые участники',
    ['ID', 'ФИО / имя профиля', 'Создан', 'Источник', 'Ответственный', 'Артефактов', 'Профиль'],
    input.people.map((item) => [
      item.id,
      item.fullName,
      item.createdAt,
      item.source,
      item.ownerName,
      item.artifactCount,
      item.profileNeedsReview ? 'Нужно уточнить ФИО' : 'Заполнен',
    ]),
    [38, 38, 24, 20, 30, 14, 24],
  );
  addTable(
    workbook,
    'Задачи',
    ['ID', 'Создана', 'Завершена', 'Статус', 'Задача', 'Участник', 'Исполнитель', 'Срок', 'Файлы'],
    input.tasks.map((item) => [
      item.id,
      item.createdAt,
      item.completedAt,
      item.status,
      item.title,
      item.personName,
      item.assigneeName,
      item.dueAt,
      item.attachments,
    ]),
    [38, 24, 24, 18, 42, 36, 28, 24, 42],
  );
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
  addTable(
    workbook,
    'Взаимодействия',
    [
      'ID',
      'Дата',
      'Участник',
      'Тип',
      'Направление',
      'Результат',
      'Комментарий',
      'Ответственный',
      'Следующий контакт',
      'Файлы',
    ],
    input.interactions.map((item) => [
      item.id,
      item.occurredAt,
      item.personName,
      item.channel,
      item.direction,
      item.outcome,
      item.comment,
      item.responsibleName,
      item.nextContactAt,
      item.attachments,
    ]),
    [38, 24, 38, 18, 18, 40, 58, 28, 24, 42],
  );
  addTable(
    workbook,
    'Проекты',
    [
      'ID',
      'Проект',
      'Статус',
      'Описание',
      'Начало',
      'Окончание',
      'Ответственный',
      'Участники',
      'Артефакты',
      'Мероприятия',
    ],
    input.projects.map((item) => [
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
    ]),
    [38, 40, 18, 64, 24, 24, 30, 14, 14, 14],
  );
  addTable(
    workbook,
    'Участники проектов',
    ['ID проекта', 'Проект', 'ID участника', 'Участник', 'Роль', 'Добавлен в проект'],
    input.projectMembers.map((item) => [
      item.projectId,
      item.projectName,
      item.personId,
      item.personName,
      item.role,
      item.joinedAt,
    ]),
    [38, 40, 38, 40, 36, 24],
  );
  addTable(
    workbook,
    'Артефакты проектов',
    [
      'ID проекта',
      'Проект',
      'ID артефакта',
      'Артефакт',
      'Тип',
      'Статус',
      'Статус версии',
      'Отправлен',
      'Авторы',
      'Мероприятие',
      'Оценка 1–10',
      'Решение',
    ],
    input.projectArtifacts.map((item) => [
      item.projectId,
      item.projectName,
      item.artifactId,
      item.title,
      item.typeName,
      item.status,
      item.latestVersionStatus,
      item.submittedAt,
      item.authors,
      item.eventName,
      item.score,
      item.decision,
    ]),
    [38, 38, 38, 42, 26, 18, 20, 24, 42, 36, 14, 18],
  );
  addTable(
    workbook,
    'Мероприятия проектов',
    [
      'ID проекта',
      'Проект',
      'ID мероприятия',
      'Мероприятие',
      'Добавлен',
      'Решение',
      'Посещение',
      'Результат',
    ],
    input.projectEvents.map((item) => [
      item.projectId,
      item.projectName,
      item.eventId,
      item.eventName,
      item.registeredAt,
      item.decision,
      item.attendance,
      item.result,
    ]),
    [38, 40, 38, 42, 24, 18, 18, 58],
  );

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
