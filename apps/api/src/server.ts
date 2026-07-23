import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { createDatabase } from '@cpi-crm/db';
import Fastify, { LogController, type FastifyError } from 'fastify';

import { loadConfig, type ApiConfig } from './config.js';
import { HttpProblem } from './lib/problem.js';
import { registerArtifactRoutes } from './modules/artifacts/routes.js';
import { registerCatalogRoutes } from './modules/catalogs/routes.js';
import { registerDealRoutes } from './modules/deals/routes.js';
import { registerEventRoutes } from './modules/events/routes.js';
import { registerExportRoutes } from './modules/exports/routes.js';
import { registerFileRoutes } from './modules/files/routes.js';
import { registerImportRoutes } from './modules/imports/routes.js';
import { registerMetricRoutes } from './modules/metrics/routes.js';
import { registerOperationRoutes } from './modules/operations/routes.js';
import { registerPartnerRoutes } from './modules/partners/routes.js';
import { registerPeopleRoutes } from './modules/people/routes.js';
import { registerProductRoutes } from './modules/products/routes.js';
import { registerAuth } from './plugins/auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutationOriginAllowed(input: {
  method: string;
  origin: string | undefined;
  webOrigin: string;
  authRequired: boolean;
}): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.origin === input.webOrigin) return true;

  // Explicit local development mode remains compatible with CLI/inject calls
  // that do not carry browser Origin headers. Production cookie sessions fail
  // closed; server-side operational jobs use their dedicated CLI entrypoints.
  return !input.authRequired && input.origin === undefined;
}

export function shouldUsePrivateNoStore(routeUrl: string | undefined): boolean {
  if (routeUrl === '/health' || routeUrl === '/ready') return false;
  return !routeUrl?.startsWith('/documentation');
}

export async function buildServer(config: ApiConfig = loadConfig()) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
      serializers: {
        req(request) {
          return {
            method: request.method,
            route: request.routeOptions?.url,
            requestId: request.id,
          };
        },
      },
    },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
    genReqId: (request) => String(request.headers['x-request-id'] ?? crypto.randomUUID()),
  }).withTypeProvider<TypeBoxTypeProvider>();

  const { db, pool } = createDatabase(config.databaseUrl);
  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('pool', pool);
  app.addHook('onClose', async () => pool.end());

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ЦПИ CRM API',
        version: '0.1.0',
        description: 'Контракт локального MVP реестра участников',
      },
      tags: [
        { name: 'Участники' },
        { name: 'Мероприятия' },
        { name: 'Партнёры' },
        { name: 'Продукты' },
        { name: 'Продажи' },
        { name: 'Экспорт' },
        { name: 'Артефакты' },
        { name: 'Файлы' },
        { name: 'Дубли' },
        { name: 'Импорт' },
        { name: 'Дашборд' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/documentation' });
  await registerAuth(app);

  app.addHook('onRequest', async (request) => {
    if (
      !isMutationOriginAllowed({
        method: request.method,
        origin: request.headers.origin,
        webOrigin: config.webOrigin,
        authRequired: config.authRequired,
      })
    ) {
      throw new HttpProblem(403, 'Недопустимый Origin', 'Запрос мутации отклонён CSRF-защитой.');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (shouldUsePrivateNoStore(request.routeOptions.url)) {
      reply
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('Pragma', 'no-cache')
        .header('Expires', '0');
    }
    return payload;
  });

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/ready', { schema: { hide: true } }, async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not-ready' });
    }
  });

  await registerPeopleRoutes(app);
  await registerEventRoutes(app);
  await registerExportRoutes(app);
  await registerArtifactRoutes(app);
  await registerCatalogRoutes(app);
  await registerFileRoutes(app);
  await registerImportRoutes(app);
  await registerOperationRoutes(app);
  await registerPartnerRoutes(app);
  await registerProductRoutes(app);
  await registerDealRoutes(app);
  await registerMetricRoutes(app);

  app.setNotFoundHandler(async (request) => {
    throw new HttpProblem(404, 'Маршрут не найден', `${request.method} не поддерживается.`);
  });
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const validation = 'validation' in error && error.validation;
    const pgCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const problem =
      error instanceof HttpProblem
        ? error
        : validation
          ? new HttpProblem(
              400,
              'Ошибка валидации',
              'Проверьте обязательные поля и формат значений.',
            )
          : pgCode === '23505'
            ? new HttpProblem(409, 'Конфликт данных', 'Такая запись или версия уже существует.')
            : pgCode === '23503'
              ? new HttpProblem(409, 'Нарушена связь данных')
              : new HttpProblem(500, 'Внутренняя ошибка');
    if (problem.status >= 500)
      request.log.error({ err: error, requestId: request.id }, 'request failed');
    return reply
      .code(problem.status)
      .type('application/problem+json')
      .send({
        type: problem.type,
        title: problem.title,
        status: problem.status,
        ...(problem.detail ? { detail: problem.detail } : {}),
        instance: request.routeOptions.url,
        requestId: request.id,
      });
  });

  return app;
}
