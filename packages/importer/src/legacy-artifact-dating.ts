import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { recalculateLegacyArtifactAuthors } from './legacy-artifacts.js';

export const LEGACY_ARTIFACT_DATING_VERSION = 'LEGACY_ARTIFACT_DATING_V1';

/** Раньше этой границы дата в таблице участников означает опечатку, не факт. */
const EARLIEST_PLAUSIBLE_SUBMISSION = Date.UTC(2010, 0, 1);

/**
 * Заголовки, под которыми в исходных таблицах лежит момент появления материала.
 * Список закрытый: угадывать по любому столбцу с датой нельзя, иначе в дату
 * отправки попадёт, например, дата рождения.
 */
const SUBMISSION_HEADER_PATTERN =
  /отметка времени|время создания|дата (заявки|отправки|создания|регистрации|подачи)|timestamp/u;

export type LegacySubmissionDateSource = 'SOURCE_ROW_TIMESTAMP' | 'EVENT_NAME_MONTH';

export interface LegacySourceCell {
  readonly kind?: string | null;
  readonly header?: string | null;
  readonly normalizedHeader?: string | null;
  readonly value?: unknown;
}

export interface ResolvedLegacySubmissionDate {
  readonly submittedAt: Date;
  readonly source: LegacySubmissionDateSource;
  /** Заголовок столбца или фрагмент названия мероприятия, откуда взята дата. */
  readonly evidence: string;
}

export type LegacySubmissionDateSkip =
  | 'NO_DATE_IN_SOURCE_ROW'
  | 'AMBIGUOUS_DATE_COLUMNS'
  | 'DATE_OUT_OF_RANGE';

export type LegacySubmissionDateResolution =
  | { readonly kind: 'RESOLVED'; readonly date: ResolvedLegacySubmissionDate }
  | { readonly kind: 'SKIPPED'; readonly why: LegacySubmissionDateSkip };

function parsedCellDate(cell: LegacySourceCell): Date | null {
  if (cell.kind !== 'date') return null;
  const raw = cell.value;
  if (typeof raw !== 'string' && !(raw instanceof Date)) return null;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function headerText(cell: LegacySourceCell): string {
  return (cell.normalizedHeader ?? cell.header ?? '').toLowerCase();
}

/**
 * Разбирает дату, вынесенную в название мероприятия: «Круглый стол 27.04.2026»
 * или «инвести_питч_студенты 04.2026». Для месяца без дня берём последний день:
 * точность известна до месяца, и это самая поздняя дата, которую он допускает.
 */
function eventNameDate(eventName: string): { readonly date: Date; readonly evidence: string } | null {
  const fullDate = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/u.exec(eventName);
  if (fullDate) {
    const [, day, month, year] = fullDate;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCMonth() === Number(month) - 1 && parsed.getUTCDate() === Number(day)) {
      return { date: parsed, evidence: fullDate[0] };
    }
    return null;
  }
  const monthOnly = /(?<![.\d])(\d{1,2})[.\-/](\d{4})(?![.\d])/u.exec(eventName);
  if (monthOnly) {
    const [, month, year] = monthOnly;
    if (Number(month) < 1 || Number(month) > 12) return null;
    return {
      date: new Date(Date.UTC(Number(year), Number(month), 0)),
      evidence: monthOnly[0],
    };
  }
  return null;
}

/**
 * Выбирает дату отправки для материала, у которого её не было при импорте.
 * Приоритет у исходной строки: там реальный момент заявки. Название мероприятия —
 * запасной вариант с точностью до месяца.
 *
 * `recordedAt` — момент, когда факт попал в систему. Дата позже него означала бы,
 * что материал внесли раньше, чем он появился, поэтому такую дату не берём.
 */
export function resolveLegacySubmissionDate(input: {
  readonly cells: readonly LegacySourceCell[];
  readonly eventName: string | null;
  readonly recordedAt: Date;
  readonly now: Date;
}): LegacySubmissionDateResolution {
  const upperBound = Math.min(input.recordedAt.getTime(), input.now.getTime());
  const dateCells = input.cells
    .map((cell) => ({ cell, parsed: parsedCellDate(cell) }))
    .filter((item): item is { cell: LegacySourceCell; parsed: Date } => item.parsed !== null);

  let picked: { readonly cell: LegacySourceCell; readonly parsed: Date } | null = null;
  if (dateCells.length === 1) {
    picked = dateCells[0]!;
  } else if (dateCells.length > 1) {
    const named = dateCells.filter((item) => SUBMISSION_HEADER_PATTERN.test(headerText(item.cell)));
    if (named.length !== 1) return { kind: 'SKIPPED', why: 'AMBIGUOUS_DATE_COLUMNS' };
    picked = named[0]!;
  }

  if (picked) {
    const time = picked.parsed.getTime();
    if (time < EARLIEST_PLAUSIBLE_SUBMISSION || time > upperBound) {
      return { kind: 'SKIPPED', why: 'DATE_OUT_OF_RANGE' };
    }
    return {
      kind: 'RESOLVED',
      date: {
        submittedAt: picked.parsed,
        source: 'SOURCE_ROW_TIMESTAMP',
        evidence: picked.cell.header?.trim() || headerText(picked.cell) || 'дата в исходной строке',
      },
    };
  }

  const fromName = input.eventName ? eventNameDate(input.eventName) : null;
  if (!fromName) return { kind: 'SKIPPED', why: 'NO_DATE_IN_SOURCE_ROW' };
  const time = fromName.date.getTime();
  if (time < EARLIEST_PLAUSIBLE_SUBMISSION || time > upperBound) {
    return { kind: 'SKIPPED', why: 'DATE_OUT_OF_RANGE' };
  }
  return {
    kind: 'RESOLVED',
    date: {
      submittedAt: fromName.date,
      source: 'EVENT_NAME_MONTH',
      evidence: fromName.evidence,
    },
  };
}

interface UndatedVersionRow {
  readonly version_id: string;
  readonly artifact_title: string;
  readonly event_name: string | null;
  readonly recorded_at: Date;
  readonly sheet_name: string | null;
  readonly row_number: number | null;
  readonly cells: LegacySourceCell[] | null;
}

export interface LegacyArtifactDatingPlanItem {
  readonly versionId: string;
  readonly artifactTitle: string;
  readonly eventName: string | null;
  readonly submittedAt: string;
  readonly source: LegacySubmissionDateSource;
  readonly evidence: string;
}

export interface LegacyArtifactDatingSkippedItem {
  readonly versionId: string;
  readonly artifactTitle: string;
  readonly eventName: string | null;
  readonly why: LegacySubmissionDateSkip;
}

export interface LegacyArtifactDatingPlan {
  readonly policyVersion: typeof LEGACY_ARTIFACT_DATING_VERSION;
  readonly undatedVersions: number;
  readonly datable: readonly LegacyArtifactDatingPlanItem[];
  readonly skipped: readonly LegacyArtifactDatingSkippedItem[];
}

export interface LegacyArtifactDatingResult extends LegacyArtifactDatingPlan {
  readonly datedVersions: number;
  readonly recalculatedAuthors: number;
}

async function undatedVersions(
  client: PoolClient,
  organizationId: string,
): Promise<UndatedVersionRow[]> {
  const result = await client.query<UndatedVersionRow>(
    `SELECT version.id AS version_id, artifact.title AS artifact_title,
            event.name AS event_name, version.recorded_at,
            source.sheet_name, source.row_number,
            source.raw_json -> 'cells' AS cells
       FROM artifact_versions version
       JOIN artifacts artifact ON artifact.id = version.artifact_id
       LEFT JOIN events event ON event.id = artifact.event_id
       LEFT JOIN source_entity_links link
              ON link.entity_id = version.id
             AND link.entity_type = 'ARTIFACT_VERSION'
             AND link.detached_at IS NULL
       LEFT JOIN source_records source ON source.id = link.source_record_id
      WHERE artifact.organization_id = $1
        AND version.status = 'SUBMITTED'
        AND version.submitted_at IS NULL
        AND version.qualifies_for_activation
        AND artifact.status <> 'VOIDED'
        AND artifact.archived_at IS NULL
      ORDER BY version.id`,
    [organizationId],
  );
  return result.rows;
}

function planItems(rows: readonly UndatedVersionRow[], now: Date): LegacyArtifactDatingPlan {
  const datable: LegacyArtifactDatingPlanItem[] = [];
  const skipped: LegacyArtifactDatingSkippedItem[] = [];
  for (const row of rows) {
    const resolution = resolveLegacySubmissionDate({
      cells: Array.isArray(row.cells) ? row.cells : [],
      eventName: row.event_name,
      recordedAt: row.recorded_at,
      now,
    });
    if (resolution.kind === 'SKIPPED') {
      skipped.push({
        versionId: row.version_id,
        artifactTitle: row.artifact_title,
        eventName: row.event_name,
        why: resolution.why,
      });
      continue;
    }
    datable.push({
      versionId: row.version_id,
      artifactTitle: row.artifact_title,
      eventName: row.event_name,
      submittedAt: resolution.date.submittedAt.toISOString(),
      source: resolution.date.source,
      evidence: resolution.date.evidence,
    });
  }
  return {
    policyVersion: LEGACY_ARTIFACT_DATING_VERSION,
    undatedVersions: rows.length,
    datable,
    skipped,
  };
}

export async function planLegacyArtifactDating(
  client: PoolClient,
  organizationId: string,
  now = new Date(),
): Promise<LegacyArtifactDatingPlan> {
  return planItems(await undatedVersions(client, organizationId), now);
}

function datingReason(item: LegacyArtifactDatingPlanItem): string {
  return item.source === 'SOURCE_ROW_TIMESTAMP'
    ? `Дата отправки восстановлена из исходной строки импорта: столбец «${item.evidence}». При импорте столбец не читался как дата отправки, поэтому материал остался недатированным.`
    : `Дата отправки восстановлена из названия мероприятия («${item.evidence}»): точность до месяца, взят последний день. В исходной строке даты нет.`;
}

/**
 * Проставляет дату отправки материалам legacy-мероприятий и пересчитывает статусы
 * авторов. Задача идемпотентна: она видит только версии с пустой датой, а после
 * простановки дата защищена триггером неизменяемости.
 */
export async function applyLegacyArtifactDating(
  pool: Pool,
  input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly now?: Date;
  },
): Promise<LegacyArtifactDatingResult> {
  const now = input.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('legacy-artifact-dating:' || $1, 0))`,
      [input.organizationId],
    );
    const plan = planItems(await undatedVersions(client, input.organizationId), now);
    const requestId = `legacy-artifact-dating:${randomUUID()}`;
    for (const item of plan.datable) {
      const reason = datingReason(item);
      await client.query(
        `UPDATE artifact_versions
            SET submitted_at = $2, backdate_reason = $3,
                qualifies_for_activity = true,
                countability_reasons = (countability_reasons - 'pending')
                  || jsonb_build_object('countableForActivity', true, 'datedFrom', $4::text),
                updated_at = now()
          WHERE id = $1 AND status = 'SUBMITTED' AND submitted_at IS NULL`,
        [item.versionId, item.submittedAt, reason, item.source],
      );
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id,
            before, after, reason)
         VALUES ($1, 'legacy-artifact-dating', $2, 'artifact_version.legacy_dated',
                 'artifact_version', $3, $4::jsonb, $5::jsonb, $6)`,
        [
          input.actorUserId,
          requestId,
          item.versionId,
          JSON.stringify({ submittedAt: null, qualifiesForActivity: false }),
          JSON.stringify({
            submittedAt: item.submittedAt,
            qualifiesForActivity: true,
            source: item.source,
            evidence: item.evidence,
          }),
          reason,
        ],
      );
    }

    const recalculatedAuthors = await recalculateLegacyArtifactAuthors(
      client,
      new Set(plan.datable.map((item) => item.versionId)),
      now,
      { submittedAtKnown: true },
    );
    const result: LegacyArtifactDatingResult = {
      ...plan,
      datedVersions: plan.datable.length,
      recalculatedAuthors,
    };
    if (plan.datable.length > 0) {
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after, reason)
         VALUES ($1, 'legacy-artifact-dating', $2, 'artifacts.legacy_dating_applied',
                 'organization', $3, $4::jsonb, $5)`,
        [
          input.actorUserId,
          requestId,
          input.organizationId,
          JSON.stringify(result),
          LEGACY_ARTIFACT_DATING_VERSION,
        ],
      );
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
