import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  artifactObjectKey,
  campaignObjectKey,
  isInsideSection,
  withCopySuffix,
} from '@cpi-crm/domain';
import type { Pool } from 'pg';

import { inTransaction } from './db.js';
import { encodeCopySource } from './file-scanner.js';

/**
 * Переезд файла в человеческую папку.
 *
 * До отправки артефакта неизвестно ни мероприятие, ни автор, поэтому проверенный
 * файл лежит в служебной папке `checked/` под своим идентификатором. Как только
 * версия отправлена, файл переезжает в `artifacts/<Мероприятие>/<Участник>/`, и
 * выгрузка бакета по SFTP становится обычным деревом папок, а не свалкой UUID.
 *
 * Имя папки фиксируется в момент переезда: переименование мероприятия задним
 * числом не должно трогать ключи уже сохранённых доказательств.
 */

export interface FileRelocatorOptions {
  readonly bucket: string;
  readonly prefix: string;
}

interface ArtifactFileRow {
  status: string;
  bucket: string;
  object_key: string;
  original_filename: string | null;
  storage_provider: 'CRM' | 'LOCKER';
  scan_result: Record<string, unknown> | null;
  event_name: string | null;
  person_name: string | null;
}

interface CampaignFileRow {
  status: string;
  bucket: string;
  object_key: string;
  original_filename: string | null;
  storage_provider: 'CRM' | 'LOCKER';
  scan_result: Record<string, unknown> | null;
  campaign_name: string | null;
}

/** Ждать проверку антивирусом дольше нескольких попыток бессмысленно. */
class ScanNotFinishedError extends Error {
  public constructor(fileObjectId: string, status: string) {
    super(`File ${fileObjectId} is ${status}, relocation waits for AVAILABLE`);
    this.name = 'ScanNotFinishedError';
  }
}

export class FileRelocator {
  public constructor(
    private readonly pool: Pool,
    private readonly s3: S3Client,
    private readonly options: FileRelocatorOptions,
  ) {}

  public async relocateArtifactFile(
    fileObjectId: string,
    artifactVersionId: string,
  ): Promise<void> {
    const result = await this.pool.query<ArtifactFileRow>(
      `SELECT file.status, file.bucket, file.object_key, file.original_filename,
              file.storage_provider, file.scan_result,
              event.name AS event_name,
              author.canonical_full_name AS person_name
         FROM file_objects file
         JOIN artifact_assets asset
           ON asset.file_object_id = file.id AND asset.artifact_version_id = $2
         JOIN artifact_versions version ON version.id = asset.artifact_version_id
         JOIN artifacts artifact ON artifact.id = version.artifact_id
         LEFT JOIN events event ON event.id = artifact.event_id
         LEFT JOIN LATERAL (
           SELECT person.canonical_full_name
             FROM artifact_version_contributors contributor
             JOIN persons person ON person.id = contributor.person_id
            WHERE contributor.artifact_version_id = version.id
              AND contributor.contribution_role = 'AUTHOR'
            ORDER BY person.canonical_full_name
            LIMIT 1
         ) author ON true
        WHERE file.id = $1`,
      [fileObjectId, artifactVersionId],
    );
    const file = result.rows[0];
    if (!file) return;
    const target = artifactObjectKey(this.options.prefix, {
      eventName: file.event_name,
      personName: file.person_name ?? '',
      fileName: file.original_filename ?? 'файл',
    });
    await this.relocate(fileObjectId, file, target, 'artifacts');
  }

  public async relocateCampaignAttachment(fileObjectId: string, campaignId: string): Promise<void> {
    const result = await this.pool.query<CampaignFileRow>(
      `SELECT file.status, file.bucket, file.object_key, file.original_filename,
              file.storage_provider, file.scan_result,
              campaign.name AS campaign_name
         FROM file_objects file
         JOIN campaign_attachments attachment
           ON attachment.file_object_id = file.id AND attachment.campaign_id = $2
         JOIN campaigns campaign ON campaign.id = attachment.campaign_id
        WHERE file.id = $1`,
      [fileObjectId, campaignId],
    );
    const file = result.rows[0];
    if (!file) return;
    const target = campaignObjectKey(this.options.prefix, {
      campaignName: file.campaign_name ?? '',
      fileName: file.original_filename ?? 'файл',
    });
    await this.relocate(fileObjectId, file, target, 'campaigns');
  }

  private async relocate(
    fileObjectId: string,
    file: {
      status: string;
      bucket: string;
      object_key: string;
      storage_provider: 'CRM' | 'LOCKER';
      scan_result: Record<string, unknown> | null;
    },
    desiredKey: string,
    section: string,
  ): Promise<void> {
    // Файлы бота живут в его собственном разделе, CRM их только читает по ссылке.
    if (file.storage_provider !== 'CRM') return;
    if (file.bucket !== this.options.bucket) return;
    // Отклонённый антивирусом файл никуда не переезжает: артефакт с ним всё равно
    // не станет засчитанным, а держать заражённые байты рядом с чистыми нельзя.
    if (file.status === 'REJECTED' || file.status === 'QUARANTINED') return;
    if (file.status !== 'AVAILABLE') throw new ScanNotFinishedError(fileObjectId, file.status);

    if (isInsideSection(file.object_key, this.options.prefix, section)) {
      await this.cleanupRecordedSource(file);
      return;
    }

    const target = await this.findFreeKey(desiredKey);
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.options.bucket,
        Key: target,
        CopySource: encodeCopySource(file.bucket, file.object_key),
        MetadataDirective: 'COPY',
      }),
    );
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE file_objects
            SET object_key = $2,
                scan_result = COALESCE(scan_result, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          WHERE id = $1 AND status = 'AVAILABLE'`,
        [
          fileObjectId,
          target,
          JSON.stringify({
            relocatedFrom: { bucket: file.bucket, objectKey: file.object_key },
            relocatedAt: new Date().toISOString(),
          }),
        ],
      );
    });
    // Падение здесь не теряет файл: событие повторится, увидит записанный источник
    // и доудалит его.
    await this.s3.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.object_key }));
  }

  /** Одинаковые имена от разных участников разводятся суффиксом, как в проводнике. */
  private async findFreeKey(desiredKey: string): Promise<string> {
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const candidate = withCopySuffix(desiredKey, attempt);
      if (!(await this.exists(candidate))) return candidate;
    }
    throw new Error(`No free object key for ${desiredKey} after 50 attempts`);
  }

  private async exists(objectKey: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  private async cleanupRecordedSource(file: {
    bucket: string;
    object_key: string;
    scan_result: Record<string, unknown> | null;
  }): Promise<void> {
    const source = file.scan_result?.relocatedFrom;
    if (!isSourceLocation(source)) return;
    if (source.bucket === file.bucket && source.objectKey === file.object_key) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.objectKey }));
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}

function isSourceLocation(value: unknown): value is { bucket: string; objectKey: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.bucket === 'string' && typeof candidate.objectKey === 'string';
}
