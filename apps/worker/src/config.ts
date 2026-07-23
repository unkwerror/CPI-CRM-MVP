import { resolve } from 'node:path';

import dotenv from 'dotenv';

const workspaceRoot = resolve(process.cwd(), '../..');
dotenv.config({ path: resolve(workspaceRoot, process.env.ENV_FILE ?? '.env') });

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly outboxBatchSize: number;
  readonly maxAttempts: number;
  readonly leaseMs: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly dueIntervalMs: number;
  readonly reconciliationIntervalMs: number;
  readonly reconciliationBatchSize: number;
  readonly storage: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly quarantineBucket: string;
    readonly privateBucket: string;
  };
  readonly clamAv: {
    readonly host: string;
    readonly port: number;
    readonly timeoutMs: number;
    readonly maxStreamBytes: number;
  };
}

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: value('DATABASE_URL', 'postgresql://cpi_crm:cpi_crm_local@localhost:5433/cpi_crm'),
    workerId: value('WORKER_ID', `${process.env.HOSTNAME ?? 'local'}:${String(process.pid)}`),
    pollIntervalMs: integer('WORKER_POLL_INTERVAL_MS', 1_000, 100),
    outboxBatchSize: integer('WORKER_OUTBOX_BATCH_SIZE', 10, 1),
    maxAttempts: integer('WORKER_MAX_ATTEMPTS', 8, 1),
    leaseMs: integer('WORKER_LEASE_MS', 5 * 60_000, 10_000),
    retryBaseMs: integer('WORKER_RETRY_BASE_MS', 1_000, 100),
    retryMaxMs: integer('WORKER_RETRY_MAX_MS', 15 * 60_000, 1_000),
    dueIntervalMs: integer('WORKER_DUE_INTERVAL_MS', 60 * 60_000, 60_000),
    reconciliationIntervalMs: integer(
      'WORKER_RECONCILIATION_INTERVAL_MS',
      24 * 60 * 60_000,
      60_000,
    ),
    reconciliationBatchSize: integer('WORKER_RECONCILIATION_BATCH_SIZE', 250, 1),
    storage: {
      endpoint: value('S3_ENDPOINT', 'http://localhost:9000'),
      region: value('S3_REGION', 'us-east-1'),
      accessKey: value('S3_ACCESS_KEY', 'cpi-minio'),
      secretKey: value('S3_SECRET_KEY', 'cpi-minio-local-secret'),
      quarantineBucket: value('S3_QUARANTINE_BUCKET', 'cpi-quarantine'),
      privateBucket: value('S3_PRIVATE_BUCKET', 'cpi-private'),
    },
    clamAv: {
      host: value('CLAMAV_HOST', 'localhost'),
      port: integer('CLAMAV_PORT', 3310, 1, 65_535),
      timeoutMs: integer('CLAMAV_TIMEOUT_MS', 120_000, 1_000),
      maxStreamBytes: integer('CLAMAV_MAX_STREAM_BYTES', 30 * 1024 * 1024, 1),
    },
  };
}

function value(name: string, fallback: string): string {
  const configured = process.env[name]?.trim();
  return configured || fallback;
}

function integer(
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const raw = process.env[name];
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}`);
  }
  return parsed;
}
