export const IMPORTER_VERSION = 'cpi-xlsx-v3';
export const PARSER_VERSION = 'cpi-xlsx-person-observation-v1';
export const RULES_VERSION = 'cpi-xlsx-rules-v3';
export const DEFAULT_TIMEZONE = 'Asia/Novosibirsk';
export const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;

export const EXPECTED_CONTROL_TOTALS = Object.freeze({
  sheets: 34,
  sourceRows: 11_739,
  personObservations: 12_122,
  catalyst2025Rows: 9_646,
  catalyst2025ExternalIds: 434,
  catalyst2025Events: 36,
  catalyst2025DuplicatePersonEvents: 89,
});

export const HEADER_ROW_TWO_SHEETS = Object.freeze(
  new Set([
    'Консультация умник 05.2026',
    'Все о Сколково 05.2026',
    'КОнсультация НОИФ СтС 02.2026',
    'Киновечера 2025',
  ]),
);

export const LYNCH_SHEET_NAME = 'Регистрации Линч';
export const CATALYST_2025_SHEET_NAME = 'Каталист 2025';
export const CATALYST_2025_NAMESPACE = 'cpi-catalyst-2025';

export const DEFAULT_WORKBOOK_FILENAME = 'Участники_всех_мероприятий_Стартап_студии_ЯДРО1.xlsx';
