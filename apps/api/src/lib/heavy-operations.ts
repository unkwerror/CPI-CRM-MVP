import type { FastifyReply, FastifyRequest } from 'fastify';

import { HttpProblem } from './problem.js';

interface RateLimitContext {
  statusCode: number;
  after: string;
}

interface ConcurrencyGuardOptions {
  maxConcurrent: number;
  title: string;
  detail: string;
  retryAfterSeconds?: number;
}

/**
 * Applies a stricter per-user rate limit after the permission pre-handler has
 * authenticated the request. The IP fallback keeps the helper safe if it is
 * accidentally attached before authentication.
 */
export function heavyOperationRateLimit(max: number, timeWindow: string) {
  return {
    max,
    timeWindow,
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) =>
      request.authUser ? `user:${request.authUser.sub}` : `ip:${request.ip}`,
    errorResponseBuilder: (_request: FastifyRequest, context: RateLimitContext) =>
      new HttpProblem(
        context.statusCode,
        'Слишком много тяжёлых операций',
        `Повторите запрос через ${context.after}.`,
      ),
  };
}

/**
 * Bounds expensive work inside one API process. The slot is held until the
 * response (including a streamed response) finishes or the client disconnects.
 */
export function createConcurrencyGuard(options: ConcurrencyGuardOptions) {
  if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
    throw new TypeError('maxConcurrent must be a positive integer');
  }

  let active = 0;

  return async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (active >= options.maxConcurrent) {
      reply.header('Retry-After', String(options.retryAfterSeconds ?? 10));
      throw new HttpProblem(429, options.title, options.detail);
    }

    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };

    reply.raw.once('finish', release);
    reply.raw.once('close', release);
  };
}
