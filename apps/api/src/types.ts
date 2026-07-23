import type { Database } from '@cpi-crm/db';
import type { Permission, Role } from '@cpi-crm/domain';
import type { Pool } from 'pg';

import type { ApiConfig } from './config.js';

export interface AuthUser {
  sub: string;
  userId: string;
  name: string;
  email?: string;
  roles: Role[];
  permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    pool: Pool;
    config: ApiConfig;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    user?: AuthUser;
    idToken?: string;
    oidc?: { verifier: string; state: string; returnTo: string };
  }
}
