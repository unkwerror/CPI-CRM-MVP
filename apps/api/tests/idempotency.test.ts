import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { beginIdempotentRequest } from '../src/lib/idempotency.js';

const input = {
  subject: 'test-user',
  route: '/test',
  key: 'request-key-123',
  payload: { value: 1 },
};

describe('idempotent request records', () => {
  it('releases an unfinished key after a failed operation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'record' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await beginIdempotentRequest({ query } as unknown as Pool, input);
    expect(result.replay).toBe(false);
    if (result.replay) return;
    await result.release();
    expect(String(query.mock.calls[1]?.[0])).toContain('DELETE FROM idempotency_records');
    expect(String(query.mock.calls[1]?.[0])).toContain("response_headers->>'leaseToken'");
  });

  it('records the response through the supplied transaction with lease ownership', async () => {
    const poolQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'record' }] });
    const transactionQuery = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await beginIdempotentRequest({ query: poolQuery } as unknown as Pool, input);
    expect(result.replay).toBe(false);
    if (result.replay) return;
    await result.record(201, { id: 'saved' }, { query: transactionQuery } as never);
    expect(String(transactionQuery.mock.calls[0]?.[0])).toContain(
      "response_headers->>'leaseToken' = $6",
    );
    expect(transactionQuery.mock.calls[0]?.[1]?.[6]).toBe(
      '48208f9428d64634bd8e28ff345bf0eab60d53c18fa2fbdb0b9bc1e84df2b5f6',
    );
  });

  it('rejects completion by a stale lease owner', async () => {
    const poolQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'record' }] });
    const transactionQuery = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await beginIdempotentRequest({ query: poolQuery } as unknown as Pool, input);
    expect(result.replay).toBe(false);
    if (result.replay) return;
    await expect(
      result.record(201, { id: 'saved' }, { query: transactionQuery } as never),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('replays a completed response for the same payload', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            payload_hash: '48208f9428d64634bd8e28ff345bf0eab60d53c18fa2fbdb0b9bc1e84df2b5f6',
            response_status: 201,
            response_body: { id: 'saved' },
          },
        ],
      });
    const result = await beginIdempotentRequest({ query } as unknown as Pool, input);
    expect(result).toEqual({ replay: true, status: 201, body: { id: 'saved' } });
  });

  it('rejects a key reused for another payload', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ payload_hash: 'different', response_status: null, response_body: null }],
      });
    await expect(beginIdempotentRequest({ query } as unknown as Pool, input)).rejects.toMatchObject(
      { status: 409 },
    );
  });
});
