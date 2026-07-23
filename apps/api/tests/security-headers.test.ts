import { Roles } from '@cpi-crm/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiConfig } from '../src/config.js';
import { buildServer, isMutationOriginAllowed, shouldUsePrivateNoStore } from '../src/server.js';
import { privateDownloadRequest } from '../src/modules/files/routes.js';

const WEB_ORIGIN = 'https://crm.example.test';

const config: ApiConfig = {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  port: 3001,
  webOrigin: WEB_ORIGIN,
  authRequired: true,
  oidc: {
    issuer: 'https://id.example.test/realms/cpi-crm',
    clientId: 'cpi-crm',
    clientSecret: 'test-client-secret',
    redirectUri: `${WEB_ORIGIN}/api/auth/callback`,
  },
  sessionKey: Buffer.alloc(32, 7),
  timezone: 'Asia/Novosibirsk',
  artifactBaselineAt: new Date('2026-07-22T00:00:00.000Z'),
  importWorkbook: '/tmp/unused.xlsx',
  storage: {
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    accessKey: 'test-access-key',
    secretKey: 'test-secret-key',
    quarantineBucket: 'test-quarantine',
    privateBucket: 'test-private',
  },
};

describe('HTTP security policy', () => {
  const apps: Array<Awaited<ReturnType<typeof buildServer>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('fails closed for production mutations without the exact browser Origin', () => {
    expect(
      isMutationOriginAllowed({
        method: 'POST',
        origin: undefined,
        webOrigin: WEB_ORIGIN,
        authRequired: true,
      }),
    ).toBe(false);
    expect(
      isMutationOriginAllowed({
        method: 'PATCH',
        origin: 'https://attacker.example',
        webOrigin: WEB_ORIGIN,
        authRequired: true,
      }),
    ).toBe(false);
    expect(
      isMutationOriginAllowed({
        method: 'DELETE',
        origin: WEB_ORIGIN,
        webOrigin: WEB_ORIGIN,
        authRequired: true,
      }),
    ).toBe(true);
    expect(
      isMutationOriginAllowed({
        method: 'GET',
        origin: undefined,
        webOrigin: WEB_ORIGIN,
        authRequired: true,
      }),
    ).toBe(true);
  });

  it('keeps explicit no-OIDC local operations compatible without weakening Origin checks', () => {
    expect(
      isMutationOriginAllowed({
        method: 'POST',
        origin: undefined,
        webOrigin: 'http://localhost:3000',
        authRequired: false,
      }),
    ).toBe(true);
    expect(
      isMutationOriginAllowed({
        method: 'POST',
        origin: 'https://attacker.example',
        webOrigin: 'http://localhost:3000',
        authRequired: false,
      }),
    ).toBe(false);
  });

  it('marks auth and protected JSON responses private/no-store', async () => {
    const app = await buildServer(config);
    apps.push(app);

    const auth = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(auth.statusCode).toBe(401);
    expect(auth.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(auth.headers.pragma).toBe('no-cache');
    expect(auth.headers.expires).toBe('0');

    const protectedResponse = await app.inject({ method: 'GET', url: '/people' });
    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.headers['cache-control']).toBe('private, no-store, max-age=0');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['cache-control']).toBeUndefined();
  });

  it('rejects a production form mutation with no Origin before route handling', async () => {
    const app = await buildServer(config);
    apps.push(app);

    const rejected = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ title: 'Недопустимый Origin' });
    expect(rejected.headers['cache-control']).toBe('private, no-store, max-age=0');

    const accepted = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: WEB_ORIGIN },
    });
    expect(accepted.statusCode).toBe(303);
    expect(accepted.headers.location).toBe(WEB_ORIGIN);
    expect(accepted.headers['cache-control']).toBe('private, no-store, max-age=0');
  });

  it('accepts the browser logout form post (urlencoded body)', async () => {
    const app = await buildServer(config);
    apps.push(app);

    // The sidebar logout button is a plain HTML form, so the browser sends an
    // urlencoded body. This used to fail with 415/500 before the parser existed.
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        origin: WEB_ORIGIN,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: '',
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(WEB_ORIGIN);
  });

  it('clears the session cookie on logout even when the OIDC provider is unreachable', async () => {
    // Discovery targets a closed local port so the end-session branch fails fast
    // and the handler must still fall back to the CRM origin.
    const app = await buildServer({
      ...config,
      oidc: { ...config.oidc, issuer: 'http://127.0.0.1:1/realms/cpi-crm' },
    });
    apps.push(app);

    const session = app.createSecureSession({
      user: {
        sub: 'test-subject',
        userId: '00000000-0000-0000-0000-000000000000',
        name: 'Тестовый пользователь',
        roles: [Roles.ADMIN],
        permissions: [],
      },
      idToken: 'stale-id-token',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: WEB_ORIGIN },
      cookies: { cpi_session: app.encodeSecureSession(session) },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(WEB_ORIGIN);
    const setCookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    const cleared = setCookie.find((value) => value.startsWith('cpi_session='));
    expect(cleared).toMatch(/^cpi_session=;/);
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('cache policy routing', () => {
  it('leaves only operational health and documentation routes cache-neutral', () => {
    expect(shouldUsePrivateNoStore('/health')).toBe(false);
    expect(shouldUsePrivateNoStore('/ready')).toBe(false);
    expect(shouldUsePrivateNoStore('/documentation/static/index.css')).toBe(false);
    expect(shouldUsePrivateNoStore('/auth/login')).toBe(true);
    expect(shouldUsePrivateNoStore('/people')).toBe(true);
    expect(shouldUsePrivateNoStore(undefined)).toBe(true);
  });

  it('forces signed S3 downloads to remain private and uncached', () => {
    expect(
      privateDownloadRequest({
        bucket: 'private',
        objectKey: 'files/example',
        originalFilename: 'Отчёт 2026.pdf',
      }),
    ).toEqual({
      Bucket: 'private',
      Key: 'files/example',
      ResponseContentDisposition:
        "attachment; filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%202026.pdf",
      ResponseCacheControl: 'private, no-store, max-age=0',
    });
  });
});
