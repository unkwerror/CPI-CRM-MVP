import type { Pool, PoolClient } from 'pg';

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !parsed.every((item) => typeof item === 'string')
    ) {
      throw new Error('invalid cursor payload');
    }
    return [parsed[0] as string, parsed[1] as string];
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}
