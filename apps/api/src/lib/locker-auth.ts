import { timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { HttpProblem } from './problem.js';

export function isLockerAuthorizationValid(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function requireLockerIntegration(expectedToken: string) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!isLockerAuthorizationValid(request.headers.authorization, expectedToken)) {
      throw new HttpProblem(401, 'Интеграция Locker не авторизована');
    }
  };
}
