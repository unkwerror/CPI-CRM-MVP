import type { Pool } from 'pg';

export interface PeriodBounds {
  from: Date;
  to: Date;
  weeks: number | null;
}

export interface OperationalPeriodReport {
  period: { from: string; to: string; weeks: number | null };
  people: {
    newPeople: number;
    newFromBot: number;
    activated: number;
    total: number;
    totalFromBot: number;
    active: number;
    medium: number;
    inactive: number;
    unknown: number;
  };
  artifacts: {
    submittedVersions: number;
    uniqueArtifacts: number;
    uniqueAuthors: number;
    files: number;
    availableFiles: number;
    bytes: number;
    reviewed: number;
    accepted: number;
    rejected: number;
    averageScore: number | null;
    awaitingReview: number;
    archivedDuringPeriod: number;
    byType: { name: string; count: number }[];
    bySource: { source: 'BOT' | 'CRM'; count: number }[];
  };
  events: {
    created: number;
    participations: number;
    uniqueParticipants: number;
    attended: number;
  };
  tasks: {
    created: number;
    completed: number;
    overdueNow: number;
  };
  programs: {
    svya: { tracked: number; successful: number; byStatus: StatusCount[] };
    biAcadempark: { tracked: number; successful: number; byStatus: StatusCount[] };
  };
}

interface StatusCount {
  status: string;
  count: number;
}

const LIVE_ACTIVITY_SQL = `CASE
  WHEN person.activation_state <> 'ACTIVATED' OR person.last_artifact_at IS NULL THEN 'UNKNOWN'
  WHEN now() <= person.last_artifact_at + make_interval(hours => rules.active_window_hours) THEN 'ACTIVE'
  WHEN now() <= person.last_artifact_at + make_interval(hours => rules.inactive_after_hours) THEN 'MEDIUM'
  ELSE 'INACTIVE'
END`;

export function resolvePeriod(input: {
  weeks?: number;
  from?: string;
  to?: string;
  now?: Date;
}): PeriodBounds {
  const now = input.now ?? new Date();
  const to = input.to ? new Date(input.to) : now;
  if (Number.isNaN(to.getTime())) throw new RangeError('Некорректный конец периода');
  if (input.from) {
    const from = new Date(input.from);
    if (Number.isNaN(from.getTime()) || !(from < to))
      throw new RangeError('Начало периода должно быть раньше конца');
    const maximum = 366 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maximum)
      throw new RangeError('Период выгрузки не может быть больше 366 дней');
    return { from, to, weeks: null };
  }
  const weeks = input.weeks ?? 4;
  if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > 52)
    throw new RangeError('Количество недель должно быть от 1 до 52');
  return {
    from: new Date(to.getTime() - weeks * 7 * 24 * 60 * 60 * 1000),
    to,
    weeks,
  };
}

export async function loadOperationalPeriodReport(
  pool: Pool,
  organizationId: string,
  bounds: PeriodBounds,
): Promise<OperationalPeriodReport> {
  const parameters = [organizationId, bounds.from, bounds.to];
  const [people, artifacts, artifactTypes, artifactSources, events, tasks, programStatuses] =
    await Promise.all([
      pool.query<{
        new_people: string;
        new_from_bot: string;
        activated: string;
        total: string;
        total_from_bot: string;
        active: string;
        medium: string;
        inactive: string;
        unknown: string;
      }>(
        `WITH canonical AS (
           SELECT person.id, person.created_at, person.activated_at,
                  ${LIVE_ACTIVITY_SQL} AS activity,
                  EXISTS (
                    SELECT 1 FROM external_identities identity
                     WHERE identity.person_id IN (
                             SELECT member.id FROM persons member
                              WHERE member.id = person.id OR member.merged_into_person_id = person.id
                           )
                       AND identity.source_namespace IN ('locker.user', 'locker.telegram')
                       AND identity.archived_at IS NULL
                  ) AS from_bot
             FROM persons person
             JOIN organization_settings settings ON settings.organization_id = person.organization_id
             JOIN lifecycle_rule_sets rules ON rules.id = settings.current_lifecycle_rule_set_id
            WHERE person.organization_id = $1 AND person.archived_at IS NULL
              AND person.merged_into_person_id IS NULL
         )
         SELECT count(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::text AS new_people,
                count(*) FILTER (WHERE created_at >= $2 AND created_at < $3 AND from_bot)::text AS new_from_bot,
                count(*) FILTER (WHERE activated_at >= $2 AND activated_at < $3)::text AS activated,
                count(*)::text AS total,
                count(*) FILTER (WHERE from_bot)::text AS total_from_bot,
                count(*) FILTER (WHERE activity = 'ACTIVE')::text AS active,
                count(*) FILTER (WHERE activity = 'MEDIUM')::text AS medium,
                count(*) FILTER (WHERE activity = 'INACTIVE')::text AS inactive,
                count(*) FILTER (WHERE activity = 'UNKNOWN')::text AS unknown
           FROM canonical`,
        parameters,
      ),
      pool.query<{
        submitted_versions: string;
        unique_artifacts: string;
        unique_authors: string;
        files: string;
        available_files: string;
        bytes: string;
        reviewed: string;
        accepted: string;
        rejected: string;
        average_score: string | null;
        awaiting_review: string;
        archived_during_period: string;
      }>(
        `WITH period_versions AS MATERIALIZED (
           SELECT version.id, version.artifact_id
             FROM artifact_versions version
             JOIN artifacts artifact ON artifact.id = version.artifact_id
            WHERE artifact.organization_id = $1 AND artifact.archived_at IS NULL
              AND artifact.status <> 'VOIDED' AND version.status = 'SUBMITTED'
              AND version.submitted_at >= $2 AND version.submitted_at < $3
         ), authors AS (
           SELECT DISTINCT COALESCE(person.merged_into_person_id, person.id) AS person_id
             FROM period_versions version
             JOIN artifact_version_contributors contributor
               ON contributor.artifact_version_id = version.id
              AND contributor.contribution_role = 'AUTHOR'
             JOIN persons person ON person.id = contributor.person_id
         ), files AS (
           SELECT DISTINCT file.id, file.status, file.size_bytes
             FROM period_versions version
             JOIN artifact_assets asset ON asset.artifact_version_id = version.id
             JOIN file_objects file ON file.id = asset.file_object_id
         ), reviews AS (
           SELECT review.score, review.decision
             FROM period_versions version
             JOIN artifact_review_selections selection ON selection.artifact_version_id = version.id
             JOIN artifact_reviews review ON review.id = selection.current_final_review_id
            WHERE review.voided_at IS NULL AND review.status = 'FINAL'
         )
         SELECT (SELECT count(*) FROM period_versions)::text AS submitted_versions,
                (SELECT count(DISTINCT artifact_id) FROM period_versions)::text AS unique_artifacts,
                (SELECT count(*) FROM authors)::text AS unique_authors,
                (SELECT count(*) FROM files)::text AS files,
                (SELECT count(*) FROM files WHERE status = 'AVAILABLE')::text AS available_files,
                (SELECT COALESCE(sum(size_bytes), 0) FROM files)::text AS bytes,
                (SELECT count(*) FROM reviews)::text AS reviewed,
                (SELECT count(*) FROM reviews WHERE decision = 'ACCEPTED')::text AS accepted,
                (SELECT count(*) FROM reviews WHERE decision = 'REJECTED')::text AS rejected,
                (SELECT avg(score)::text FROM reviews WHERE score BETWEEN 1 AND 10) AS average_score,
                (SELECT count(*) FROM period_versions version
                  WHERE NOT EXISTS (
                    SELECT 1 FROM artifact_review_selections selection
                     WHERE selection.artifact_version_id = version.id
                  ))::text AS awaiting_review,
                (SELECT count(*) FROM artifacts artifact
                  WHERE artifact.organization_id = $1 AND artifact.auto_archived_at >= $2
                    AND artifact.auto_archived_at < $3)::text AS archived_during_period`,
        parameters,
      ),
      pool.query<{ name: string; count: string }>(
        `SELECT type.name, count(*)::text AS count
           FROM artifact_versions version
           JOIN artifacts artifact ON artifact.id = version.artifact_id
           JOIN artifact_types type ON type.id = artifact.type_id
          WHERE artifact.organization_id = $1 AND artifact.archived_at IS NULL
            AND artifact.status <> 'VOIDED' AND version.status = 'SUBMITTED'
            AND version.submitted_at >= $2 AND version.submitted_at < $3
          GROUP BY type.id, type.name
          ORDER BY count(*) DESC, type.name`,
        parameters,
      ),
      pool.query<{ source: 'BOT' | 'CRM'; count: string }>(
        `SELECT CASE WHEN link.artifact_version_id IS NULL THEN 'CRM' ELSE 'BOT' END AS source,
                count(*)::text AS count
           FROM artifact_versions version
           JOIN artifacts artifact ON artifact.id = version.artifact_id
           LEFT JOIN locker_submission_links link ON link.artifact_version_id = version.id
          WHERE artifact.organization_id = $1 AND artifact.archived_at IS NULL
            AND artifact.status <> 'VOIDED' AND version.status = 'SUBMITTED'
            AND version.submitted_at >= $2 AND version.submitted_at < $3
          GROUP BY CASE WHEN link.artifact_version_id IS NULL THEN 'CRM' ELSE 'BOT' END
          ORDER BY source`,
        parameters,
      ),
      pool.query<{
        created: string;
        participations: string;
        unique_participants: string;
        attended: string;
      }>(
        `SELECT
           (SELECT count(*) FROM events event
             WHERE event.organization_id = $1 AND event.archived_at IS NULL
               AND event.created_at >= $2 AND event.created_at < $3)::text AS created,
           (SELECT count(*) FROM event_participations participation
              JOIN events event ON event.id = participation.event_id
             WHERE event.organization_id = $1 AND participation.archived_at IS NULL
               AND participation.created_at >= $2 AND participation.created_at < $3)::text AS participations,
           (SELECT count(DISTINCT COALESCE(person.merged_into_person_id, person.id))
              FROM event_participations participation
              JOIN events event ON event.id = participation.event_id
              JOIN persons person ON person.id = participation.person_id
             WHERE event.organization_id = $1 AND participation.archived_at IS NULL
               AND participation.created_at >= $2 AND participation.created_at < $3)::text AS unique_participants,
           (SELECT count(*) FROM event_participations participation
              JOIN events event ON event.id = participation.event_id
             WHERE event.organization_id = $1 AND participation.archived_at IS NULL
               AND participation.attendance = 'ATTENDED'
               AND COALESCE(participation.attended_at, participation.updated_at) >= $2
               AND COALESCE(participation.attended_at, participation.updated_at) < $3)::text AS attended`,
        parameters,
      ),
      pool.query<{ created: string; completed: string; overdue_now: string }>(
        `SELECT count(*) FILTER (WHERE task.created_at >= $2 AND task.created_at < $3)::text AS created,
                count(*) FILTER (WHERE task.completed_at >= $2 AND task.completed_at < $3)::text AS completed,
                count(*) FILTER (WHERE task.status NOT IN ('DONE', 'CANCELLED')
                                  AND task.due_at < now())::text AS overdue_now
           FROM tasks task
           LEFT JOIN persons person ON person.id = task.person_id
           LEFT JOIN projects project ON project.id = task.project_id
          WHERE task.archived_at IS NULL
            AND COALESCE(person.organization_id, project.organization_id) = $1`,
        parameters,
      ),
      pool.query<{ program_code: 'SVYA' | 'BI_ACADEMPARK'; status: string; count: string }>(
        `WITH current_results AS (
           SELECT DISTINCT ON (canonical.id, result.program_code)
                  result.program_code, result.status, result.updated_at
             FROM person_program_results result
             JOIN persons member ON member.id = result.person_id
             JOIN persons canonical
               ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
            WHERE canonical.organization_id = $1 AND canonical.archived_at IS NULL
              AND member.archived_at IS NULL AND result.archived_at IS NULL
            ORDER BY canonical.id, result.program_code, result.updated_at DESC, result.id DESC
         )
         SELECT program_code, status, count(*)::text AS count
           FROM current_results
          WHERE updated_at >= $2 AND updated_at < $3
          GROUP BY program_code, status
          ORDER BY program_code, status`,
        parameters,
      ),
    ]);

  const peopleRow = people.rows[0]!;
  const artifactRow = artifacts.rows[0]!;
  const eventRow = events.rows[0]!;
  const taskRow = tasks.rows[0]!;
  const program = (code: 'SVYA' | 'BI_ACADEMPARK', successful: readonly string[]) => {
    const byStatus = programStatuses.rows
      .filter((row) => row.program_code === code)
      .map((row) => ({ status: row.status, count: Number(row.count) }));
    return {
      tracked: byStatus.reduce((sum, item) => sum + item.count, 0),
      successful: byStatus
        .filter((item) => successful.includes(item.status))
        .reduce((sum, item) => sum + item.count, 0),
      byStatus,
    };
  };

  return {
    period: {
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
      weeks: bounds.weeks,
    },
    people: {
      newPeople: Number(peopleRow.new_people),
      newFromBot: Number(peopleRow.new_from_bot),
      activated: Number(peopleRow.activated),
      total: Number(peopleRow.total),
      totalFromBot: Number(peopleRow.total_from_bot),
      active: Number(peopleRow.active),
      medium: Number(peopleRow.medium),
      inactive: Number(peopleRow.inactive),
      unknown: Number(peopleRow.unknown),
    },
    artifacts: {
      submittedVersions: Number(artifactRow.submitted_versions),
      uniqueArtifacts: Number(artifactRow.unique_artifacts),
      uniqueAuthors: Number(artifactRow.unique_authors),
      files: Number(artifactRow.files),
      availableFiles: Number(artifactRow.available_files),
      bytes: Number(artifactRow.bytes),
      reviewed: Number(artifactRow.reviewed),
      accepted: Number(artifactRow.accepted),
      rejected: Number(artifactRow.rejected),
      averageScore: artifactRow.average_score === null ? null : Number(artifactRow.average_score),
      awaitingReview: Number(artifactRow.awaiting_review),
      archivedDuringPeriod: Number(artifactRow.archived_during_period),
      byType: artifactTypes.rows.map((row) => ({ name: row.name, count: Number(row.count) })),
      bySource: artifactSources.rows.map((row) => ({
        source: row.source,
        count: Number(row.count),
      })),
    },
    events: {
      created: Number(eventRow.created),
      participations: Number(eventRow.participations),
      uniqueParticipants: Number(eventRow.unique_participants),
      attended: Number(eventRow.attended),
    },
    tasks: {
      created: Number(taskRow.created),
      completed: Number(taskRow.completed),
      overdueNow: Number(taskRow.overdue_now),
    },
    programs: {
      svya: program('SVYA', ['FINALIST', 'WINNER']),
      biAcadempark: program('BI_ACADEMPARK', ['RESIDENT']),
    },
  };
}

export function operationalReportSvg(report: OperationalPeriodReport): string {
  const title = `Отчёт ЦПИ · ${dateLabel(report.period.from)} — ${dateLabel(report.period.to)}`;
  const cards = [
    ['Новые участники', report.people.newPeople, `из бота: ${report.people.newFromBot}`],
    [
      'Отправлено артефактов',
      report.artifacts.submittedVersions,
      `авторов: ${report.artifacts.uniqueAuthors}`,
    ],
    ['Файлы', report.artifacts.availableFiles, bytesLabel(report.artifacts.bytes)],
    [
      'Оценено',
      report.artifacts.reviewed,
      `средний балл: ${report.artifacts.averageScore?.toFixed(1) ?? '—'}`,
    ],
    [
      'Участия в событиях',
      report.events.participations,
      `уникальных: ${report.events.uniqueParticipants}`,
    ],
    ['Задач завершено', report.tasks.completed, `просрочено сейчас: ${report.tasks.overdueNow}`],
    [
      'СВЯ',
      report.programs.svya.tracked,
      `финалисты / победители: ${report.programs.svya.successful}`,
    ],
    [
      'БИ Академпарка',
      report.programs.biAcadempark.tracked,
      `резиденты: ${report.programs.biAcadempark.successful}`,
    ],
  ] as const;
  const cardSvg = cards
    .map(([label, value, hint], index) => {
      const x = 56 + (index % 4) * 286;
      const y = 170 + Math.floor(index / 4) * 154;
      return `<g transform="translate(${x} ${y})">
        <rect width="258" height="126" rx="16" fill="#ffffff" stroke="#dbe4ee"/>
        <text x="20" y="30" class="label">${escapeXml(label)}</text>
        <text x="20" y="75" class="value">${value.toLocaleString('ru-RU')}</text>
        <text x="20" y="104" class="hint">${escapeXml(hint)}</text>
      </g>`;
    })
    .join('');
  const maxType = Math.max(1, ...report.artifacts.byType.map((item) => item.count));
  const bars = report.artifacts.byType
    .slice(0, 6)
    .map((item, index) => {
      const y = 525 + index * 42;
      const width = Math.round((item.count / maxType) * 610);
      return `<text x="56" y="${y + 17}" class="bar-label">${escapeXml(item.name.slice(0, 34))}</text>
        <rect x="330" y="${y}" width="${Math.max(4, width)}" height="24" rx="6" fill="#2563eb"/>
        <text x="${350 + width}" y="${y + 17}" class="bar-value">${item.count}</text>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820">
  <style>
    text { font-family: Inter, Arial, sans-serif; fill: #172033; }
    .eyebrow { font-size: 15px; font-weight: 700; letter-spacing: 2px; fill: #2563eb; }
    .title { font-size: 34px; font-weight: 700; }
    .sub { font-size: 16px; fill: #64748b; }
    .label { font-size: 14px; font-weight: 600; fill: #64748b; }
    .value { font-size: 38px; font-weight: 750; }
    .hint { font-size: 13px; fill: #64748b; }
    .section { font-size: 19px; font-weight: 700; }
    .bar-label { font-size: 13px; fill: #475569; }
    .bar-value { font-size: 13px; font-weight: 700; }
  </style>
  <rect width="1200" height="820" fill="#f6f8fb"/>
  <text x="56" y="58" class="eyebrow">ЦПИ · CRM</text>
  <text x="56" y="104" class="title">${escapeXml(title)}</text>
  <text x="56" y="134" class="sub">Данные сформированы ${escapeXml(new Date().toLocaleString('ru-RU'))}</text>
  ${cardSvg}
  <text x="56" y="485" class="section">Артефакты по типам</text>
  ${bars || '<text x="56" y="540" class="sub">За период артефактов нет</text>'}
  <text x="56" y="790" class="hint">Архивирование не удаляет файлы: старые материалы остаются доступны в CRM и выгрузках.</text>
</svg>`;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU');
}

function bytesLabel(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} МБ`;
  return `${(value / 1024 ** 3).toFixed(1)} ГБ`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
