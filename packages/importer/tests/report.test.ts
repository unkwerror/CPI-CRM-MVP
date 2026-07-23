import { describe, expect, it } from 'vitest';

import { renderJsonReport, renderMarkdownReport } from '../src/report.js';
import type { AuditReport } from '../src/types.js';

const report: AuditReport = {
  importerVersion: 'test',
  parserVersion: 'test',
  rulesVersion: 'test',
  mode: 'DRY_RUN',
  generatedAt: '2026-07-22T00:00:00.000Z',
  source: { filename: 'source.xlsx', sizeBytes: 1, sha256: 'a'.repeat(64) },
  totals: {
    sheets: 34,
    sourceRows: 11_739,
    personObservations: 12_122,
    formulaCells: 1,
    sensitiveRawCells: 2,
  },
  outcomes: {
    parsedSourceRows: 11_739,
    readyPersonObservations: 12_110,
    rejectedPersonObservations: 12,
    quarantinedSourceRows: 0,
    ignoredSourceRows: 11,
  },
  catalyst2025: {
    sourceRows: 9_646,
    distinctExternalIds: 434,
    distinctEvents: 36,
    duplicatePersonEvents: 89,
  },
  controls: [{ key: 'sheets', expected: 34, actual: 34, passed: true }],
  controlsPassed: true,
  sheets: [],
  warnings: [],
  commit: null,
};

describe('reports', () => {
  it('renders machine-readable JSON without staging payloads', () => {
    const rendered = renderJsonReport(report);
    expect(JSON.parse(rendered)).toMatchObject({ controlsPassed: true });
    expect(rendered).not.toContain('rawValues');
    expect(rendered).not.toContain('normalizedValues');
  });

  it('renders the safety decisions in Markdown', () => {
    const rendered = renderMarkdownReport(report);
    expect(rendered).toContain('Формулы не вычислялись');
    expect(rendered).toContain('редактируются до записи raw staging');
    expect(rendered).toContain('неизвестная дата не используется');
    expect(rendered).toContain('UNKNOWN_LEGACY');
  });

  it('renders committed event and participation counters', () => {
    const rendered = renderMarkdownReport({
      ...report,
      mode: 'COMMIT',
      commit: {
        batchId: '00000000-0000-4000-8000-000000000010',
        runId: '00000000-0000-4000-8000-000000000011',
        reusedBatch: false,
        deduplication: {
          policyVersion: 'AUTO_DEDUPE_V1',
          candidatesExamined: 1_602,
          mergedCandidates: 1_252,
          notDuplicateCandidates: 5,
          dismissedCandidates: 345,
          mergedProfiles: 785,
          components: 509,
          remainingOpenCandidates: 0,
          masterPersonIds: [],
        },
        dataHygiene: {
          summary: {
            policyVersion: 'PERSON_NAME_HYGIENE_V1',
            acceptedObservations: 12_110,
            rejectedObservations: 12,
            ignoredSourceRows: 11,
            reasons: {
              MISSING_OR_GENERATED_PLACEHOLDER: 7,
              TEST_PLACEHOLDER: 4,
              GIBBERISH_PLACEHOLDER: 0,
              SERVICE_PLACEHOLDER: 0,
              URL_IN_NAME: 0,
              EMAIL_IN_NAME: 0,
              PHONE_OR_NUMERIC_IN_NAME: 0,
              NO_LETTERS: 0,
              TOO_SHORT: 1,
              REPEATED_CHARACTER: 0,
            },
          },
          cleanup: {
            policyVersion: 'PERSON_NAME_HYGIENE_V1',
            archivedPersons: 0,
            archivedContacts: 0,
            archivedEventParticipations: 0,
            archivedExternalIdentities: 0,
            detachedProvenanceLinks: 0,
            rejectedExistingObservations: 0,
            dismissedDuplicateCandidates: 0,
            protectedPersons: 0,
          },
        },
        created: {
          sourceRecords: 11_739,
          personObservations: 12_122,
          persons: 2_898,
          contacts: 5_606,
          events: 68,
          eventParticipations: 12_021,
          artifacts: 56,
          artifactVersions: 56,
          artifactContributors: 118,
          provenanceLinks: 60_090,
          fieldObservations: 36_140,
          duplicateCandidates: 1_602,
        },
      },
    });
    expect(rendered).toContain('Создано Event: 68');
    expect(rendered).toContain('Создано EventParticipation: 12021');
    expect(rendered).toContain('Создано Artifact: 56');
    expect(rendered).toContain('Создано ArtifactVersion: 56');
    expect(rendered).toContain('Создано ArtifactContributor: 118');
    expect(rendered).toContain('Создано provenance-связей: 60090');
    expect(rendered).toContain('Открытых кандидатов осталось: 0');
  });
});
