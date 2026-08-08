import { parseRussianFullName } from '@cpi-crm/domain';
import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { writeAudit } from '../../lib/audit.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';
import { transaction } from '../../lib/sql.js';
import {
  ingestLockerSubmission,
  LockerReviewRequired,
  type LockerSyncInput,
} from './locker-routes.js';

const REASON_LABELS: Record<string, string> = {
  FIO_REQUIRED: 'Нет полного ФИО',
  PERSON_AMBIGUOUS: 'Совпало несколько карточек',
  IDENTITY_CONFLICT: 'Конфликт идентификаторов',
  DELETED_IDENTITY: 'Участник был удалён из базы',
};

type PendingRow = {
  id: string;
  locker_submission_id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  reported_full_name: string;
  reported_phone: string | null;
  reported_organization: string | null;
  event_title: string;
  submitted_at: Date;
  reason_code: string;
  reason_detail: string | null;
  status: string;
  attempts: number;
  file_count: number;
  resolved_person_id: string | null;
  resolved_person_name: string | null;
  resolved_at: Date | null;
};

export async function registerLockerPendingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/locker/pending',
    {
      preHandler: app.requirePermission(Permissions.PEOPLE_READ),
      schema: {
        tags: ['Интеграции'],
        summary: 'Заявки из бота, которые не удалось привязать автоматически',
        querystring: Type.Object({
          status: Type.Optional(
            Type.Union([
              Type.Literal('PENDING'),
              Type.Literal('RESOLVED'),
              Type.Literal('REJECTED'),
            ]),
          ),
        }),
      },
    },
    async (request) => {
      const status = (request.query as { status?: string }).status ?? 'PENDING';
      const result = await app.pool.query<PendingRow>(
        `SELECT pending.id, pending.locker_submission_id, pending.telegram_user_id,
                pending.telegram_username, pending.reported_full_name, pending.reported_phone,
                pending.reported_organization, pending.event_title, pending.submitted_at,
                pending.reason_code, pending.reason_detail, pending.status, pending.attempts,
                pending.resolved_person_id, pending.resolved_at,
                person.canonical_full_name AS resolved_person_name,
                COALESCE(jsonb_array_length(pending.payload -> 'submission' -> 'files'), 0) AS file_count
           FROM locker_pending_submissions pending
           LEFT JOIN persons person ON person.id = pending.resolved_person_id
          WHERE pending.status = $1
          ORDER BY pending.submitted_at DESC
          LIMIT 200`,
        [status],
      );
      const pendingCount = await app.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM locker_pending_submissions WHERE status = 'PENDING'`,
      );
      return {
        pendingCount: Number(pendingCount.rows[0]?.count ?? 0),
        items: result.rows.map((row) => ({
          id: row.id,
          lockerSubmissionId: row.locker_submission_id,
          telegram: row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id,
          telegramUserId: row.telegram_user_id,
          reportedFullName: row.reported_full_name,
          reportedPhone: row.reported_phone,
          reportedOrganization: row.reported_organization,
          eventTitle: row.event_title,
          submittedAt: row.submitted_at.toISOString(),
          reasonCode: row.reason_code,
          reasonLabel: REASON_LABELS[row.reason_code] ?? row.reason_code,
          reasonDetail: row.reason_detail,
          status: row.status,
          attempts: row.attempts,
          fileCount: Number(row.file_count),
          resolvedPersonId: row.resolved_person_id,
          resolvedPersonName: row.resolved_person_name,
          resolvedAt: row.resolved_at?.toISOString() ?? null,
        })),
      };
    },
  );

  app.post(
    '/locker/pending/:id/attach',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Интеграции'],
        summary: 'Привязать заявку к существующему участнику',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          personId: Type.String({ format: 'uuid' }),
          reason: Type.String({ minLength: 3, maxLength: 2000 }),
        }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { personId: string; reason: string };
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const pending = await lockPending(client, id);
        const person = await client.query<{ id: string }>(
          `SELECT id FROM persons
            WHERE id = $1 AND organization_id = $2
              AND archived_at IS NULL AND merged_into_person_id IS NULL`,
          [body.personId, organization.id],
        );
        if (!person.rows[0]) throw new HttpProblem(404, 'Участник не найден или скрыт');

        const payload = { ...pending.payload };
        payload.user = { ...payload.user, crmPersonId: body.personId };
        const result = await replayPending(client, organization, payload, request.id);
        await completePending(client, {
          pendingId: id,
          personId: result.personId,
          userId: request.authUser!.userId,
          note: body.reason,
        });
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'locker.pending_attached',
          entityType: 'locker_pending_submission',
          entityId: id,
          reason: body.reason,
          after: { personId: result.personId, artifactId: result.artifactId },
        });
        return { id, status: 'RESOLVED', ...result };
      });
    },
  );

  app.post(
    '/locker/pending/:id/create-person',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Интеграции'],
        summary: 'Завести участника по уточнённому ФИО и принять заявку',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          fullName: Type.String({ minLength: 5, maxLength: 300 }),
          reason: Type.String({ minLength: 3, maxLength: 2000 }),
        }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { fullName: string; reason: string };
      if (!parseRussianFullName(body.fullName)) {
        throw new HttpProblem(
          400,
          'Нужны фамилия, имя и отчество русскими буквами',
          'Например: Иванов Иван Иванович.',
        );
      }
      const organization = await getOrganizationContext(app.pool);
      return transaction(app.pool, async (client) => {
        const pending = await lockPending(client, id);
        const payload = { ...pending.payload };
        payload.user = { ...payload.user, fullName: body.fullName };
        const result = await replayPending(client, organization, payload, request.id);
        await completePending(client, {
          pendingId: id,
          personId: result.personId,
          userId: request.authUser!.userId,
          note: body.reason,
        });
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'locker.pending_person_created',
          entityType: 'locker_pending_submission',
          entityId: id,
          reason: body.reason,
          after: { personId: result.personId, fullName: body.fullName },
        });
        return { id, status: 'RESOLVED', ...result };
      });
    },
  );

  app.post(
    '/locker/pending/:id/reject',
    {
      preHandler: app.requirePermission(Permissions.DUPLICATES_RESOLVE),
      schema: {
        tags: ['Интеграции'],
        summary: 'Отклонить заявку из бота',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 2000 }) }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const reason = (request.body as { reason: string }).reason;
      return transaction(app.pool, async (client) => {
        await lockPending(client, id);
        await client.query(
          `UPDATE locker_pending_submissions
              SET status = 'REJECTED', resolved_at = now(), resolved_by_user_id = $2,
                  resolution_note = $3, updated_at = now()
            WHERE id = $1`,
          [id, request.authUser!.userId, reason],
        );
        await writeAudit(client, {
          actor: request.authUser!,
          requestId: request.id,
          action: 'locker.pending_rejected',
          entityType: 'locker_pending_submission',
          entityId: id,
          reason,
        });
        return { id, status: 'REJECTED' };
      });
    },
  );
}

type PendingPayload = LockerSyncInput;

async function lockPending(
  client: PoolClient,
  id: string,
): Promise<{ payload: PendingPayload; lockerSubmissionId: string }> {
  const pending = await client.query<{ payload: PendingPayload; locker_submission_id: string }>(
    `SELECT payload, locker_submission_id
       FROM locker_pending_submissions
      WHERE id = $1 AND status = 'PENDING'
      FOR UPDATE`,
    [id],
  );
  if (!pending.rows[0]) throw new HttpProblem(409, 'Заявка уже обработана');
  return {
    payload: pending.rows[0].payload,
    lockerSubmissionId: pending.rows[0].locker_submission_id,
  };
}

async function replayPending(
  client: PoolClient,
  organization: Awaited<ReturnType<typeof getOrganizationContext>>,
  payload: PendingPayload,
  requestId: string,
): Promise<{ personId: string; eventId: string; artifactId: string; artifactVersionId: string }> {
  try {
    const result = await ingestLockerSubmission(client, organization, payload, requestId);
    return {
      personId: result.personId,
      eventId: result.eventId,
      artifactId: result.artifactId,
      artifactVersionId: result.artifactVersionId,
    };
  } catch (error) {
    if (error instanceof LockerReviewRequired) {
      throw new HttpProblem(409, 'Заявку всё ещё нельзя принять', error.detail);
    }
    throw error;
  }
}

async function completePending(
  client: PoolClient,
  input: { pendingId: string; personId: string; userId: string; note: string },
): Promise<void> {
  await client.query(
    `UPDATE locker_pending_submissions
        SET status = 'RESOLVED', resolved_person_id = $2, resolved_by_user_id = $3,
            resolved_at = now(), resolution_note = $4, updated_at = now()
      WHERE id = $1`,
    [input.pendingId, input.personId, input.userId, input.note],
  );
}
