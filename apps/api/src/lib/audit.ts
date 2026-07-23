import type { PoolClient } from 'pg';

import type { AuthUser } from '../types.js';

export async function writeAudit(
  client: PoolClient,
  input: {
    actor: AuthUser;
    requestId: string;
    action: string;
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO audit_log
      (actor_user_id, actor_subject, request_id, action, entity_type, entity_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
     RETURNING id`,
    [
      input.actor.userId,
      input.actor.sub,
      input.requestId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.before ?? null),
      JSON.stringify(input.after ?? null),
      input.reason ?? null,
    ],
  );
  return result.rows[0]!.id;
}
