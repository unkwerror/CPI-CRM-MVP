import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createConcurrencyGuard } from '../src/lib/heavy-operations.js';
import { HttpProblem } from '../src/lib/problem.js';

describe('heavy operation concurrency guard', () => {
  it('rejects work above the limit and releases the slot after the response finishes', async () => {
    const app = Fastify({ logger: false });
    const guard = createConcurrencyGuard({
      maxConcurrent: 1,
      title: 'Операция уже выполняется',
      detail: 'Повторите позже.',
      retryAfterSeconds: 17,
    });
    let signalStarted!: () => void;
    let signalFinished!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      signalFinished = resolve;
    });

    app.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof HttpProblem) {
        return reply.code(error.status).send({ status: error.status, title: error.title });
      }
      throw error;
    });
    app.get('/heavy', { preHandler: guard }, async () => {
      signalStarted();
      await finish;
      return { ok: true };
    });

    const first = app.inject({ method: 'GET', url: '/heavy' });
    await started;

    const blocked = await app.inject({ method: 'GET', url: '/heavy' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('17');
    expect(blocked.json()).toEqual({ status: 429, title: 'Операция уже выполняется' });

    signalFinished();
    expect((await first).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/heavy' })).statusCode).toBe(200);

    await app.close();
  });

  it('rejects an invalid concurrency limit at startup', () => {
    expect(() =>
      createConcurrencyGuard({
        maxConcurrent: 0,
        title: 'Операция уже выполняется',
        detail: 'Повторите позже.',
      }),
    ).toThrow('maxConcurrent must be a positive integer');
  });
});
