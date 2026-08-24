import { describe, expect, it } from 'vitest';

import {
  operationalReportSvg,
  resolvePeriod,
  type OperationalPeriodReport,
} from '../src/lib/period-report.js';

describe('resolvePeriod', () => {
  it('uses four complete rolling weeks by default', () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const period = resolvePeriod({ now });
    expect(period.weeks).toBe(4);
    expect(period.to).toEqual(now);
    expect(period.from.toISOString()).toBe('2026-07-27T12:00:00.000Z');
  });

  it('accepts an explicit bounded interval', () => {
    const period = resolvePeriod({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-24T00:00:00.000Z',
    });
    expect(period.weeks).toBeNull();
    expect(period.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rejects an excessive or reversed interval', () => {
    expect(() => resolvePeriod({ weeks: 53 })).toThrow(/от 1 до 52/u);
    expect(() =>
      resolvePeriod({
        from: '2026-08-25T00:00:00.000Z',
        to: '2026-08-24T00:00:00.000Z',
      }),
    ).toThrow(/раньше конца/u);
  });
});

describe('operationalReportSvg', () => {
  it('returns a self-contained escaped image', () => {
    const report: OperationalPeriodReport = {
      period: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-24T00:00:00.000Z',
        weeks: null,
      },
      people: {
        newPeople: 3,
        newFromBot: 2,
        activated: 1,
        total: 10,
        totalFromBot: 5,
        active: 4,
        medium: 2,
        inactive: 1,
        unknown: 3,
      },
      artifacts: {
        submittedVersions: 4,
        uniqueArtifacts: 4,
        uniqueAuthors: 3,
        files: 2,
        availableFiles: 2,
        bytes: 2048,
        reviewed: 2,
        accepted: 1,
        rejected: 1,
        averageScore: 7.5,
        awaitingReview: 2,
        archivedDuringPeriod: 0,
        byType: [{ name: 'Pitch <script>alert(1)</script>', count: 4 }],
        bySource: [{ source: 'BOT', count: 4 }],
      },
      events: { created: 1, participations: 3, uniqueParticipants: 3, attended: 2 },
      tasks: { created: 2, completed: 1, overdueNow: 0 },
      programs: {
        svya: { tracked: 1, successful: 1, byStatus: [{ status: 'WINNER', count: 1 }] },
        biAcadempark: { tracked: 0, successful: 0, byStatus: [] },
      },
    };

    const svg = operationalReportSvg(report);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('Pitch &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).not.toContain('<script>');
  });
});
