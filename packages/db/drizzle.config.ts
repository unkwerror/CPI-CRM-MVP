import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

const workspaceRoot = resolve(process.cwd(), '../..');
const envFile = resolve(workspaceRoot, process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://cpi_crm:cpi_crm_local@localhost:5433/cpi_crm',
  },
  migrations: {
    prefix: 'index',
  },
  strict: true,
  verbose: true,
});
