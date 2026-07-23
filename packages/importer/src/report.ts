import type { AuditReport } from './types.js';

function escapeMarkdown(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderJsonReport(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderMarkdownReport(report: AuditReport): string {
  const lines: string[] = [
    '# Отчёт импорта XLSX',
    '',
    `- Режим: \`${report.mode}\``,
    `- Файл: \`${escapeMarkdown(report.source.filename)}\``,
    `- SHA-256: \`${report.source.sha256}\``,
    `- Размер: ${report.source.sizeBytes} байт`,
    `- Контрольные сверки: **${report.controlsPassed ? 'пройдены' : 'не пройдены'}**`,
    `- Итог разбора наблюдений: ${report.outcomes.readyPersonObservations} ready, ${report.outcomes.rejectedPersonObservations} rejected, ${report.outcomes.quarantinedSourceRows} quarantined`,
    '',
    '## Контрольные числа',
    '',
    '| Показатель | Ожидалось | Получено | Результат |',
    '|---|---:|---:|:---:|',
    ...report.controls.map(
      (entry) =>
        `| ${escapeMarkdown(entry.key)} | ${entry.expected} | ${entry.actual} | ${entry.passed ? 'OK' : 'FAIL'} |`,
    ),
    '',
    '## Листы',
    '',
    '| Лист | Строка заголовка | SourceRecord | PersonObservation | Формулы | Sensitive raw |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.sheets.map(
      (sheet) =>
        `| ${escapeMarkdown(sheet.sheetName)} | ${sheet.headerRow} | ${sheet.sourceRows} | ${sheet.personObservations} | ${sheet.formulaCells} | ${sheet.sensitiveRawCells} |`,
    ),
    '',
    '## Безопасность и происхождение',
    '',
    '- Формулы не вычислялись; их выражения сохранены как raw-текст без cached result.',
    '- Значения СНИЛС и дат рождения редактируются до записи raw staging; сохраняются только координаты, заголовки и hash исходной строки.',
    '- Явные test/placeholder/технические значения вместо ФИО сохраняются как отклонённые наблюдения и не создают карточки участников.',
    '- Дубли разрешаются автоматически по версии политики из отчёта: merge допускается только для совместимых ФИО с чистым общим контактом; неоднозначности закрываются без объединения.',
    '- Материалы legacy-мероприятий создают доказанный артефакт активации; неизвестная дата не используется как признак текущей активности.',
    '- Legacy-карточки создаются с `LEGACY_INCOMPLETE / UNKNOWN_LEGACY / UNKNOWN`.',
  ];

  if (report.commit !== null) {
    lines.push(
      '',
      '## Commit',
      '',
      `- Batch: \`${report.commit.batchId}\``,
      `- Run: \`${report.commit.runId}\``,
      `- Переиспользован batch: ${report.commit.reusedBatch ? 'да' : 'нет'}`,
      `- Политика очистки ФИО: \`${report.commit.dataHygiene.summary.policyVersion}\``,
      `- Отклонено наблюдений ФИО: ${report.commit.dataHygiene.summary.rejectedObservations}`,
      `- Архивировано мусорных карточек: ${report.commit.dataHygiene.cleanup.archivedPersons}`,
      `- Создано SourceRecord: ${report.commit.created.sourceRecords}`,
      `- Создано PersonObservation: ${report.commit.created.personObservations}`,
      `- Создано Person: ${report.commit.created.persons}`,
      `- Создано ContactPoint: ${report.commit.created.contacts}`,
      `- Создано Event: ${report.commit.created.events}`,
      `- Создано EventParticipation: ${report.commit.created.eventParticipations}`,
      `- Создано Artifact: ${report.commit.created.artifacts}`,
      `- Создано ArtifactVersion: ${report.commit.created.artifactVersions}`,
      `- Создано ArtifactContributor: ${report.commit.created.artifactContributors}`,
      `- Создано provenance-связей: ${report.commit.created.provenanceLinks}`,
      `- Поставлено кандидатов дублей: ${report.commit.created.duplicateCandidates}`,
      `- Политика дублей: \`${report.commit.deduplication.policyVersion}\``,
      `- Объединено карточек: ${report.commit.deduplication.mergedProfiles}`,
      `- Кандидатов отмечено merge: ${report.commit.deduplication.mergedCandidates}`,
      `- Кандидатов закрыто без merge: ${report.commit.deduplication.notDuplicateCandidates + report.commit.deduplication.dismissedCandidates}`,
      `- Открытых кандидатов осталось: ${report.commit.deduplication.remainingOpenCandidates}`,
    );
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Предупреждения', '');
    for (const warning of report.warnings) {
      lines.push(`- \`${warning.code}\`: ${warning.count ?? 1}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
