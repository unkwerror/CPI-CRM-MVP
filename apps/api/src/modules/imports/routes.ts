import { randomUUID } from 'node:crypto';

import {
  assertControlsPassed,
  auditImportPlan,
  commitImportPlan,
  readWorkbookImportPlan,
} from '@cpi-crm/importer';
import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '../../lib/audit.js';
import { createConcurrencyGuard, heavyOperationRateLimit } from '../../lib/heavy-operations.js';
import { beginIdempotentRequest } from '../../lib/idempotency.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  const guardImportConcurrency = createConcurrencyGuard({
    maxConcurrent: 1,
    title: 'Импорт уже выполняется',
    detail: 'Дождитесь завершения текущей операции импорта и повторите запрос.',
    retryAfterSeconds: 30,
  });

  app.get(
    '/imports',
    { preHandler: app.requirePermission(Permissions.IMPORTS_RUN), schema: { tags: ['Импорт'] } },
    async () => {
      const result = await app.pool.query(
        `SELECT ir.id, ir.mode, ir.status, ir.statistics, ir.errors, ir.created_at,
                ib.original_filename
           FROM import_runs ir
           JOIN import_batches ib ON ib.id = ir.batch_id
          ORDER BY ir.created_at DESC
          LIMIT 50`,
      );
      return { items: result.rows.map(mapImportRun) };
    },
  );

  app.get(
    '/imports/:id',
    {
      preHandler: app.requirePermission(Permissions.IMPORTS_RUN),
      schema: { tags: ['Импорт'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
    },
    async (request) => {
      const result = await app.pool.query(
        `SELECT ir.id, ir.mode, ir.status, ir.statistics, ir.errors, ir.created_at,
                ib.original_filename
           FROM import_runs ir JOIN import_batches ib ON ib.id = ir.batch_id
          WHERE ir.id = $1`,
        [(request.params as { id: string }).id],
      );
      if (!result.rows[0]) throw new HttpProblem(404, 'Запуск импорта не найден');
      return mapImportRun(result.rows[0]);
    },
  );

  app.get(
    '/imports/:id/errors',
    {
      preHandler: app.requirePermission(Permissions.IMPORTS_READ_RAW),
      schema: { tags: ['Импорт'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
    },
    async (request) => {
      const result = await app.pool.query<{ errors: unknown[] }>(
        'SELECT errors FROM import_runs WHERE id = $1',
        [(request.params as { id: string }).id],
      );
      if (!result.rows[0]) throw new HttpProblem(404, 'Запуск импорта не найден');
      return { items: result.rows[0].errors };
    },
  );

  app.post(
    '/imports/local-workbook/dry-run',
    {
      config: { rateLimit: heavyOperationRateLimit(2, '10 minutes') },
      preHandler: [app.requirePermission(Permissions.IMPORTS_RUN), guardImportConcurrency],
      schema: {
        tags: ['Импорт'],
        summary: 'Проверить локальную книгу без изменения канонических данных',
        body: Type.Object({}),
      },
    },
    async (request, reply) => {
      const idempotency = await beginIdempotentRequest(app.pool, {
        subject: request.authUser!.sub,
        route: '/imports/local-workbook/dry-run',
        key: headerValue(request.headers['idempotency-key']),
        payload: request.body,
      });
      if (idempotency.replay) return reply.code(idempotency.status).send(idempotency.body);
      try {
        const plan = await readWorkbookImportPlan(app.config.importWorkbook);
        const report = auditImportPlan(plan, 'DRY_RUN');
        assertControlsPassed(report);
        const organization = await getOrganizationContext(app.pool);
        const run = await transaction(app.pool, async (client) => {
          const objectKey = `xlsx/${plan.sha256}`;
          const proposedFileId = randomUUID();
          await client.query(
            `INSERT INTO file_objects
             (id, bucket, object_key, original_filename, declared_mime_type,
              detected_mime_type, size_bytes, sha256, status, scan_result,
              uploaded_by_user_id, available_at)
           VALUES ($1, 'local-import', $2, $3,
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             $4, $5, 'AVAILABLE', $6::jsonb, $7, now())
           ON CONFLICT (bucket, object_key) DO NOTHING`,
            [
              proposedFileId,
              objectKey,
              plan.sourceFilename,
              plan.sizeBytes,
              plan.sha256,
              JSON.stringify({ source: 'LOCAL_DRY_RUN', sha256Verified: true }),
              request.authUser!.userId,
            ],
          );
          const file = await client.query<{ id: string }>(
            'SELECT id FROM file_objects WHERE bucket = $1 AND object_key = $2',
            ['local-import', objectKey],
          );
          const proposedBatchId = randomUUID();
          await client.query(
            `INSERT INTO import_batches
             (id, organization_id, source_file_object_id, original_filename, size_bytes,
              sha256, importer_version, baseline_snapshot_at, timezone_snapshot,
              lifecycle_rule_set_snapshot_id, uploaded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (organization_id, sha256) DO NOTHING`,
            [
              proposedBatchId,
              organization.id,
              file.rows[0]!.id,
              plan.sourceFilename,
              plan.sizeBytes,
              plan.sha256,
              report.importerVersion,
              organization.baselineAt,
              organization.timezone,
              organization.ruleSetId,
              request.authUser!.userId,
            ],
          );
          const batch = await client.query<{ id: string }>(
            'SELECT id FROM import_batches WHERE organization_id = $1 AND sha256 = $2',
            [organization.id, plan.sha256],
          );
          const runResult = await client.query<{ id: string }>(
            `INSERT INTO import_runs
             (batch_id, mode, parser_version, rules_version, status, statistics,
              errors, started_at, finished_at, initiated_by_user_id)
           VALUES ($1, 'DRY_RUN', $2, $3, 'SUCCEEDED', $4::jsonb, $5::jsonb,
                   now(), now(), $6)
           RETURNING id`,
            [
              batch.rows[0]!.id,
              report.parserVersion,
              report.rulesVersion,
              JSON.stringify({
                report,
                controls: {
                  sheets: report.totals.sheets,
                  sourceRows: report.totals.sourceRows,
                  personObservations: report.totals.personObservations,
                  catalyst2025: report.catalyst2025,
                },
                created: {},
              }),
              JSON.stringify(report.warnings),
              request.authUser!.userId,
            ],
          );
          await writeAudit(client, {
            actor: request.authUser!,
            requestId: request.id,
            action: 'import.dry_run_completed',
            entityType: 'import_run',
            entityId: runResult.rows[0]!.id,
            after: {
              sha256: plan.sha256,
              controlsPassed: report.controlsPassed,
              sourceRows: report.totals.sourceRows,
            },
          });
          return {
            id: runResult.rows[0]!.id,
            mode: 'DRY_RUN',
            status: 'COMPLETED',
            controlsPassed: true,
            sheetsProcessed: report.totals.sheets,
            sourceRecords: report.totals.sourceRows,
            observations: report.totals.personObservations,
          };
        });
        await idempotency.record(201, run);
        return reply.code(201).send(run);
      } catch (error) {
        await idempotency.release().catch(() => undefined);
        throw error;
      }
    },
  );

  app.post(
    '/imports/:id/commit',
    {
      config: { rateLimit: heavyOperationRateLimit(2, '10 minutes') },
      preHandler: [app.requirePermission(Permissions.IMPORTS_RUN), guardImportConcurrency],
      schema: {
        tags: ['Импорт'],
        summary: 'Зафиксировать проверенную immutable-партию',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({}),
      },
    },
    async (request, reply) => {
      const dryRunId = (request.params as { id: string }).id;
      const idempotency = await beginIdempotentRequest(app.pool, {
        subject: request.authUser!.sub,
        route: `/imports/${dryRunId}/commit`,
        key: headerValue(request.headers['idempotency-key']),
        payload: request.body,
      });
      if (idempotency.replay) return reply.code(idempotency.status).send(idempotency.body);
      try {
        const approved = await app.pool.query<{ sha256: string; organization_id: string }>(
          `SELECT ib.sha256, ib.organization_id
           FROM import_runs ir JOIN import_batches ib ON ib.id = ir.batch_id
          WHERE ir.id = $1 AND ir.mode = 'DRY_RUN' AND ir.status = 'SUCCEEDED'`,
          [dryRunId],
        );
        if (!approved.rows[0]) throw new HttpProblem(409, 'Сначала нужен успешный dry-run');
        const plan = await readWorkbookImportPlan(app.config.importWorkbook);
        if (plan.sha256 !== approved.rows[0].sha256)
          throw new HttpProblem(409, 'Исходная книга изменилась после dry-run');
        const report = auditImportPlan(plan, 'DRY_RUN');
        assertControlsPassed(report);
        const commit = await commitImportPlan(plan, {
          databaseUrl: app.config.databaseUrl,
          organizationId: approved.rows[0].organization_id,
          initiatedByUserId: request.authUser!.userId,
          timezone: app.config.timezone,
          basedOnRunId: dryRunId,
        });
        const response = {
          id: commit.runId,
          mode: 'COMMIT',
          status: 'COMPLETED',
          batchId: commit.batchId,
          controlsPassed: true,
          created: commit.created,
          dataHygiene: commit.dataHygiene,
          deduplication: commit.deduplication,
        };
        await app.pool.query(
          `INSERT INTO audit_log (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, after) VALUES ($1, $2, $3, 'import.commit_completed', 'import_run', $4, $5::jsonb)`,
          [
            request.authUser!.userId,
            request.authUser!.sub,
            request.id,
            commit.runId,
            JSON.stringify(response),
          ],
        );
        await idempotency.record(201, response);
        return reply.code(201).send(response);
      } catch (error) {
        await idempotency.release().catch(() => undefined);
        throw error;
      }
    },
  );

  app.post(
    '/imports/:id/revert',
    {
      config: { rateLimit: heavyOperationRateLimit(2, '10 minutes') },
      preHandler: [app.requirePermission(Permissions.IMPORTS_RUN), guardImportConcurrency],
      schema: {
        tags: ['Импорт'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 2000 }) }),
      },
    },
    async (request, reply) => {
      const commitRunId = (request.params as { id: string }).id;
      const reason = (request.body as { reason: string }).reason;
      const response = await transaction(app.pool, async (client) => {
        const source = await client.query<{ batch_id: string }>(
          `SELECT batch_id FROM import_runs WHERE id = $1 AND mode = 'COMMIT' AND status = 'SUCCEEDED' FOR UPDATE`,
          [commitRunId],
        );
        if (!source.rows[0]) throw new HttpProblem(409, 'Можно отменить только успешный commit');
        const run = await client.query<{ id: string }>(
          `INSERT INTO import_runs (batch_id, mode, parser_version, rules_version, status, based_on_run_id, statistics, errors, started_at, initiated_by_user_id) SELECT batch_id, 'REVERT', parser_version, rules_version, 'RUNNING', id, '{}'::jsonb, '[]'::jsonb, now(), $2 FROM import_runs WHERE id = $1 RETURNING id`,
          [commitRunId, request.authUser!.userId],
        );
        const revertId = run.rows[0]!.id;
        const links = await client.query<{
          id: string;
          entity_type: string;
          entity_id: string;
          created_entity: boolean;
        }>(
          'SELECT id, entity_type, entity_id, created_entity FROM source_entity_links WHERE import_run_id = $1 AND detached_at IS NULL FOR UPDATE',
          [commitRunId],
        );
        let archived = 0;
        let conflicts = 0;
        for (const link of links.rows.filter(
          (item) => item.created_entity && item.entity_type.toUpperCase() === 'PERSON',
        )) {
          const shared = await client.query<{ shared: boolean; modified: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM source_entity_links WHERE entity_type = $1 AND entity_id = $2 AND import_run_id <> $3 AND detached_at IS NULL) AS shared, EXISTS(SELECT 1 FROM artifacts a JOIN artifact_versions av ON av.artifact_id = a.id JOIN artifact_version_contributors avc ON avc.artifact_version_id = av.id WHERE avc.person_id = $2) OR EXISTS(SELECT 1 FROM tasks WHERE person_id = $2) OR EXISTS(SELECT 1 FROM interactions WHERE person_id = $2) AS modified`,
            [link.entity_type, link.entity_id, commitRunId],
          );
          if (shared.rows[0]?.shared || shared.rows[0]?.modified) {
            conflicts += 1;
            await client.query(
              `INSERT INTO import_revert_conflicts (revert_run_id, source_entity_link_id, entity_type, entity_id, reason, details) VALUES ($1, $2, $3, $4, 'ENTITY_SHARED_OR_MODIFIED', $5::jsonb)`,
              [revertId, link.id, link.entity_type, link.entity_id, JSON.stringify(shared.rows[0])],
            );
          } else {
            const changed = await client.query(
              `UPDATE persons SET archived_at = now(), updated_at = now(), version = version + 1 WHERE id = $1 AND archived_at IS NULL`,
              [link.entity_id],
            );
            archived += changed.rowCount ?? 0;
          }
        }
        await client.query(
          `UPDATE source_entity_links SET detached_at = now(), detached_by_run_id = $2, updated_at = now() WHERE import_run_id = $1 AND detached_at IS NULL`,
          [commitRunId, revertId],
        );
        await client.query(
          `UPDATE import_runs SET status = 'SUCCEEDED', statistics = $2::jsonb, finished_at = now(), updated_at = now() WHERE id = $1`,
          [
            revertId,
            JSON.stringify({
              detachedLinks: links.rows.length,
              archivedPersons: archived,
              conflicts,
              reason,
            }),
          ],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'import.reverted',
          entityType: 'import_run',
          entityId: revertId,
          after: {
            commitRunId,
            detachedLinks: links.rows.length,
            archivedPersons: archived,
            conflicts,
          },
          reason,
        });
        return {
          id: revertId,
          mode: 'REVERT',
          status: 'COMPLETED',
          detachedLinks: links.rows.length,
          archivedPersons: archived,
          conflicts,
        };
      });
      return reply.code(201).send(response);
    },
  );
}

function mapImportRun(row: Record<string, any>) {
  const statistics = row.statistics ?? {};
  const controls = statistics.controls ?? statistics.report?.totals ?? {};
  const created = statistics.created ?? {};
  const hygiene = statistics.dataHygiene?.summary ?? statistics.report?.outcomes ?? {};
  const acceptedObservations =
    hygiene.acceptedObservations ??
    hygiene.readyPersonObservations ??
    controls.personObservations ??
    0;
  return {
    id: row.id,
    mode: row.mode,
    status: row.status === 'SUCCEEDED' ? 'COMPLETED' : row.status,
    fileName: row.original_filename,
    sheetsProcessed: controls.sheets ?? 0,
    sourceRecords: controls.sourceRows ?? 0,
    observations: controls.personObservations ?? 0,
    personsCreated: created.persons ?? 0,
    personsLinked: Math.max(0, acceptedObservations - (created.persons ?? 0)),
    duplicatesQueued: created.duplicateCandidates ?? 0,
    rejected: hygiene.rejectedObservations ?? hygiene.rejectedPersonObservations ?? 0,
    quarantined: Array.isArray(row.errors) ? row.errors.length : 0,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    report: statistics.report,
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
