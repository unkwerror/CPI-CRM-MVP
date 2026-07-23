import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { HttpProblem } from './problem.js';

interface ExistingRecord {
  payload_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export async function beginIdempotentRequest(
  pool: Pool,
  input: { subject: string; route: string; key: string | undefined; payload: unknown },
): Promise<
  | {
      replay: false;
      record: (status: number, body: unknown, executor?: Pool | PoolClient) => Promise<void>;
      release: () => Promise<void>;
    }
  | { replay: true; status: number; body: unknown }
> {
  if (!input.key || input.key.length < 8 || input.key.length > 200) {
    throw new HttpProblem(
      400,
      'Требуется Idempotency-Key',
      'Передайте уникальный ключ длиной 8–200 символов.',
    );
  }
  const payloadHash = createHash('sha256').update(stableJson(input.payload)).digest('hex');
  const leaseToken = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO idempotency_records
       (subject, route, idempotency_key, payload_hash, response_headers, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, clock_timestamp() + interval '5 minutes', clock_timestamp())
     ON CONFLICT (subject, route, idempotency_key) DO UPDATE
       SET payload_hash = EXCLUDED.payload_hash,
           response_status = NULL,
           response_headers = EXCLUDED.response_headers,
           response_body = NULL,
           completed_at = NULL,
           expires_at = EXCLUDED.expires_at,
           updated_at = clock_timestamp()
       WHERE idempotency_records.expires_at <= clock_timestamp()
     RETURNING id`,
    [input.subject, input.route, input.key, payloadHash, JSON.stringify({ leaseToken })],
  );
  if (!inserted.rows[0]) {
    const existing = await pool.query<ExistingRecord>(
      `SELECT payload_hash, response_status, response_body
         FROM idempotency_records
        WHERE subject = $1 AND route = $2 AND idempotency_key = $3`,
      [input.subject, input.route, input.key],
    );
    const record = existing.rows[0];
    if (!record || record.payload_hash !== payloadHash) {
      throw new HttpProblem(
        409,
        'Конфликт Idempotency-Key',
        'Этот ключ уже использован с другим содержимым.',
      );
    }
    if (record.response_status !== null) {
      return { replay: true, status: record.response_status, body: record.response_body };
    }
    throw new HttpProblem(
      409,
      'Запрос уже выполняется',
      'Повторите чтение результата через несколько секунд.',
    );
  }
  return {
    replay: false,
    record: async (status, body, executor = pool) => {
      const recorded = await executor.query(
        `UPDATE idempotency_records
            SET response_status = $4, response_headers = NULL, response_body = $5::jsonb,
                completed_at = now(),
                expires_at = now() + interval '24 hours', updated_at = now()
          WHERE subject = $1 AND route = $2 AND idempotency_key = $3
            AND response_headers->>'leaseToken' = $6
            AND payload_hash = $7 AND response_status IS NULL`,
        [
          input.subject,
          input.route,
          input.key,
          status,
          JSON.stringify(body),
          leaseToken,
          payloadHash,
        ],
      );
      if (recorded.rowCount !== 1) {
        throw new HttpProblem(
          409,
          'Лизинг Idempotency-Key истёк',
          'Операция не зафиксирована: повторите запрос с новым ключом.',
        );
      }
    },
    release: async () => {
      await pool.query(
        `DELETE FROM idempotency_records
          WHERE subject = $1 AND route = $2 AND idempotency_key = $3
            AND payload_hash = $4 AND response_headers->>'leaseToken' = $5
            AND response_status IS NULL`,
        [input.subject, input.route, input.key, payloadHash, leaseToken],
      );
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
