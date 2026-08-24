import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { createOperationalPeriodWorkbook } from '../src/operational-period-workbook.js';

describe('operational period workbook', () => {
  it('adds clickable relative links for every artifact file in the ZIP', async () => {
    const bytes = await createOperationalPeriodWorkbook({
      period: { from: '2026-08-01', to: '2026-08-24' },
      summary: [],
      quality: {
        reviewed: 2,
        awaitingReview: 1,
        accepted: 1,
        rejected: 1,
        averageScore: 7.5,
        medianScore: 7.5,
        scoreDistribution: [
          { score: 7, count: 1 },
          { score: 8, count: 1 },
        ],
      },
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
      'HYPERLINK("../artifacts/Иванов/питч финал.pdf","питч ""финал"".pdf")',
    );
    expect(artifacts.getCell('M3').formula).toBe(
      'HYPERLINK("../artifacts/Иванов/расчёты.xlsx","расчёты.xlsx")',
    );
    expect(artifacts.getCell('N3').text).toBe('artifacts/Иванов/расчёты.xlsx');

    const summary = workbook.getWorksheet('Сводка')!;
    expect(summary.getCell('A11').value).toBe(7);
    expect(summary.getCell('B11').value).toBe(1);
    expect(summary.getCell('E5').text).toBe('7.50');
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Сводка',
      'Участники',
      'Артефакты',
      'Мероприятия',
      'Проекты',
      'Работа CRM',
    ]);
  });
});
