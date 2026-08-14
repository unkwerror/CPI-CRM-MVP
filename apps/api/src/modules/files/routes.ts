import { randomUUID } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { incomingObjectKey, Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { requestLockerDownloadUrl } from '../../lib/locker.js';
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

/**
 * Подписанная ссылка для браузера.
 *
 * Хранилище провайдера отвечает не со всех своих адресов: из сетей пользователей
 * часть из них молча отваливается по таймауту, и загрузка падает с сетевой
 * ошибкой. Поэтому браузеру отдаётся адрес на нашем домене, а до облака запрос
 * доводит reverse proxy. Подпись при этом не трогаем: она посчитана для хоста
 * хранилища, и прокси подставляет этот же хост.
 */
export function toBrowserUrl(signedUrl: string, publicBase: string): string {
  if (!publicBase) return signedUrl;
  const signed = new URL(signedUrl);
  const base = new URL(publicBase);
  const prefix = base.pathname.replace(/\/+$/u, '');
  return `${base.origin}${prefix}${signed.pathname}${signed.search}`;
}

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

  // Загрузка файла нужна двум разделам: артефактам и вложениям рассылки.
  const canUpload = app.requireAnyPermission([
    Permissions.ARTIFACTS_WRITE,
    Permissions.CAMPAIGNS_WRITE,
  ]);

  app.post(
    '/files/upload-intents',
    {
      preHandler: canUpload,
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
      const objectKey = incomingObjectKey(app.config.storage.prefix, {
        uploadId: randomUUID(),
        fileName: body.filename,
      });
      const created = await transaction(app.pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO file_objects
             (bucket, object_key, original_filename, declared_mime_type, size_bytes, uploaded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            app.config.storage.bucket,
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
      const signedUpload = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: app.config.storage.bucket,
          Key: objectKey,
          ContentLength: body.sizeBytes,
          ContentType: body.mimeType,
        }),
        { expiresIn: 10 * 60 },
      );
      const uploadUrl = toBrowserUrl(signedUpload, app.config.storage.publicBase);
      return reply.code(201).send({ ...created, uploadUrl, expiresInSeconds: 600 });
    },
  );

  app.post(
    '/files/:id/complete',
    {
      preHandler: canUpload,
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
      // Загрузивший ждёт здесь окончания антивирусной проверки, поэтому маршрут
      // открыт тем же разрешениям, что и сама загрузка.
      preHandler: app.requireAnyPermission([
        Permissions.ARTIFACTS_READ,
        Permissions.CAMPAIGNS_WRITE,
      ]),
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
        storage_provider: 'CRM' | 'LOCKER';
        external_id: string | null;
      }>(
        `SELECT bucket, object_key, original_filename, status,
                storage_provider, external_id
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
      const remote = file.storage_provider === 'LOCKER';
      if (remote && !file.external_id)
        throw new HttpProblem(500, 'У файла Locker отсутствует внешний идентификатор');
      const remoteDownload = remote ? await requestLockerDownloadUrl(app, file.external_id!) : null;
      const downloadUrl = remoteDownload
        ? remoteDownload.url
        : toBrowserUrl(
            await getSignedUrl(
              s3,
              new GetObjectCommand(
                privateDownloadRequest({
                  bucket: file.bucket,
                  objectKey: file.object_key,
                  originalFilename: file.original_filename,
                }),
              ),
              { expiresIn: 5 * 60 },
            ),
            app.config.storage.publicBase,
          );
      await app.pool.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_subject, request_id, action, entity_type, entity_id)
         VALUES ($1, $2, $3, 'file.download_url_issued', 'file_object', $4)`,
        [request.authUser!.userId, request.authUser!.sub, request.id, id],
      );
      return {
        downloadUrl,
        expiresInSeconds: remoteDownload?.expiresInSeconds ?? 300,
      };
    },
  );
}
