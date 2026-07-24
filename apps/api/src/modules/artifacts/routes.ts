import {
  CreateArtifactBody,
  CreateArtifactVersionBody,
  ReviewArtifactVersionBody,
  SubmitArtifactVersionBody,
} from '@cpi-crm/contracts';
import {
  ARTIFACT_QUALITY_CRITERIA,
  Permissions,
  Roles,
  SystemClock,
  assertSubmittedAtIsNotFuture,
  computeArtifactScore,
  createContentFingerprint,
  hasPermission,
  isQualityArtifact,
  normalizeExternalUrl,
  parseArtifactCriteria,
  parseQualityScore,
} from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { writeAudit } from '../../lib/audit.js';
import { beginIdempotentRequest } from '../../lib/idempotency.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import { recalculatePersonLifecycle } from './lifecycle-service.js';

export async function registerArtifactRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/artifact-types',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_READ),
      schema: { tags: ['Артефакты'] },
    },
    async () => {
      const result = await app.pool.query(
        'SELECT id, code, name, description FROM artifact_types WHERE archived_at IS NULL ORDER BY name',
      );
      return { items: result.rows };
    },
  );

  app.get(
    '/artifacts',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_READ),
      schema: {
        tags: ['Артефакты'],
        summary: 'Реестр артефактов',
        querystring: Type.Object({
          q: Type.Optional(Type.String()),
          review: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
      },
    },
    async (request) => {
      const query = request.query as { q?: string; review?: string; limit?: number };
      const organization = await getOrganizationContext(app.pool);
      const values: unknown[] = [organization.id];
      const where = ["a.status <> 'VOIDED'", 'a.organization_id = $1'];
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        where.push(
          `(a.title ILIKE $${values.length} OR at.name ILIKE $${values.length} OR EXISTS (SELECT 1 FROM artifact_versions sv JOIN artifact_version_contributors sc ON sc.artifact_version_id = sv.id JOIN persons contributor ON contributor.id = sc.person_id JOIN persons sp ON sp.id = COALESCE(contributor.merged_into_person_id, contributor.id) WHERE sv.artifact_id = a.id AND (sp.canonical_full_name ILIKE $${values.length} OR contributor.canonical_full_name ILIKE $${values.length})))`,
        );
      }
      if (query.review === 'pending')
        where.push('latest.version_id IS NOT NULL AND latest.score IS NULL');
      values.push(query.limit ?? 50);
      const result = await app.pool.query(
        `SELECT a.id, a.title, at.name AS type_name, a.status,
                latest.version_id, latest.version_number, latest.version_status,
                latest.submitted_at, latest.score,
                COALESCE(latest.authors, '[]'::jsonb) AS authors
           FROM artifacts a
           JOIN artifact_types at ON at.id = a.type_id
           LEFT JOIN LATERAL (
             SELECT av.id AS version_id, av.version_number, av.status AS version_status,
                    av.submitted_at, ar.score,
                    COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.canonical_full_name)) FILTER (WHERE avc.contribution_role = 'AUTHOR'), '[]'::jsonb) AS authors
               FROM artifact_versions av
               LEFT JOIN artifact_version_contributors avc ON avc.artifact_version_id = av.id
               LEFT JOIN persons contributor ON contributor.id = avc.person_id
               LEFT JOIN persons p ON p.id = COALESCE(contributor.merged_into_person_id, contributor.id)
               LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id
               LEFT JOIN artifact_reviews ar ON ar.id = ars.current_final_review_id
              WHERE av.artifact_id = a.id AND av.status <> 'VOIDED'
              GROUP BY av.id, ar.score
              ORDER BY av.version_number DESC
              LIMIT 1
           ) latest ON true
          WHERE ${where.join(' AND ')}
          ORDER BY latest.submitted_at DESC NULLS LAST, a.created_at DESC
          LIMIT $${values.length}`,
        values,
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          typeName: row.type_name,
          status: row.status,
          latestVersionId: row.version_id,
          latestVersionNumber: row.version_number,
          latestVersionStatus: row.version_status,
          submittedAt: row.submitted_at?.toISOString() ?? null,
          score: row.score,
          authors: row.authors,
        })),
      };
    },
  );

  app.get(
    '/artifact-versions/:id',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_READ),
      schema: {
        tags: ['Артефакты'],
        summary: 'Открыть конкретную версию артефакта',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (request) => {
      const versionId = (request.params as { id: string }).id;
      const organization = await getOrganizationContext(app.pool);
      const version = await app.pool.query(
        `SELECT av.id, av.artifact_id, a.title, at.name AS type_name,
                av.version_number, av.status, av.content_type, av.text_content,
                av.submitted_at, ar.id AS review_id, ar.score, ar.decision,
                ar.comment, ar.reviewed_at, reviewer.display_name AS reviewer_name
           FROM artifact_versions av
           JOIN artifacts a ON a.id = av.artifact_id
           JOIN artifact_types at ON at.id = a.type_id
           LEFT JOIN artifact_review_selections ars ON ars.artifact_version_id = av.id
           LEFT JOIN artifact_reviews ar ON ar.id = ars.current_final_review_id
           LEFT JOIN app_users reviewer ON reviewer.id = ar.reviewer_user_id
          WHERE av.id = $1 AND a.organization_id = $2
            AND av.status <> 'VOIDED' AND a.status <> 'VOIDED'`,
        [versionId, organization.id],
      );
      const row = version.rows[0];
      if (!row) throw new HttpProblem(404, 'Версия артефакта не найдена');

      const [contributors, assets] = await Promise.all([
        app.pool.query(
          `SELECT DISTINCT p.id, p.canonical_full_name AS name, avc.contribution_role AS role
             FROM artifact_version_contributors avc
             JOIN persons contributor ON contributor.id = avc.person_id
             JOIN persons p ON p.id = COALESCE(contributor.merged_into_person_id, contributor.id)
            WHERE avc.artifact_version_id = $1
            ORDER BY avc.contribution_role, p.canonical_full_name`,
          [versionId],
        ),
        app.pool.query(
          `SELECT aa.asset_type, aa.external_url, fo.id AS file_id,
                  fo.original_filename, fo.status AS file_status
             FROM artifact_assets aa
             LEFT JOIN file_objects fo ON fo.id = aa.file_object_id
            WHERE aa.artifact_version_id = $1
            ORDER BY aa.display_order, aa.id`,
          [versionId],
        ),
      ]);

      return {
        id: row.id,
        artifactId: row.artifact_id,
        title: row.title,
        typeName: row.type_name,
        versionNumber: row.version_number,
        status: row.status,
        contentType: row.content_type,
        textContent: row.text_content,
        submittedAt: row.submitted_at?.toISOString() ?? null,
        canReview: hasPermission(request.authUser!.roles, Permissions.ARTIFACTS_REVIEW),
        contributors: contributors.rows.map((item) => ({
          id: item.id,
          name: item.name,
          role: item.role,
        })),
        externalUrls: assets.rows
          .filter((item) => item.asset_type === 'EXTERNAL_URL' && item.external_url)
          .map((item) => item.external_url),
        files: assets.rows
          .filter((item) => item.asset_type === 'FILE' && item.file_id)
          .map((item) => ({
            id: item.file_id,
            fileName: item.original_filename,
            status: item.file_status,
          })),
        currentReview: row.review_id
          ? {
              id: row.review_id,
              score: row.score,
              decision: row.decision,
              comment: row.comment,
              reviewerName: row.reviewer_name,
              reviewedAt: row.reviewed_at.toISOString(),
            }
          : null,
      };
    },
  );

  app.post(
    '/artifacts',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_WRITE),
      schema: {
        tags: ['Артефакты'],
        summary: 'Создать контейнер артефакта',
        body: CreateArtifactBody,
      },
    },
    async (request, reply) => {
      const body = request.body as {
        title: string;
        typeCode: string;
        description?: string;
        eventId?: string;
      };
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        const type = await client.query<{ id: string }>(
          'SELECT id FROM artifact_types WHERE code = $1 AND archived_at IS NULL',
          [body.typeCode],
        );
        if (!type.rows[0]) throw new HttpProblem(400, 'Неизвестный тип артефакта');
        if (body.eventId) await assertArtifactEventAvailable(client, body.eventId, organization.id);
        const result = await client.query<{ id: string }>(
          `INSERT INTO artifacts
             (organization_id, type_id, title, description, event_id, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            organization.id,
            type.rows[0].id,
            body.title.trim(),
            body.description?.trim() || null,
            body.eventId ?? null,
            request.authUser!.userId,
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'artifact.created',
          entityType: 'artifact',
          entityId: result.rows[0]!.id,
          after: {
            title: body.title,
            typeCode: body.typeCode,
            eventId: body.eventId ?? null,
          },
        });
        return result.rows[0];
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/artifacts/:id/versions',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_WRITE),
      schema: {
        tags: ['Артефакты'],
        summary: 'Создать неизменяемую редакцию',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: CreateArtifactVersionBody,
      },
    },
    async (request, reply) => {
      const artifactId = (request.params as { id: string }).id;
      const body = request.body as {
        contentType: 'FILE' | 'EXTERNAL_URL' | 'TEXT' | 'MIXED';
        textContent?: string;
        externalUrls?: string[];
        fileObjectIds?: string[];
        contributors: Array<{
          personId: string;
          role: 'AUTHOR' | 'CONTRIBUTOR';
          description?: string;
        }>;
      };
      const urls = (body.externalUrls ?? []).map(normalizeExternalUrl);
      const organization = await getOrganizationContext(app.pool);
      const created = await transaction(app.pool, async (client) => {
        const artifact = await client.query<{ id: string; event_id: string | null }>(
          `SELECT id, event_id
             FROM artifacts
            WHERE id = $1 AND organization_id = $2 AND status <> 'VOIDED'
            FOR UPDATE`,
          [artifactId, organization.id],
        );
        if (!artifact.rows[0]) throw new HttpProblem(404, 'Артефакт не найден');
        const canonicalContributors = await canonicalizeContributors(
          client,
          body.contributors,
          organization.id,
        );
        if (!canonicalContributors.some((item) => item.role === 'AUTHOR'))
          throw new HttpProblem(400, 'Нужен хотя бы один автор');
        if (artifact.rows[0].event_id) {
          const authorIds = canonicalContributors
            .filter((item) => item.role === 'AUTHOR')
            .map((item) => item.personId);
          await assertArtifactEventHasAuthor(client, artifact.rows[0].event_id, authorIds);
        }
        const files = body.fileObjectIds?.length
          ? await client.query<{ id: string; sha256: string | null }>(
              'SELECT id, sha256 FROM file_objects WHERE id = ANY($1::uuid[])',
              [body.fileObjectIds],
            )
          : { rows: [] as Array<{ id: string; sha256: string | null }> };
        if (files.rows.length !== (body.fileObjectIds?.length ?? 0))
          throw new HttpProblem(400, 'Один из файлов не найден');
        const hasContent = Boolean(body.textContent?.trim() || urls.length || files.rows.length);
        const canFingerprint = hasContent && files.rows.every((file) => file.sha256);
        const fingerprint = canFingerprint
          ? createContentFingerprint({
              ...(body.textContent !== undefined ? { text: body.textContent } : {}),
              urls,
              fileSha256s: files.rows.map((file) => file.sha256!),
            })
          : null;
        const next = await client.query<{ version_number: number }>(
          'SELECT COALESCE(max(version_number), 0) + 1 AS version_number FROM artifact_versions WHERE artifact_id = $1',
          [artifactId],
        );
        const version = await client.query<{ id: string }>(
          `INSERT INTO artifact_versions
             (artifact_id, version_number, content_type, text_content, content_fingerprint,
              uploaded_by_user_id, data_origin, countability_reasons)
           VALUES ($1, $2, $3, $4, $5, $6, 'LIVE', '{}'::jsonb)
           RETURNING id`,
          [
            artifactId,
            next.rows[0]!.version_number,
            body.contentType,
            body.textContent?.trim() || null,
            fingerprint,
            request.authUser!.userId,
          ],
        );
        for (const contributor of canonicalContributors) {
          await client.query(
            `INSERT INTO artifact_version_contributors
               (artifact_version_id, person_id, contribution_role, contribution_description, authorship_source)
             VALUES ($1, $2, $3, $4, 'USER_SELECTED')`,
            [
              version.rows[0]!.id,
              contributor.personId,
              contributor.role,
              contributor.description ?? null,
            ],
          );
        }
        let displayOrder = 0;
        for (const file of files.rows) {
          await client.query(
            `INSERT INTO artifact_assets (artifact_version_id, asset_type, file_object_id, display_order) VALUES ($1, 'FILE', $2, $3)`,
            [version.rows[0]!.id, file.id, displayOrder++],
          );
        }
        for (const url of urls) {
          await client.query(
            `INSERT INTO artifact_assets (artifact_version_id, asset_type, external_url, display_order) VALUES ($1, 'EXTERNAL_URL', $2, $3)`,
            [version.rows[0]!.id, url, displayOrder++],
          );
        }
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'artifact_version.created',
          entityType: 'artifact_version',
          entityId: version.rows[0]!.id,
          after: {
            artifactId,
            contentType: body.contentType,
            contributors: canonicalContributors.map(({ personId, role }) => ({ personId, role })),
            assetCount: displayOrder,
          },
        });
        return version.rows[0];
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/artifact-versions/:id/submit',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_WRITE),
      schema: {
        tags: ['Артефакты'],
        summary: 'Отправить версию',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: SubmitArtifactVersionBody,
      },
    },
    async (request, reply) => {
      const versionId = (request.params as { id: string }).id;
      const body = request.body as { submittedAt?: string; backdateReason?: string };
      const idempotency = await beginIdempotentRequest(app.pool, {
        subject: request.authUser!.sub,
        route: `/artifact-versions/${versionId}/submit`,
        key: headerValue(request.headers['idempotency-key']),
        payload: body,
      });
      if (idempotency.replay) return reply.code(idempotency.status).send(idempotency.body);
      try {
        const submittedAt = body.submittedAt ? new Date(body.submittedAt) : new Date();
        try {
          assertSubmittedAtIsNotFuture(submittedAt, new SystemClock());
        } catch {
          throw new HttpProblem(
            400,
            'Некорректная дата отправки',
            'Дата не может быть более чем на 5 минут в будущем.',
          );
        }
        const isBackdated = Date.now() - submittedAt.getTime() > 5 * 60 * 1000;
        if (isBackdated) {
          const allowed = request.authUser!.roles.some(
            (role) =>
              role === Roles.ADMIN ||
              role === Roles.COMMUNITY_MANAGER ||
              role === Roles.DATA_STEWARD,
          );
          if (!allowed) throw new HttpProblem(403, 'Недостаточно прав для даты задним числом');
          if (!body.backdateReason?.trim())
            throw new HttpProblem(400, 'Укажите причину даты задним числом');
        }
        const result = await transaction(app.pool, async (client) => {
          const version = await client.query<{
            id: string;
            artifact_id: string;
            status: string;
            content_type: string;
            text_content: string | null;
          }>(
            'SELECT id, artifact_id, status, content_type, text_content FROM artifact_versions WHERE id = $1 FOR UPDATE',
            [versionId],
          );
          const row = version.rows[0];
          if (!row) throw new HttpProblem(404, 'Версия не найдена');
          if (row.status !== 'DRAFT')
            throw new HttpProblem(409, 'Версия уже отправлена или аннулирована');
          const contributors = await client.query<{ person_id: string; contribution_role: string }>(
            'SELECT person_id, contribution_role FROM artifact_version_contributors WHERE artifact_version_id = $1',
            [versionId],
          );
          const authorIds = contributors.rows
            .filter((item) => item.contribution_role === 'AUTHOR')
            .map((item) => item.person_id);
          if (!authorIds.length)
            throw new HttpProblem(400, 'Нужен хотя бы один явно выбранный автор');
          const assets = await client.query<{
            asset_type: 'FILE' | 'EXTERNAL_URL';
            external_url: string | null;
            status: string | null;
            sha256: string | null;
          }>(
            `SELECT aa.asset_type, aa.external_url, fo.status, fo.sha256 FROM artifact_assets aa LEFT JOIN file_objects fo ON fo.id = aa.file_object_id WHERE aa.artifact_version_id = $1 ORDER BY aa.display_order`,
            [versionId],
          );
          const urls = assets.rows
            .filter((item) => item.asset_type === 'EXTERNAL_URL' && item.external_url)
            .map((item) => item.external_url!);
          const fileAssets = assets.rows.filter((item) => item.asset_type === 'FILE');
          const hasContent = Boolean(row.text_content?.trim() || urls.length || fileAssets.length);
          if (!hasContent)
            throw new HttpProblem(400, 'Версия не содержит файла, ссылки или текста');
          const allFilesAvailable = fileAssets.every(
            (item) => item.status === 'AVAILABLE' && item.sha256,
          );
          const fileCheckPending = fileAssets.length > 0 && !allFilesAvailable;
          const fingerprint = allFilesAvailable
            ? createContentFingerprint({
                text: row.text_content,
                urls,
                fileSha256s: fileAssets.map((item) => item.sha256!),
              })
            : fileAssets.length === 0
              ? createContentFingerprint({ text: row.text_content, urls })
              : null;
          const qualifies = hasContent && !fileCheckPending;
          await client.query(
            `UPDATE artifact_versions
              SET status = 'SUBMITTED', submitted_at = $2, recorded_at = now(),
                  content_fingerprint = $3, backdate_reason = $4,
                  qualifies_for_activation = $5, qualifies_for_activity = $5,
                  countability_reasons = $6::jsonb, updated_at = now()
            WHERE id = $1`,
            [
              versionId,
              submittedAt,
              fingerprint,
              body.backdateReason?.trim() || null,
              qualifies,
              JSON.stringify(fileCheckPending ? { pending: 'FILE_SCAN' } : { countable: true }),
            ],
          );
          await client.query(
            `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ($1, 'artifact_version', $2, $3::jsonb)`,
            [
              qualifies
                ? 'artifact_version_became_countable'
                : 'artifact_version_submitted_pending_scan',
              versionId,
              JSON.stringify({ versionId, authorIds, submittedAt: submittedAt.toISOString() }),
            ],
          );
          if (qualifies)
            for (const personId of authorIds)
              await recalculatePersonLifecycle(
                client,
                personId,
                'ARTIFACT_BECAME_COUNTABLE',
                versionId,
              );
          await writeAudit(client, {
            actor: request.authUser!,
            requestId: request.id,
            action: 'artifact_version.submitted',
            entityType: 'artifact_version',
            entityId: versionId,
            after: {
              submittedAt: submittedAt.toISOString(),
              authorIds,
              qualifiesForActivity: qualifies,
            },
            ...(body.backdateReason ? { reason: body.backdateReason } : {}),
          });
          const response = {
            id: versionId,
            status: 'SUBMITTED',
            qualifiesForActivation: qualifies,
            qualifiesForActivity: qualifies,
            pendingReason: fileCheckPending ? 'FILE_SCAN' : null,
          };
          await idempotency.record(200, response, client);
          return response;
        });
        return result;
      } catch (error) {
        await idempotency.release().catch(() => undefined);
        throw error;
      }
    },
  );

  app.post(
    '/artifact-versions/:id/reviews',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_REVIEW),
      schema: {
        tags: ['Артефакты'],
        summary: 'Оценка по рубрикатору ЦПИ (5 критериев 0–2) или итоговый балл',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: ReviewArtifactVersionBody,
      },
    },
    async (request, reply) => {
      const versionId = (request.params as { id: string }).id;
      const body = request.body as {
        score?: number;
        criteria?: Record<string, number>;
        decision: 'NEEDS_REVISION' | 'ACCEPTED' | 'REJECTED';
        comment?: string;
      };
      // Рубрикатор ЦПИ: при наличии критериев Q_artifact = их сумма (0–10);
      // ручной итоговый балл остаётся для совместимости.
      const criteria = body.criteria === undefined ? null : parseArtifactCriteria(body.criteria);
      let score: number;
      if (criteria !== null) {
        score = computeArtifactScore(criteria);
      } else if (body.score !== undefined) {
        score = parseQualityScore(body.score);
      } else {
        throw new HttpProblem(400, 'Укажите критерии рубрикатора или итоговый балл');
      }
      // Приёмка заблокирована при нуле по релевантности или проверяемости.
      if (body.decision === 'ACCEPTED' && !isQualityArtifact(score, criteria) && criteria !== null) {
        const blocked = ARTIFACT_QUALITY_CRITERIA.filter(
          (criterion) => criterion.blocking && criteria[criterion.code] === 0,
        );
        if (blocked.length > 0) {
          throw new HttpProblem(
            400,
            `Нельзя принять артефакт с нулём по критериям: ${blocked
              .map((criterion) => criterion.label.toLocaleLowerCase('ru'))
              .join(', ')}`,
          );
        }
      }
      const created = await transaction(app.pool, async (client) => {
        const version = await client.query(
          'SELECT id FROM artifact_versions WHERE id = $1 AND status = $2 FOR SHARE',
          [versionId, 'SUBMITTED'],
        );
        if (!version.rows[0]) throw new HttpProblem(404, 'Отправленная версия не найдена');
        const rubric = await client.query<{ id: string }>(
          'SELECT id FROM rubric_versions WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now()) ORDER BY version_number DESC LIMIT 1',
        );
        if (!rubric.rows[0]) throw new HttpProblem(503, 'Шкала качества не настроена');
        const current = await client.query<{ current_final_review_id: string }>(
          'SELECT current_final_review_id FROM artifact_review_selections WHERE artifact_version_id = $1 FOR UPDATE',
          [versionId],
        );
        const review = await client.query<{ id: string }>(
          `INSERT INTO artifact_reviews (artifact_version_id, reviewer_user_id, rubric_version_id, score, criteria, comment, status, decision, supersedes_review_id, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, 'FINAL', $7, $8, now()) RETURNING id`,
          [
            versionId,
            request.authUser!.userId,
            rubric.rows[0].id,
            score,
            criteria === null ? null : JSON.stringify(criteria),
            body.comment?.trim() || null,
            body.decision,
            current.rows[0]?.current_final_review_id ?? null,
          ],
        );
        await client.query(
          `INSERT INTO artifact_review_selections (artifact_version_id, current_final_review_id, selected_by_user_id) VALUES ($1, $2, $3) ON CONFLICT (artifact_version_id) DO UPDATE SET current_final_review_id = EXCLUDED.current_final_review_id, selected_by_user_id = EXCLUDED.selected_by_user_id, updated_at = now()`,
          [versionId, review.rows[0]!.id, request.authUser!.userId],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: current.rows[0] ? 'artifact_review.superseded' : 'artifact_review.created',
          entityType: 'artifact_review',
          entityId: review.rows[0]!.id,
          after: { versionId, score, criteria, decision: body.decision },
          ...(body.comment ? { reason: body.comment } : {}),
        });
        return {
          id: review.rows[0]!.id,
          score,
          criteria,
          isQuality: isQualityArtifact(score, criteria),
          decision: body.decision,
        };
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/artifact-versions/:id/void',
    {
      preHandler: app.requirePermission(Permissions.ARTIFACTS_WRITE),
      schema: {
        tags: ['Артефакты'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 2000 }) }),
      },
    },
    async (request) => {
      const versionId = (request.params as { id: string }).id;
      const body = request.body as { reason: string };
      return transaction(app.pool, async (client) => {
        const authors = await client.query<{ person_id: string }>(
          `SELECT DISTINCT avc.person_id FROM artifact_version_contributors avc JOIN artifact_versions av ON av.id = avc.artifact_version_id WHERE av.id = $1 AND avc.contribution_role = 'AUTHOR' AND av.status <> 'VOIDED' FOR UPDATE OF av`,
          [versionId],
        );
        if (!authors.rowCount) throw new HttpProblem(404, 'Версия не найдена');
        await client.query(
          `UPDATE artifact_versions SET status = 'VOIDED', qualifies_for_activation = false, qualifies_for_activity = false, voided_at = now(), voided_by_user_id = $2, void_reason = $3, updated_at = now() WHERE id = $1`,
          [versionId, request.authUser!.userId, body.reason],
        );
        for (const author of authors.rows)
          await recalculatePersonLifecycle(client, author.person_id, 'ARTIFACT_VOIDED', versionId);
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'artifact_version.voided',
          entityType: 'artifact_version',
          entityId: versionId,
          reason: body.reason,
        });
        return { id: versionId, status: 'VOIDED' };
      });
    },
  );
}

export async function assertArtifactEventAvailable(
  client: PoolClient,
  eventId: string,
  organizationId: string,
): Promise<void> {
  const event = await client.query<{ id: string }>(
    `SELECT id
       FROM events
      WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
      FOR SHARE`,
    [eventId, organizationId],
  );
  if (!event.rows[0])
    throw new HttpProblem(
      400,
      'Мероприятие недоступно',
      'Выберите действующее мероприятие текущей организации.',
    );
}

export async function assertArtifactEventHasAuthor(
  client: PoolClient,
  eventId: string,
  authorIds: string[],
): Promise<void> {
  const participation = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM event_participations ep
         JOIN persons participant ON participant.id = ep.person_id
        WHERE ep.event_id = $1
          AND ep.archived_at IS NULL
          AND participant.archived_at IS NULL
          AND COALESCE(participant.merged_into_person_id, participant.id) = ANY($2::uuid[])
     ) AS exists`,
    [eventId, authorIds],
  );
  if (!participation.rows[0]?.exists)
    throw new HttpProblem(
      400,
      'Нет участника мероприятия среди авторов',
      'Добавьте хотя бы одного автора, который участвовал в выбранном мероприятии.',
    );
}

async function canonicalizeContributors(
  client: PoolClient,
  contributors: Array<{ personId: string; role: 'AUTHOR' | 'CONTRIBUTOR'; description?: string }>,
  organizationId: string,
) {
  const unique = new Map<
    string,
    { personId: string; role: 'AUTHOR' | 'CONTRIBUTOR'; description?: string }
  >();
  for (const contributor of contributors) {
    const found = await client.query<{ canonical_id: string }>(
      `SELECT COALESCE(merged_into_person_id, id) AS canonical_id
         FROM persons
        WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
      [contributor.personId, organizationId],
    );
    if (!found.rows[0]) throw new HttpProblem(400, 'Один из авторов не найден');
    const id = found.rows[0].canonical_id;
    const previous = unique.get(id);
    if (!previous || contributor.role === 'AUTHOR')
      unique.set(id, { ...contributor, personId: id });
  }
  return [...unique.values()];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
