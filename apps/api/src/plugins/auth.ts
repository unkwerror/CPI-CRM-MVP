import secureSession from '@fastify/secure-session';
import {
  Permissions,
  Roles,
  hasPermission,
  normalizeEmail,
  permissionsForRoles,
  type Permission,
  type Role,
} from '@cpi-crm/domain';
import type { FastifyInstance } from 'fastify';
import * as oidc from 'openid-client';

import { HttpProblem } from '../lib/problem.js';
import type { AuthUser } from '../types.js';

const validRoles = new Set<string>(Object.values(Roles));
const controlCharacters = /[\u0000-\u001f\u007f]/u;

/**
 * Keeps post-login navigation on the CRM origin. Fastify has already decoded
 * the query string once, while the explicit decode below also catches encoded
 * slashes, backslashes, and control characters before they reach Location.
 */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    controlCharacters.test(value)
  ) {
    return '/';
  }

  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes('\\') ||
      controlCharacters.test(decoded)
    ) {
      return '/';
    }
  } catch {
    return '/';
  }

  return value;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(secureSession, {
    key: app.config.sessionKey,
    cookieName: 'cpi_session',
    expiry: 8 * 60 * 60,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: !app.config.webOrigin.startsWith('http://localhost'),
    },
  });

  // The logout button submits a plain HTML form (application/x-www-form-urlencoded).
  // Fastify has no parser for that media type out of the box and rejects the POST
  // with FST_ERR_CTP_INVALID_MEDIA_TYPE before the route runs. No route reads a
  // form body, so the payload is discarded.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer', bodyLimit: 1024 },
    (_request, _body, done) => done(null, undefined),
  );

  app.decorateRequest('authUser', null);

  app.decorate('authenticate', async (request, _reply) => {
    const sessionUser = request.session.get('user');
    if (sessionUser) {
      // Permissions are derived from roles on every request so a deployed role-matrix
      // change takes effect without forcing every active user to sign in again.
      request.authUser = {
        ...sessionUser,
        permissions: [...permissionsForRoles(sessionUser.roles)],
      };
      return;
    }
    if (!app.config.authRequired) {
      request.authUser = await ensureAppUser(app, {
        sub: 'local-auth-disabled',
        name: 'Локальный администратор',
        email: 'local-admin@cpi.local',
        roles: [Roles.ADMIN],
      });
      return;
    }
    throw new HttpProblem(401, 'Требуется вход', 'Авторизуйтесь через OIDC-провайдер.');
  });

  app.decorate('requirePermission', (permission: Permission) => async (request, reply) => {
    await app.authenticate(request, reply);
    if (!request.authUser || !hasPermission(request.authUser.roles, permission)) {
      throw new HttpProblem(403, 'Доступ запрещён', `Требуется разрешение ${permission}.`);
    }
  });

  const issuer = new URL(app.config.oidc.issuer);
  let oidcConfiguration: Promise<oidc.Configuration> | undefined;
  const configuration = () => {
    oidcConfiguration ??= oidc
      .discovery(
        issuer,
        app.config.oidc.clientId,
        app.config.oidc.clientSecret,
        undefined,
        // openid-client rejects plain-HTTP issuers by default, which breaks the
        // local docker Keycloak on http://localhost:8080. Production stays HTTPS-only.
        issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        // Drop the cached rejection so a transient Keycloak outage does not
        // permanently break login/logout until the API restarts.
        oidcConfiguration = undefined;
        throw error;
      });
    return oidcConfiguration;
  };

  app.get(
    '/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const config = await configuration();
      const verifier = oidc.randomPKCECodeVerifier();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const state = oidc.randomState();
      const query = request.query as { returnTo?: string };
      const returnTo = safeReturnTo(query.returnTo);
      request.session.set('oidc', { verifier, state, returnTo });
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: app.config.oidc.redirectUri,
        scope: 'openid profile email',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      });
      return reply.redirect(url.href);
    },
  );

  app.get('/auth/callback', async (request, reply) => {
    const pending = request.session.get('oidc');
    if (!pending) throw new HttpProblem(400, 'Сессия входа истекла', 'Начните вход заново.');
    const callbackUrl = new URL(app.config.oidc.redirectUri);
    callbackUrl.search = new URL(request.url, app.config.webOrigin).search;
    const tokens = await oidc.authorizationCodeGrant(await configuration(), callbackUrl, {
      pkceCodeVerifier: pending.verifier,
      expectedState: pending.state,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new HttpProblem(401, 'OIDC не вернул subject');
    const roles = recognizedRoles(claims.realm_roles);
    if (roles.length === 0) {
      request.session.set('oidc', undefined);
      throw new HttpProblem(
        403,
        'Роль CRM не назначена',
        'Администратор должен назначить одну из разрешённых ролей ЦПИ.',
      );
    }
    const user = await ensureAppUser(app, {
      sub: claims.sub,
      name:
        (typeof claims.name === 'string' && claims.name) ||
        (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
        'Пользователь ЦПИ',
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      roles,
    });
    request.session.set('user', user);
    request.session.set('idToken', tokens.id_token);
    request.session.set('oidc', undefined);
    return reply.redirect(pending.returnTo);
  });

  app.get('/auth/me', async (request, reply) => {
    await app.authenticate(request, reply);
    return request.authUser;
  });

  app.post('/auth/logout', async (request, reply) => {
    const idToken = request.session.get('idToken');
    request.session.delete();

    if (app.config.authRequired && idToken) {
      try {
        const url = oidc.buildEndSessionUrl(await configuration(), {
          id_token_hint: idToken,
          post_logout_redirect_uri: new URL('/', app.config.webOrigin).href,
        });
        return reply.redirect(url.href, 303);
      } catch (error) {
        request.log.warn({ err: error }, 'OIDC end-session is unavailable; local logout completed');
      }
    }

    return reply.redirect(app.config.webOrigin, 303);
  });
}

async function ensureAppUser(
  app: FastifyInstance,
  identity: { sub: string; name: string; email?: string; roles: Role[] },
): Promise<AuthUser> {
  const email = identity.email ?? `${identity.sub.replace(/[^a-z0-9-]/giu, '-')}@oidc.local`;
  const result = await app.pool.query<{ id: string }>(
    `INSERT INTO app_users
       (oidc_subject, email, normalized_email, display_name, last_login_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (oidc_subject) DO UPDATE
       SET email = EXCLUDED.email,
           normalized_email = EXCLUDED.normalized_email,
           display_name = EXCLUDED.display_name,
           last_login_at = now(),
           updated_at = now()
     RETURNING id`,
    [identity.sub, email, normalizeEmail(email), identity.name],
  );
  const roles = identity.roles.filter((role) => validRoles.has(role));
  return {
    sub: identity.sub,
    userId: result.rows[0]!.id,
    name: identity.name,
    email,
    roles,
    permissions: [...permissionsForRoles(roles)],
  };
}

export const routePermissions = Permissions;

export function recognizedRoles(claim: unknown): Role[] {
  if (!Array.isArray(claim)) return [];
  return claim.filter((role): role is Role => typeof role === 'string' && validRoles.has(role));
}
