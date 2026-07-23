import { randomUUID } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const allowedMimePrefixes = [
  'application/pdf',
  'application/zip',
  'text/',
  'image/',
  'application/vnd.openxmlformats-officedocument',
];

export function privateDownloadRequest(input: {
  bucket: string;
  objectKey: string;
  originalFilename: string;
}): GetObjectCommandInput {
  return {
    Bucket: input.bucket,
    Key: input.objectKey,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(input.originalFilename)}`,
    ResponseCacheControl: 'private, no-store, max-age=0',
  };
}

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  const s3 = new S3Client({
    endpoint: app.config.storage.endpoint,
    region: app.config.storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: app.config.storage.accessKey,
      secretAccessKey: app.config.storage.secretKey,
    },
  });

  app.post(
    '/files/upload-intents',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_WRITE),
      schema: {
        tags: ['Файлы'],
        body: Type.Object({
          filename: Type.String({ minLength: 1, maxLength: 255 }),
          mimeType: Type.String({ minLength: 1, maxLength: 200 }),
          sizeBytes: Type.Integer({ minimum: 1, maximum: MAX_FILE_SIZE }),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as { filename: string; mimeType: string; sizeBytes: number };
      if (
        !allowedMimePrefixes.some((allowed) =>
          allowed.endsWith('/')
            ? body.mimeType.startsWith(allowed)
            : body.mimeType === allowed || body.mimeType.startsWith(`${allowed}.`),
        )
      ) {
        throw new HttpProblem(400, 'Тип файла не разрешён');
      }
      const objectKey = `incoming/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
      const created = await transaction(app.pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO file_objects
             (bucket, object_key, original_filename, declared_mime_type, size_bytes, uploaded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            app.config.storage.quarantineBucket,
            objectKey,
            body.filename,
            body.mimeType,
            body.sizeBytes,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'file.upload_intent_created',
          entityType: 'file_object',
          entityId: result.rows[0]!.id,
          after: { mimeType: body.mimeType, sizeBytes: body.sizeBytes },
        });
        return result.rows[0]!;
      });
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: app.config.storage.quarantineBucket,
          Key: objectKey,
          ContentLength: body.sizeBytes,
          ContentType: body.mimeType,
        }),
        { expiresIn: 10 * 60 },
      );
      return reply.code(201).send({ ...created, uploadUrl, expiresInSeconds: 600 });
    },
  );

  app.post(
    '/files/:id/complete',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_WRITE),
      schema: { tags: ['Файлы'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const file = await app.pool.query<{
        bucket: string;
        object_key: string;
        size_bytes: string;
        status: string;
      }>(
        'SELECT bucket, object_key, size_bytes::text, status FROM file_objects WHERE id = $1 AND uploaded_by_user_id = $2',
        [id, request.authUser!.userId],
      );
      const row = file.rows[0];
      if (!row) throw new HttpProblem(404, 'Файл не найден');
      if (row.status !== 'PENDING') throw new HttpProblem(409, 'Загрузка уже завершена');
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: row.bucket, Key: row.object_key }),
      );
      if (Number(head.ContentLength) !== Number(row.size_bytes)) {
        throw new HttpProblem(400, 'Размер загруженного файла не совпадает с заявленным');
      }
      await transaction(app.pool, async (client) => {
        await client.query(
          `UPDATE file_objects SET status = 'SCANNING', updated_at = now() WHERE id = $1`,
          [id],
        );
        await client.query(
          `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
           VALUES ('file_scan_requested', 'file_object', $1, $2::jsonb)`,
          [id, JSON.stringify({ fileObjectId: id })],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'file.upload_completed',
          entityType: 'file_object',
          entityId: id,
        });
      });
      return { id, status: 'SCANNING' };
    },
  );

  app.get(
    '/files/:id',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_READ),
      schema: { tags: ['Файлы'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const result = await app.pool.query(
        `SELECT id, original_filename, declared_mime_type, detected_mime_type,
                size_bytes::text, status, available_at, rejected_at
           FROM file_objects fo
          WHERE fo.id = $1
            AND (fo.uploaded_by_user_id = $2 OR EXISTS (
              SELECT 1 FROM artifact_assets aa
               WHERE aa.file_object_id = fo.id
            ))`,
        [id, request.authUser!.userId],
      );
      if (!result.rows[0]) throw new HttpProblem(404, 'Файл не найден');
      return result.rows[0];
    },
  );

  app.get(
    '/files/:id/download-url',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_READ),
      schema: { tags: ['Файлы'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const result = await app.pool.query<{
        bucket: string;
        object_key: string;
        original_filename: string;
        status: string;
      }>(
        `SELECT bucket, object_key, original_filename, status
           FROM file_objects fo
          WHERE fo.id = $1
            AND (fo.uploaded_by_user_id = $2 OR EXISTS (
              SELECT 1 FROM artifact_assets aa
               WHERE aa.file_object_id = fo.id
            ))`,
        [id, request.authUser!.userId],
      );
      const file = result.rows[0];
      if (!file) throw new HttpProblem(404, 'Файл не найден');
      if (file.status !== 'AVAILABLE') throw new HttpProblem(409, 'Файл ещё не прошёл проверку');
      const downloadUrl = await getSignedUrl(
        s3,
        new GetObjectCommand(
          privateDownloadRequest({
            bucket: file.bucket,
            objectKey: file.object_key,
            originalFilename: file.original_filename,
          }),
        ),
        { expiresIn: 5 * 60 },
      );
      await app.pool.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id)
         VALUES ($1, $2, $3, 'file.download_url_issued', 'file_object', $4)`,
        [request.authUser!.userId, request.authUser!.sub, request.id, id],
      );
      return { downloadUrl, expiresInSeconds: 300 };
    },
  );
}
