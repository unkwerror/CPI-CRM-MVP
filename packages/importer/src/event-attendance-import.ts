import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import {
  readEventAttendanceWorkbook,
  type AttendanceWorkbookPerson,
} from './event-attendance-workbook.js';

export type EventAttendanceImportErrorKind = 'INVALID_WORKBOOK' | 'EVENT_NOT_FOUND';

export class EventAttendanceImportError extends Error {
  constructor(
    readonly kind: EventAttendanceImportErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'EventAttendanceImportError';
  }
}

export interface EventAttendanceImportResult {
  readonly eventId: string;
  readonly eventName: string;
  readonly dataRows: number;
  readonly attendedRows: number;
  readonly duplicateRows: number;
  readonly resolved: number;
  readonly added: number;
  readonly markedAttended: number;
  readonly alreadyAttended: number;
  readonly invalid: readonly {
    readonly rowNumber: number;
    readonly rawFullName: string;
    readonly reason: 'INVALID_FIO';
  }[];
  readonly unmatched: readonly { readonly rowNumber: number; readonly fullName: string }[];
  readonly ambiguous: readonly { readonly rowNumber: number; readonly fullName: string }[];
}

function groupedMatches(rows: readonly { match_name: string; person_id: string }[]) {
  const idsByName = new Map<string, string[]>();
  for (const row of rows) {
    const ids = idsByName.get(row.match_name) ?? [];
    ids.push(row.person_id);
    idsByName.set(row.match_name, ids);
  }
  return idsByName;
}

export async function importEventAttendanceWorkbook(
  pool: Pool,
  input: {
    readonly organizationId: string;
    readonly eventId: string;
    readonly actorUserId: string;
    readonly actorSubject: string;
    readonly requestId: string;
    readonly workbookBytes: Uint8Array;
  },
): Promise<EventAttendanceImportResult> {
  let workbook: Awaited<ReturnType<typeof readEventAttendanceWorkbook>>;
  try {
    workbook = await readEventAttendanceWorkbook(input.workbookBytes);
  } catch (error) {
    throw new EventAttendanceImportError(
      'INVALID_WORKBOOK',
      'Не удалось прочитать таблицу посещений',
      error instanceof Error ? error.message : undefined,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query<{
      id: string;
      name: string;
      starts_at: Date | null;
    }>(
      `SELECT id, name, starts_at FROM events
        WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
        FOR UPDATE`,
      [input.eventId, input.organizationId],
    );
    const event = eventResult.rows[0];
    if (!event) {
      throw new EventAttendanceImportError('EVENT_NOT_FOUND', 'Мероприятие не найдено');
    }

    const requestedNames = workbook.people.map((person) => person.normalizedFullName);
    const matches =
      requestedNames.length === 0
        ? { rows: [] as Array<{ match_name: string; person_id: string }> }
        : await client.query<{ match_name: string; person_id: string }>(
            `WITH matching_names AS (
               SELECT person.normalized_full_name AS match_name, person.id AS person_id
                 FROM persons person
                WHERE person.organization_id = $1
                  AND person.archived_at IS NULL AND person.merged_into_person_id IS NULL
                  AND person.normalized_full_name = ANY($2::text[])
               UNION
               SELECT alias.normalized_value, canonical.id
                 FROM person_aliases alias
                 JOIN persons member ON member.id = alias.person_id
                 JOIN persons canonical
                   ON canonical.id = COALESCE(member.merged_into_person_id, member.id)
                WHERE canonical.organization_id = $1
                  AND canonical.archived_at IS NULL AND canonical.merged_into_person_id IS NULL
                  AND alias.archived_at IS NULL
                  AND alias.normalized_value = ANY($2::text[])
             )
             SELECT DISTINCT match_name, person_id FROM matching_names
             ORDER BY match_name, person_id`,
            [input.organizationId, requestedNames],
          );
    const idsByName = groupedMatches(matches.rows);
    const resolved = workbook.people.flatMap((person) => {
      const ids = [...new Set(idsByName.get(person.normalizedFullName) ?? [])];
      return ids.length === 1 ? [{ person, personId: ids[0]! }] : [];
    });
    const unmatched = workbook.people.filter(
      (person) => (idsByName.get(person.normalizedFullName) ?? []).length === 0,
    );
    const ambiguous = workbook.people.filter(
      (person) => new Set(idsByName.get(person.normalizedFullName) ?? []).size > 1,
    );

    let added = 0;
    let markedAttended = 0;
    let alreadyAttended = 0;
    for (const item of resolved) {
      const existing = await client.query<{
        id: string;
        attendance: string;
        decision: string;
      }>(
        `SELECT participation.id, participation.attendance, participation.decision
           FROM event_participations participation
           JOIN persons member ON member.id = participation.person_id
          WHERE participation.event_id = $1
            AND participation.archived_at IS NULL
            AND COALESCE(member.merged_into_person_id, member.id) = $2
          ORDER BY participation.created_at, participation.id
          FOR UPDATE OF participation`,
        [input.eventId, item.personId],
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO event_participations
             (person_id, event_id, registered_at, decision, decision_at,
              attendance, attended_at, data_origin)
           VALUES ($1, $2, now(), 'ACCEPTED', now(), 'ATTENDED',
                   COALESCE($3, now()), 'LIVE')`,
          [item.personId, input.eventId, event.starts_at],
        );
        added += 1;
      } else if (
        existing.rows.every((row) => row.attendance === 'ATTENDED' && row.decision === 'ACCEPTED')
      ) {
        alreadyAttended += 1;
      } else {
        await client.query(
          `UPDATE event_participations
              SET attendance = 'ATTENDED', attended_at = COALESCE(attended_at, $3, now()),
                  decision = 'ACCEPTED',
                  decision_at = CASE WHEN decision = 'ACCEPTED'
                                     THEN decision_at ELSE now() END,
                  updated_at = now(), version = version + 1
            WHERE event_id = $1 AND archived_at IS NULL
              AND person_id IN (
                SELECT id FROM persons WHERE id = $2 OR merged_into_person_id = $2
              )`,
          [input.eventId, item.personId, event.starts_at],
        );
        markedAttended += 1;
      }
    }

    const auditSummary = {
      fileSha256: createHash('sha256').update(input.workbookBytes).digest('hex'),
      worksheetName: workbook.worksheetName,
      dataRows: workbook.dataRows,
      attendedRows: workbook.attendedRows,
      resolved: resolved.length,
      invalid: workbook.invalidPeople.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      added,
      markedAttended,
      alreadyAttended,
      fileStoredInCrm: false,
    };
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_subject, request_id, action, entity_type, entity_id,
          after, reason)
       VALUES ($1, $2, $3, 'event.attendance_xlsx_imported', 'event', $4,
               $5::jsonb, 'XLSX обработан без сохранения копии файла в CRM')`,
      [
        input.actorUserId,
        input.actorSubject,
        input.requestId,
        input.eventId,
        JSON.stringify(auditSummary),
      ],
    );
    await client.query('COMMIT');
    return {
      eventId: input.eventId,
      eventName: event.name,
      dataRows: workbook.dataRows,
      attendedRows: workbook.attendedRows,
      duplicateRows: workbook.duplicateAttendedRows,
      resolved: resolved.length,
      added,
      markedAttended,
      alreadyAttended,
      invalid: workbook.invalidPeople,
      unmatched: unmatched.map((person: AttendanceWorkbookPerson) => ({
        rowNumber: person.rowNumber,
        fullName: person.rawFullName,
      })),
      ambiguous: ambiguous.map((person: AttendanceWorkbookPerson) => ({
        rowNumber: person.rowNumber,
        fullName: person.rawFullName,
      })),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
