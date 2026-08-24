import ExcelJS from 'exceljs';

export interface ParticipantWorkbookRow {
  readonly id: string;
  readonly lastName?: string | null;
  readonly firstName?: string | null;
  readonly patronymic?: string | null;
  readonly fullName: string;
  readonly aliases?: string | null;
  readonly emails?: string | null;
  readonly phones?: string | null;
  readonly telegram?: string | null;
  readonly telegramUserIds?: string | null;
  readonly max?: string | null;
  readonly otherContacts?: string | null;
  readonly affiliations: string;
  readonly tags?: string | null;
  readonly notes?: string | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
  readonly source: string;
  readonly sourceIdentities?: string | null;
  readonly ownerName?: string | null;
  readonly profileStatus: string;
  readonly marketingEmail?: string | null;
  readonly marketingTelegram?: string | null;
  readonly hasArtifacts: boolean;
  readonly artifactCount: number;
  readonly lastArtifactAt?: string | null;
  readonly events: string;
  readonly eventResults?: string | null;
  readonly projects?: string | null;
  readonly projectRoles?: string | null;
  readonly artifacts: string;
  readonly comments: string;
  readonly interactions?: string | null;
  readonly sourceRows: unknown;
}

export interface ParticipantsExportWorkbookInput {
  readonly rows: readonly ParticipantWorkbookRow[];
  readonly period?: { from: string; to: string } | null;
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

export function addParticipantsWorksheet(
  workbook: ExcelJS.Workbook,
  rows: ParticipantsExportWorkbookInput['rows'],
  name = 'Участники',
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow([
    'ID',
    'Фамилия',
    'Имя',
    'Отчество',
    'ФИО',
    'Варианты имени',
    'Email',
    'Телефон',
    'Telegram',
    'Telegram ID',
    'MAX',
    'Другие контакты',
    'Организации / факультеты',
    'Теги',
    'Комментарий CRM',
    'Создан',
    'Изменён',
    'Источник профиля',
    'Внешние идентификаторы',
    'Ответственный',
    'Профиль',
    'Согласие Email',
    'Согласие Telegram',
    'Отправлял артефакты',
    'Количество артефактов',
    'Последний артефакт',
    'Мероприятия',
    'Результаты мероприятий',
    'Проекты',
    'Роли в проектах',
    'Артефакты',
    'Комментарии из источников',
    'Взаимодействия / комментарии',
    'Все исходные поля (JSON)',
  ]);
  for (const item of rows) {
    sheet.addRow(
      [
        item.id,
        item.lastName,
        item.firstName,
        item.patronymic,
        item.fullName,
        item.aliases,
        item.emails,
        item.phones,
        item.telegram,
        item.telegramUserIds,
        item.max,
        item.otherContacts,
        item.affiliations,
        item.tags,
        item.notes,
        item.createdAt,
        item.updatedAt,
        item.source,
        item.sourceIdentities,
        item.ownerName,
        item.profileStatus,
        item.marketingEmail,
        item.marketingTelegram,
        item.hasArtifacts ? 'Да' : 'Нет',
        item.artifactCount,
        item.lastArtifactAt,
        item.events,
        item.eventResults,
        item.projects,
        item.projectRoles,
        item.artifacts,
        item.comments,
        item.interactions,
        JSON.stringify(item.sourceRows),
      ].map(safe),
    );
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: 34 },
  };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  const widths = [
    38, 20, 20, 22, 38, 36, 34, 26, 30, 22, 26, 34, 52, 30, 52, 24, 24, 20, 52, 28, 24, 20, 20, 18,
    18, 24, 54, 54, 46, 46, 54, 58, 64, 72,
  ];
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 20;
  });
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getRow(row).alignment = { vertical: 'top', wrapText: true };
  }

  return sheet;
}

/** Полная карточка каждого участника в одном фильтруемом XLSX. */
export async function createParticipantsExportWorkbook(
  input: ParticipantsExportWorkbookInput,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ЦПИ CRM';
  workbook.created = new Date();
  workbook.subject = input.period
    ? `Участники ЦПИ CRM ${input.period.from} — ${input.period.to}`
    : 'Выгрузка участников ЦПИ CRM';

  addParticipantsWorksheet(workbook, input.rows);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
