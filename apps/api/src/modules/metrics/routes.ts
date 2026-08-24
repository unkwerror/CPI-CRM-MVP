import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { loadOperationalPeriodReport, resolvePeriod } from '../../lib/period-report.js';
import { getOrganizationContext } from '../../lib/organization.js';
import { HttpProblem } from '../../lib/problem.js';

/**
 * Единый операционный отчёт CRM. Те же вычисления используются вкладкой
 * «Выгрузки» и изображением в ZIP, поэтому цифры не расходятся между экранами.
 */
export async function registerMetricRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/cpi',
    {
      preHandler: app.requirePermission(Permissions.METRICS_READ),
      schema: {
        tags: ['Дашборд'],
        summary: 'Операционные метрики участников и артефактов за период',
        querystring: Type.Object({
          weeks: Type.Optional(Type.Integer({ minimum: 1, maximum: 52 })),
          from: Type.Optional(Type.String({ format: 'date-time' })),
          to: Type.Optional(Type.String({ format: 'date-time' })),
        }),
      },
    },
    async (request) => {
      const query = request.query as { weeks?: number; from?: string; to?: string };
      let period;
      try {
        period = resolvePeriod(query);
      } catch (error) {
        throw new HttpProblem(400, error instanceof Error ? error.message : 'Некорректный период');
      }
      const organization = await getOrganizationContext(app.pool);
      return loadOperationalPeriodReport(app.pool, organization.id, period);
    },
  );
}
