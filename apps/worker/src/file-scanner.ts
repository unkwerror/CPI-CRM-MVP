import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Pool } from 'pg';

import { reevaluateVersionsUsingFile } from './artifact-countability.js';
import { scanWithClamAv, type ClamAvOptions, type StreamScanResult } from './clamav.js';
import { inTransaction } from './db.js';
import { detectMimeType } from './mime.js';

interface FileRow {
  id: string;
  bucket: string;
  object_key: string;
  declared_mime_type: string | null;
  size_bytes: string;
  status: 'PENDING' | 'SCANNING' | 'AVAILABLE' | 'REJECTED' | 'QUARANTINED';
  scan_result: Record<string, unknown> | null;
}

export interface FileScannerOptions {
  readonly quarantineBucket: string;
  readonly privateBucket: string;
  readonly clamAv: ClamAvOptions;
}

export class FileScanner {
  public constructor(
    private readonly pool: Pool,
    private readonly s3: S3Client,
    private readonly options: FileScannerOptions,
  ) {}

  public async process(fileObjectId: string): Promise<void> {
    const file = await this.loadFile(fileObjectId);
    if (!file) return;

    if (file.status === 'AVAILABLE') {
      await this.cleanupRecordedSource(file);
      await inTransaction(this.pool, (client) =>
        reevaluateVersionsUsingFile(client, fileObjectId).then(() => undefined),
      );
      return;
    }
    if (file.status === 'REJECTED' || file.status === 'QUARANTINED') {
      await inTransaction(this.pool, (client) =>
        reevaluateVersionsUsingFile(client, fileObjectId).then(() => undefined),
      );
      return;
    }
    if (file.status !== 'SCANNING') {
      throw new Error(`File ${fileObjectId} is ${file.status}, expected SCANNING`);
    }
    if (file.bucket !== this.options.quarantineBucket) {
      await this.finishUnsafeSource(file, 'UNEXPECTED_SOURCE_BUCKET');
      return;
    }

    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: file.bucket, Key: file.object_key }),
    );
    const body = toAsyncIterable(object.Body);
    const scan = await scanWithClamAv(body, this.options.clamAv);
    const detectedMimeType = detectMimeType(scan.header, file.declared_mime_type);

    if (scan.bytes !== Number(file.size_bytes)) {
      await this.finishRejected(file, scan, detectedMimeType, 'SIZE_MISMATCH');
      return;
    }
    if (scan.antivirus.status === 'INFECTED') {
      await this.finishRejected(file, scan, detectedMimeType, 'MALWARE_DETECTED');
      return;
    }

    const privateKey = buildPrivateObjectKey(file.id, scan.sha256);
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.options.privateBucket,
        Key: privateKey,
        CopySource: encodeCopySource(file.bucket, file.object_key),
        MetadataDirective: 'COPY',
      }),
    );

    await inTransaction(this.pool, async (client) => {
      const locked = await client.query<{ status: FileRow['status'] }>(
        'SELECT status FROM file_objects WHERE id = $1 FOR UPDATE',
        [file.id],
      );
      if (!locked.rows[0]) return;
      if (locked.rows[0].status === 'SCANNING') {
        await client.query(
          `UPDATE file_objects
              SET bucket = $2, object_key = $3, sha256 = $4,
                  detected_mime_type = $5, status = 'AVAILABLE',
                  scan_result = $6::jsonb, available_at = now(), rejected_at = null,
                  updated_at = now()
            WHERE id = $1`,
          [
            file.id,
            this.options.privateBucket,
            privateKey,
            scan.sha256,
            detectedMimeType,
            JSON.stringify({
              antivirus: scan.antivirus,
              bytes: scan.bytes,
              source: { bucket: file.bucket, objectKey: file.object_key },
              scannedAt: new Date().toISOString(),
            }),
          ],
        );
      }
      await reevaluateVersionsUsingFile(client, file.id);
    });

    // If this fails, the event is retried. The AVAILABLE branch reads the source
    // coordinates from scan_result and completes this cleanup idempotently.
    await this.deleteObject(file.bucket, file.object_key);
  }

  public async quarantineAfterTerminalFailure(fileObjectId: string, error: Error): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE file_objects
            SET status = 'QUARANTINED', rejected_at = now(),
                scan_result = COALESCE(scan_result, '{}'::jsonb) || $2::jsonb,
                updated_at = now()
          WHERE id = $1 AND status = 'SCANNING'
        RETURNING id`,
        [
          fileObjectId,
          JSON.stringify({
            outcome: 'SCAN_FAILED',
            error: error.message.slice(0, 2_000),
            failedAt: new Date().toISOString(),
          }),
        ],
      );
      if (updated.rowCount) await reevaluateVersionsUsingFile(client, fileObjectId);
    });
  }

  private async loadFile(fileObjectId: string): Promise<FileRow | undefined> {
    const result = await this.pool.query<FileRow>(
      `SELECT id, bucket, object_key, declared_mime_type, size_bytes::text,
              status, scan_result
         FROM file_objects
        WHERE id = $1`,
      [fileObjectId],
    );
    return result.rows[0];
  }

  private async finishRejected(
    file: FileRow,
    scan: StreamScanResult,
    detectedMimeType: string,
    outcome: 'SIZE_MISMATCH' | 'MALWARE_DETECTED',
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE file_objects
            SET sha256 = $2, detected_mime_type = $3, status = 'REJECTED',
                scan_result = $4::jsonb, rejected_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'SCANNING'`,
        [
          file.id,
          scan.sha256,
          detectedMimeType,
          JSON.stringify({
            outcome,
            antivirus: scan.antivirus,
            expectedBytes: Number(file.size_bytes),
            actualBytes: scan.bytes,
            scannedAt: new Date().toISOString(),
          }),
        ],
      );
      await reevaluateVersionsUsingFile(client, file.id);
    });
  }

  private async finishUnsafeSource(file: FileRow, outcome: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE file_objects
            SET status = 'QUARANTINED', rejected_at = now(), scan_result = $2::jsonb,
                updated_at = now()
          WHERE id = $1 AND status = 'SCANNING'`,
        [file.id, JSON.stringify({ outcome, detectedAt: new Date().toISOString() })],
      );
      await reevaluateVersionsUsingFile(client, file.id);
    });
  }

  private async cleanupRecordedSource(file: FileRow): Promise<void> {
    const source = file.scan_result?.source;
    if (!isSourceLocation(source)) return;
    if (source.bucket === file.bucket && source.objectKey === file.object_key) return;
    await this.deleteObject(source.bucket, source.objectKey);
  }

  private async deleteObject(bucket: string, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

export function buildPrivateObjectKey(fileObjectId: string, sha256: string): string {
  return `files/${fileObjectId}/${sha256}`;
}

export function encodeCopySource(bucket: string, key: string): string {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${encodedBucket}/${encodedKey}`;
}

function toAsyncIterable(value: unknown): AsyncIterable<Uint8Array> {
  if (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  ) {
    return value as AsyncIterable<Uint8Array>;
  }
  throw new Error('S3 returned an empty or non-streaming object body');
}

function isSourceLocation(value: unknown): value is { bucket: string; objectKey: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.bucket === 'string' && typeof candidate.objectKey === 'string';
}
