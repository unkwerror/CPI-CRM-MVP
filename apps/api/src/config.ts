import { resolve } from 'node:path';

import dotenv from 'dotenv';

const workspaceRoot = resolve(process.cwd(), '../..');
dotenv.config({ path: resolve(workspaceRoot, process.env.ENV_FILE ?? '.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export interface ApiConfig {
  databaseUrl: string;
  port: number;
  webOrigin: string;
  authRequired: boolean;
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  sessionKey: Buffer;
  timezone: string;
  artifactBaselineAt: Date;
  importWorkbook: string;
  storage: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    quarantineBucket: string;
    privateBucket: string;
  };
}

export function loadConfig(): ApiConfig {
  const key = Buffer.from(
    required('SESSION_KEY_BASE64', 'bG9jYWwtb25seS1zZXNzaW9uLWtleS0zMi1ieXRlcyE='),
    'base64',
  );
  if (key.length !== 32) throw new Error('SESSION_KEY_BASE64 must decode to exactly 32 bytes');
  const baseline = new Date(required('ARTIFACT_BASELINE_AT', '2026-07-22T00:00:00.000Z'));
  if (Number.isNaN(baseline.getTime())) throw new Error('ARTIFACT_BASELINE_AT is invalid');

  return {
    databaseUrl: required(
      'DATABASE_URL',
      'postgresql://cpi_crm:cpi_crm_local@localhost:5433/cpi_crm',
    ),
    port: Number(process.env.API_PORT ?? 3001),
    webOrigin: required('WEB_ORIGIN', 'http://localhost:3000'),
    authRequired: booleanValue('AUTH_REQUIRED', true),
    oidc: {
      issuer: required('OIDC_ISSUER', 'http://localhost:8080/realms/cpi-crm'),
      clientId: required('OIDC_CLIENT_ID', 'cpi-crm'),
      clientSecret: required('OIDC_CLIENT_SECRET', 'local-only-change-me'),
      redirectUri: required('OIDC_REDIRECT_URI', 'http://localhost:3000/api/auth/callback'),
    },
    sessionKey: key,
    timezone: required('ORGANIZATION_TIMEZONE', 'Asia/Novosibirsk'),
    artifactBaselineAt: baseline,
    importWorkbook: resolve(
      workspaceRoot,
      process.env.IMPORT_WORKBOOK ?? './Участники_всех_мероприятий_Стартап_студии_ЯДРО1.xlsx',
    ),
    storage: {
      endpoint: required('S3_ENDPOINT', 'http://localhost:9000'),
      region: required('S3_REGION', 'us-east-1'),
      accessKey: required('S3_ACCESS_KEY', 'cpi-minio'),
      secretKey: required('S3_SECRET_KEY', 'cpi-minio-local-secret'),
      quarantineBucket: required('S3_QUARANTINE_BUCKET', 'cpi-quarantine'),
      privateBucket: required('S3_PRIVATE_BUCKET', 'cpi-private'),
    },
  };
}
