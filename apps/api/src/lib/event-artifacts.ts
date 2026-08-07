/**
 * Артефакты мероприятия.
 *
 * Список строится от `artifacts.event_id`, а не от участников: артефакт,
 * автор которого не записан в мероприятие, тоже должен быть виден — именно
 * такие случаи чинит привязка артефакта к участнику.
 */

export interface EventArtifactFileRow {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  status: string;
  storageProvider: 'CRM' | 'LOCKER';
}

export interface EventArtifactRow {
  id: string;
  title: string;
  typeName: string;
  status: string;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  latestVersionStatus: string | null;
  submittedAt: string | null;
  score: number | null;
  decision: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  source: 'LOCKER' | 'CRM';
  authors: { id: string; name: string; isParticipant: boolean }[];
  files: EventArtifactFileRow[];
  externalUrls: string[];
  /** Ни один автор не записан в участники мероприятия — кандидат на привязку. */
  authorOutsideEvent: boolean;
}

/**
 * Ожидает $1 = eventId. Выдаёт по строке на артефакт мероприятия.
 * Авторы и файлы приходят готовым JSON, чтобы не делать N+1 запросов.
 */
export const EVENT_ARTIFACTS_SQL = `
  WITH event_participants AS (
    SELECT DISTINCT COALESCE(observed.merged_into_person_id, observed.id) AS person_id
      FROM event_participations participation
      JOIN persons observed ON observed.id = participation.person_id
     WHERE participation.event_id = $1
       AND participation.archived_at IS NULL
       AND observed.archived_at IS NULL
  )
  SELECT artifact.id,
         artifact.title,
         artifact_type.name AS type_name,
         artifact.status,
         latest.id AS latest_version_id,
         latest.version_number,
         latest.status AS latest_version_status,
         latest.submitted_at,
         review.score,
         review.decision::text AS decision,
         review.reviewed_at,
         reviewer.display_name AS reviewer_name,
         COALESCE(authors.items, '[]'::jsonb) AS authors,
         COALESCE(assets.files, '[]'::jsonb) AS files,
         COALESCE(assets.external_urls, '[]'::jsonb) AS external_urls,
         COALESCE(assets.has_locker, false) AS has_locker
    FROM artifacts artifact
    JOIN artifact_types artifact_type ON artifact_type.id = artifact.type_id
    LEFT JOIN LATERAL (
      SELECT version.id, version.version_number, version.status, version.submitted_at
        FROM artifact_versions version
       WHERE version.artifact_id = artifact.id AND version.status <> 'VOIDED'
       ORDER BY version.version_number DESC
       LIMIT 1
    ) latest ON true
    LEFT JOIN artifact_review_selections selection ON selection.artifact_version_id = latest.id
    LEFT JOIN artifact_reviews review ON review.id = selection.current_final_review_id
    LEFT JOIN app_users reviewer ON reviewer.id = review.reviewer_user_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'id', author.id,
               'name', author.canonical_full_name,
               'isParticipant', EXISTS (
                 SELECT 1 FROM event_participants ep WHERE ep.person_id = author.id
               )
             )) AS items
        FROM artifact_version_contributors contributor
        JOIN persons observed_author ON observed_author.id = contributor.person_id
        JOIN persons author
          ON author.id = COALESCE(observed_author.merged_into_person_id, observed_author.id)
       WHERE contributor.artifact_version_id = latest.id
         AND contributor.contribution_role = 'AUTHOR'
    ) authors ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'id', file.id,
               'fileName', file.original_filename,
               'sizeBytes', file.size_bytes,
               'status', file.status,
               'storageProvider', file.storage_provider
             )) FILTER (WHERE file.id IS NOT NULL) AS files,
             jsonb_agg(DISTINCT asset.external_url)
               FILTER (WHERE asset.external_url IS NOT NULL) AS external_urls,
             bool_or(file.storage_provider = 'LOCKER') AS has_locker
        FROM artifact_assets asset
        LEFT JOIN file_objects file ON file.id = asset.file_object_id
       WHERE asset.artifact_version_id = latest.id
    ) assets ON true
   WHERE artifact.event_id = $1
     AND artifact.status <> 'VOIDED'
     AND artifact.archived_at IS NULL
   ORDER BY latest.submitted_at DESC NULLS LAST, artifact.title, artifact.id
`;

interface RawEventArtifactRow {
  id: string;
  title: string;
  type_name: string;
  status: string;
  latest_version_id: string | null;
  version_number: number | null;
  latest_version_status: string | null;
  submitted_at: Date | null;
  score: number | null;
  decision: string | null;
  reviewed_at: Date | null;
  reviewer_name: string | null;
  authors: { id: string; name: string; isParticipant: boolean }[] | null;
  files: EventArtifactFileRow[] | null;
  external_urls: string[] | null;
  has_locker: boolean;
}

export function mapEventArtifactRow(row: RawEventArtifactRow): EventArtifactRow {
  const authors = row.authors ?? [];
  return {
    id: row.id,
    title: row.title,
    typeName: row.type_name,
    status: row.status,
    latestVersionId: row.latest_version_id,
    latestVersionNumber: row.version_number,
    latestVersionStatus: row.latest_version_status,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    score: row.score,
    decision: row.decision,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewerName: row.reviewer_name,
    source: row.has_locker ? 'LOCKER' : 'CRM',
    authors,
    files: row.files ?? [],
    externalUrls: row.external_urls ?? [],
    authorOutsideEvent: authors.length === 0 || authors.every((author) => !author.isParticipant),
  };
}
