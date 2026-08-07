/**
 * Возможные дубли внутри мероприятия.
 *
 * Телеграм-бот заводит личность по имени из профиля, поэтому у неё нет
 * нормального ФИО, зато есть артефакты. Зарегистрированный участник, наоборот,
 * заведён с полным ФИО и без артефактов. Такие пары и предлагаются к слиянию.
 *
 * Личности без валидного ФИО прячет гигиена участников (`archived_at`), но
 * артефакты остаются в мероприятии — поэтому со стороны «неполных» карточки
 * в архиве обязаны попадать в выдачу: иначе чинить нечего и нечем.
 */

export interface EventDuplicateCandidateRow {
  id: string;
  canonicalFullName: string;
  telegram: string | null;
  artifactCount: number;
  createdAt: string | null;
  /** Карточку спрятала гигиена ФИО — в реестре участников её не найти. */
  hidden: boolean;
  suggestions: {
    id: string;
    canonicalFullName: string;
    telegram: string | null;
    /** Совпал хотя бы один токен имени — такую пару стоит показывать первой. */
    nameOverlap: boolean;
    openCandidateId: string | null;
  }[];
}

/** Ожидает $1 = eventId. */
export const EVENT_DUPLICATE_SUGGESTIONS_SQL = `
  WITH cluster_members AS (
    SELECT DISTINCT COALESCE(observed.merged_into_person_id, observed.id) AS person_id
      FROM event_participations participation
      JOIN persons observed ON observed.id = participation.person_id
     WHERE participation.event_id = $1
       AND participation.archived_at IS NULL
       AND observed.archived_at IS NULL
    UNION
    SELECT DISTINCT COALESCE(observed.merged_into_person_id, observed.id) AS person_id
      FROM artifacts artifact
      JOIN artifact_versions version ON version.artifact_id = artifact.id
      JOIN artifact_version_contributors contributor
        ON contributor.artifact_version_id = version.id
       AND contributor.contribution_role = 'AUTHOR'
      JOIN persons observed ON observed.id = contributor.person_id
     WHERE artifact.event_id = $1
       AND artifact.archived_at IS NULL
       AND artifact.status <> 'VOIDED'
  ), members AS (
    SELECT person.id,
           person.canonical_full_name,
           person.last_name,
           person.first_name,
           person.created_at,
           person.archived_at IS NOT NULL AS hidden,
           COALESCE(
             (SELECT contact.raw_value
                FROM contact_points contact
               WHERE contact.person_id = person.id
                 AND contact.type = 'TELEGRAM'
                 AND contact.archived_at IS NULL
               ORDER BY contact.is_primary DESC, contact.created_at
               LIMIT 1),
             -- У личностей, заведённых ботом, контактов нет вовсе: единственная
             -- зацепка для оператора — Telegram ID из отправки в Locker.
             (SELECT 'ID ' || link.telegram_user_id
                FROM locker_submission_links link
               WHERE link.person_id = person.id
                 AND link.telegram_user_id IS NOT NULL
               ORDER BY link.created_at
               LIMIT 1)
           ) AS telegram,
           (SELECT count(DISTINCT artifact.id)
              FROM artifacts artifact
              JOIN artifact_versions version ON version.artifact_id = artifact.id
              JOIN artifact_version_contributors contributor
                ON contributor.artifact_version_id = version.id
               AND contributor.contribution_role = 'AUTHOR'
              JOIN persons observed ON observed.id = contributor.person_id
             WHERE artifact.event_id = $1
               AND artifact.archived_at IS NULL
               AND artifact.status <> 'VOIDED'
               AND COALESCE(observed.merged_into_person_id, observed.id) = person.id
           ) AS artifact_count
      FROM cluster_members
      JOIN persons person ON person.id = cluster_members.person_id
     WHERE person.merged_into_person_id IS NULL
  ), incomplete AS (
    SELECT * FROM members
     WHERE (last_name IS NULL OR first_name IS NULL) AND artifact_count > 0
  ), complete AS (
    SELECT * FROM members
     WHERE last_name IS NOT NULL AND first_name IS NOT NULL
       AND artifact_count = 0 AND NOT hidden
  )
  SELECT incomplete.id,
         incomplete.canonical_full_name,
         incomplete.telegram,
         incomplete.artifact_count::text AS artifact_count,
         incomplete.created_at,
         incomplete.hidden,
         COALESCE(
           (SELECT jsonb_agg(suggestion ORDER BY suggestion->>'sortKey')
              FROM (
                SELECT jsonb_build_object(
                         'id', complete.id,
                         'canonicalFullName', complete.canonical_full_name,
                         'telegram', complete.telegram,
                         'nameOverlap', overlap.matched,
                         'openCandidateId', (
                           SELECT dc.id FROM duplicate_candidates dc
                            WHERE dc.status = 'OPEN'
                              AND dc.person_a_id = LEAST(incomplete.id, complete.id)
                              AND dc.person_b_id = GREATEST(incomplete.id, complete.id)
                            LIMIT 1
                         ),
                         'sortKey', CASE WHEN overlap.matched THEN '0' ELSE '1' END
                                      || complete.canonical_full_name
                       ) AS suggestion
                  FROM complete
                  CROSS JOIN LATERAL (
                    SELECT EXISTS (
                      SELECT 1
                        FROM unnest(string_to_array(lower(incomplete.canonical_full_name), ' ')) token
                       WHERE char_length(token) >= 3
                         AND lower(complete.canonical_full_name) LIKE '%' || token || '%'
                    ) AS matched
                  ) overlap
                  WHERE NOT EXISTS (
                    SELECT 1 FROM not_duplicate_pairs pair
                     WHERE pair.person_a_id = LEAST(incomplete.id, complete.id)
                       AND pair.person_b_id = GREATEST(incomplete.id, complete.id)
                  )
              ) ranked
           ),
           '[]'::jsonb
         ) AS suggestions
    FROM incomplete
   ORDER BY incomplete.artifact_count DESC, incomplete.canonical_full_name
`;

interface RawSuggestion {
  id: string;
  canonicalFullName: string;
  telegram: string | null;
  nameOverlap: boolean;
  openCandidateId: string | null;
  sortKey?: string;
}

interface RawDuplicateRow {
  id: string;
  canonical_full_name: string;
  telegram: string | null;
  artifact_count: string;
  created_at: Date | null;
  hidden: boolean;
  suggestions: RawSuggestion[] | null;
}

export function mapEventDuplicateRow(row: RawDuplicateRow): EventDuplicateCandidateRow {
  return {
    id: row.id,
    canonicalFullName: row.canonical_full_name,
    telegram: row.telegram,
    artifactCount: Number(row.artifact_count),
    createdAt: row.created_at?.toISOString() ?? null,
    hidden: row.hidden,
    suggestions: (row.suggestions ?? []).map((suggestion) => ({
      id: suggestion.id,
      canonicalFullName: suggestion.canonicalFullName,
      telegram: suggestion.telegram,
      nameOverlap: suggestion.nameOverlap,
      openCandidateId: suggestion.openCandidateId,
    })),
  };
}
