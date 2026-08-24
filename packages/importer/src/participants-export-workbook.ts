import ExcelJS from 'exceljs';

export interface ParticipantsExportWorkbookInput {
  readonly rows: readonly {
    id: string;
    fullName: string;
    contacts: string;
    affiliations: string;
    hasArtifacts: boolean;
    artifactCount: number;
    lastArtifactAt?: string | null;
    source: string;
    profileStatus: string;
    events: string;
    artifacts: string;
    comments: string;
    sourceRows: unknown;
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

/** Реестр участников в одном XLSX с теми же полями, что были в старом CSV. */
export async function createParticipantsExportWorkbook(
  input: ParticipantsExportWorkbookInput,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ЦПИ CRM';
  workbook.created = new Date();
  workbook.subject = 'Выгрузка участников ЦПИ CRM';

  const sheet = workbook.addWorksheet('Участники');
  sheet.addRow([
    'ID',
    'ФИО',
    'Контакты',
    'Организации / факультеты',
    'Отправлял артефакты',
    'Количество артефактов',
    'Последний артефакт',
    'Источник профиля',
    'Профиль',
    'Мероприятия',
    'Артефакты',
    'Комментарии',
    'Все исходные поля (JSON)',
  ]);
  for (const item of input.rows) {
    sheet.addRow(
      [
        item.id,
        item.fullName,
        item.contacts,
        item.affiliations,
        item.hasArtifacts ? 'Да' : 'Нет',
        item.artifactCount,
        item.lastArtifactAt,
        item.source,
        item.profileStatus,
        item.events,
        item.artifacts,
        item.comments,
        JSON.stringify(item.sourceRows),
      ].map(safe),
    );
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `M${Math.max(1, sheet.rowCount)}` };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 34;
  const widths = [38, 38, 44, 44, 18, 18, 24, 20, 24, 48, 48, 52, 72];
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 20;
  });
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getRow(row).alignment = { vertical: 'top', wrapText: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
