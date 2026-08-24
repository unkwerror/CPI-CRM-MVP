import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { createParticipantsExportWorkbook } from '../src/participants-export-workbook.js';

describe('participants export workbook', () => {
  it('creates an XLSX and neutralizes spreadsheet formulas', async () => {
    const bytes = await createParticipantsExportWorkbook({
      rows: [
        {
          id: 'person-1',
          fullName: '=2+3',
          contacts: ' +cmd',
          affiliations: 'Организация',
          hasArtifacts: true,
          artifactCount: 2,
          lastArtifactAt: '2026-08-20T10:00:00.000Z',
          source: 'BOT',
          profileStatus: 'Заполнен',
          events: '@SUM(A1:A2)',
          artifacts: '-1',
          comments: 'Комментарий',
          sourceRows: [{ sheet: 'Лист 1', row: 7 }],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Участники')!;
    expect(sheet.getCell('B2').text).toBe("'=2+3");
    expect(sheet.getCell('C2').text).toBe("' +cmd");
    expect(sheet.getCell('J2').text).toBe("'@SUM(A1:A2)");
    expect(sheet.getCell('K2').text).toBe("'-1");
    expect(sheet.getCell('M2').text).toContain('Лист 1');
  });
});
