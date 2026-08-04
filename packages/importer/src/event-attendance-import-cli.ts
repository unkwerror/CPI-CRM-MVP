#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';

import { importEventAttendanceWorkbook } from './event-attendance-import.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = argument('--file');
const eventId = argument('--event-id');
const databaseUrl = argument('--database-url') ?? process.env.DATABASE_URL;
const organizationId =
  argument('--organization-id') ??
  process.env.CPI_IMPORT_ORGANIZATION_ID ??
  '00000000-0000-4000-8000-000000000010';
const actorUserId =
  argument('--user-id') ?? process.env.CPI_IMPORT_USER_ID ?? '00000000-0000-4000-8000-000000000001';

if (!file) throw new Error('--file is required');
if (!eventId) throw new Error('--event-id is required');
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const result = await importEventAttendanceWorkbook(pool, {
    organizationId,
    eventId,
    actorUserId,
    actorSubject: 'event-attendance-importer',
    requestId: `event-attendance-import:${randomUUID()}`,
    workbookBytes: await readFile(file),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
