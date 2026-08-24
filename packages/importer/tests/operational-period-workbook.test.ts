import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { createOperationalPeriodWorkbook } from '../src/operational-period-workbook.js';

describe('operational period workbook', () => {
  it('adds clickable relative links for every artifact file in the ZIP', async () => {
    const bytes = await createOperationalPeriodWorkbook({
      period: { from: '2026-08-01', to: '2026-08-24' },
      summary: [],
      artifacts: [
        {
          versionId: 'version-1',
          artifactId: 'artifact-1',
          submittedAt: '2026-08-20T10:00:00.000Z',
          title: 'Презентация',
          typeName: 'Файл',
          authors: 'Иванов Иван',
          projectName: 'Проект',
          eventName: 'Демо-день',
          source: 'BOT',
          archiveFiles: [
            {
              fileName: 'питч "финал".pdf',
              archivePath: 'artifacts/Иванов/питч финал.pdf',
              relativePath: '../artifacts/Иванов/питч финал.pdf',
            },
            {
              fileName: 'расчёты.xlsx',
              archivePath: 'artifacts/Иванов/расчёты.xlsx',
              relativePath: '../artifacts/Иванов/расчёты.xlsx',
            },
          ],
        },
      ],
      people: [],
      tasks: [],
      events: [],
      interactions: [],
      projects: [],
      projectMembers: [],
      projectArtifacts: [],
      projectEvents: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    const artifacts = workbook.getWorksheet('Артефакты')!;
    expect(artifacts.getCell('M2').formula).toBe(
      'HYPERLINK("../artifacts/Иванов/питч финал.pdf","питч ""финал"".pdf (+1)")',
    );

    const files = workbook.getWorksheet('Файлы артефактов')!;
    expect(files.rowCount).toBe(3);
    expect(files.getCell('H2').formula).toBe(
      'HYPERLINK("../artifacts/Иванов/питч финал.pdf","питч ""финал"".pdf")',
    );
    expect(files.getCell('H3').formula).toBe(
      'HYPERLINK("../artifacts/Иванов/расчёты.xlsx","расчёты.xlsx")',
    );
    expect(files.getCell('I3').text).toBe('artifacts/Иванов/расчёты.xlsx');
  });
});
