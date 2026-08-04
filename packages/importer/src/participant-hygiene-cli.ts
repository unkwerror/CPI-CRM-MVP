#!/usr/bin/env node

import { Pool } from 'pg';

import { applyParticipantHygiene, inspectParticipantHygiene } from './participant-hygiene.js';

const apply = process.argv.includes('--apply');
const databaseUrl = process.env.DATABASE_URL;
const organizationId =
  process.env.CPI_IMPORT_ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000010';
const actorUserId = process.env.CPI_IMPORT_USER_ID ?? '00000000-0000-4000-8000-000000000001';

if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
try {
  if (apply) {
    process.stdout.write(
      `${JSON.stringify(await applyParticipantHygiene(pool, { organizationId, actorUserId }))}\n`,
    );
  } else {
    const client = await pool.connect();
    try {
      process.stdout.write(
        `${JSON.stringify(await inspectParticipantHygiene(client, organizationId))}\n`,
      );
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
