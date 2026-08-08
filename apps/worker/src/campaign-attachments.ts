import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';

/**
 * Вложения рассылки: метаданные из базы и байты из хранилища.
 *
 * Файл один, а получателей тысячи, поэтому байты читаются один раз на проход и
 * держатся в памяти: иначе каждое письмо тянуло бы вложение из MinIO заново.
 * Кэш живёт до конца прохода — после утверждения набор файлов не меняется, но
 * держать десятки мегабайт между проходами незачем.
 */

export interface CampaignAttachment {
  readonly kind: 'PHOTO' | 'DOCUMENT';
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

interface AttachmentRow {
  kind: 'PHOTO' | 'DOCUMENT';
  bucket: string;
  object_key: string;
  original_filename: string | null;
  mime_type: string | null;
  status: string;
}

export class CampaignAttachmentStore {
  readonly #cache = new Map<string, Promise<CampaignAttachment[]>>();

  public constructor(
    private readonly pool: Pool,
    private readonly s3: S3Client,
    private readonly privateBucket: string,
  ) {}

  public load(campaignId: string): Promise<CampaignAttachment[]> {
    let pending = this.#cache.get(campaignId);
    if (!pending) {
      pending = this.read(campaignId);
      this.#cache.set(campaignId, pending);
    }
    return pending;
  }

  public clear(): void {
    this.#cache.clear();
  }

  private async read(campaignId: string): Promise<CampaignAttachment[]> {
    const result = await this.pool.query<AttachmentRow>(
      `SELECT attachment.kind, file.bucket, file.object_key, file.original_filename,
              COALESCE(file.detected_mime_type, file.declared_mime_type) AS mime_type,
              file.status
         FROM campaign_attachments attachment
         JOIN file_objects file ON file.id = attachment.file_object_id
        WHERE attachment.campaign_id = $1
        ORDER BY attachment.position`,
      [campaignId],
    );

    const loaded: CampaignAttachment[] = [];
    for (const row of result.rows) {
      // Непроверенный файл не отправляем: до рассылки он мог не пройти антивирус.
      if (row.status !== 'AVAILABLE') continue;
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: row.bucket || this.privateBucket, Key: row.object_key }),
      );
      if (!object.Body) continue;
      loaded.push({
        kind: row.kind,
        fileName: safeFileName(row.original_filename, loaded.length),
        mimeType: row.mime_type ?? 'application/octet-stream',
        bytes: Buffer.from(await object.Body.transformToByteArray()),
      });
    }
    return loaded;
  }
}

/**
 * Провайдер требует уникальные имена без слэшей: имя из загрузки приходит от
 * человека и может быть и путём, и пустой строкой.
 */
function safeFileName(original: string | null, index: number): string {
  const cleaned = (original ?? '').replaceAll(/[/\\]/gu, '_').trim();
  if (cleaned.length > 0 && cleaned.length <= 200) return cleaned;
  if (cleaned.length > 200) return cleaned.slice(-200);
  return `attachment-${String(index + 1)}`;
}
