import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

/**
 * Creates the PostgreSQL pool and the typed Drizzle client together so the
 * process that owns the pool can close it during graceful shutdown.
 */
export function createDatabase(config: PoolConfig | string) {
  const pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
  const db = drizzle(pool, { schema });

  return { db, pool };
}
