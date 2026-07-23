import { Permissions } from '@cpi-crm/domain';
import type { FastifyInstance } from 'fastify';

/**
 * FPF-метрики (Функция–Процесс–Форма): минимальный связанный набор показателей
 * вместо сложных KPI. Поток (выручка + средний чек парой), Инвестиции (размер и
 * качество базы) и процессные метрики: % активированных и % отвалившихся
 * (отрицательная метрика удержания — нет артефактов 3 месяца).
 */
export async function registerMetricRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/fpf',
    { preHandler: app.requirePermission(Permissions.METRICS_READ), schema: { tags: ['Дашборд'] } },
    async () => {
      const [flow, base, processes] = await Promise.all([
        app.pool.query<{
          revenue_total: string;
          revenue_90d: string;
          won_deals: string;
          won_deals_90d: string;
          grant_revenue: string;
          commercial_revenue: string;
          open_pipeline: string;
          open_deals: string;
        }>(
          `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'WON'), 0)::text AS revenue_total,
                  COALESCE(sum(amount) FILTER (WHERE status = 'WON' AND closed_at >= now() - interval '90 days'), 0)::text AS revenue_90d,
                  count(*) FILTER (WHERE status = 'WON')::text AS won_deals,
                  count(*) FILTER (WHERE status = 'WON' AND closed_at >= now() - interval '90 days')::text AS won_deals_90d,
                  COALESCE(sum(amount) FILTER (WHERE status = 'WON' AND deal_type = 'GRANT'), 0)::text AS grant_revenue,
                  COALESCE(sum(amount) FILTER (WHERE status = 'WON' AND deal_type = 'COMMERCIAL'), 0)::text AS commercial_revenue,
                  COALESCE(sum(amount) FILTER (WHERE status IN ('LEAD', 'NEGOTIATION')), 0)::text AS open_pipeline,
                  count(*) FILTER (WHERE status IN ('LEAD', 'NEGOTIATION'))::text AS open_deals
             FROM deals
            WHERE archived_at IS NULL`,
        ),
        app.pool.query<{
          total_people: string;
          activated: string;
          churned: string;
          new_people_30d: string;
          artifact_authors_90d: string;
        }>(
          `SELECT count(*)::text AS total_people,
                  count(*) FILTER (WHERE activation_state = 'ACTIVATED')::text AS activated,
                  count(*) FILTER (
                    WHERE activation_state = 'ACTIVATED'
                      AND (last_artifact_at IS NULL OR last_artifact_at < now() - interval '90 days')
                  )::text AS churned,
                  count(*) FILTER (WHERE created_at >= now() - interval '30 days')::text AS new_people_30d,
                  (SELECT count(DISTINCT avc.person_id)
                     FROM artifact_version_contributors avc
                     JOIN artifact_versions av ON av.id = avc.artifact_version_id
                    WHERE av.qualifies_for_activity
                      AND av.submitted_at >= now() - interval '90 days')::text AS artifact_authors_90d
             FROM persons
            WHERE archived_at IS NULL AND merged_into_person_id IS NULL`,
        ),
        app.pool.query<{
          partners_total: string;
          partners_active: string;
          partners_touched_30d: string;
          active_agreements: string;
          products_total: string;
          products_on_sale: string;
          products_closed: string;
          events_total: string;
          events_upcoming: string;
        }>(
          `SELECT (SELECT count(*) FROM partners WHERE archived_at IS NULL AND status <> 'CLOSED')::text AS partners_total,
                  (SELECT count(*) FROM partners WHERE archived_at IS NULL AND status = 'ACTIVE')::text AS partners_active,
                  (SELECT count(DISTINCT partner_id) FROM partner_interactions
                    WHERE archived_at IS NULL AND occurred_at >= now() - interval '30 days')::text AS partners_touched_30d,
                  (SELECT count(*) FROM partner_agreements WHERE archived_at IS NULL AND status = 'ACTIVE')::text AS active_agreements,
                  (SELECT count(*) FROM products WHERE archived_at IS NULL)::text AS products_total,
                  (SELECT count(*) FROM products WHERE archived_at IS NULL AND status = 'ON_SALE')::text AS products_on_sale,
                  (SELECT count(*) FROM products WHERE archived_at IS NULL AND status = 'CLOSED')::text AS products_closed,
                  (SELECT count(*) FROM events WHERE archived_at IS NULL)::text AS events_total,
                  (SELECT count(*) FROM events
                    WHERE archived_at IS NULL AND status IN ('PLANNED', 'ACTIVE'))::text AS events_upcoming`,
        ),
      ]);

      const flowRow = flow.rows[0]!;
      const baseRow = base.rows[0]!;
      const processRow = processes.rows[0]!;

      const totalPeople = Number(baseRow.total_people);
      const activated = Number(baseRow.activated);
      const churned = Number(baseRow.churned);
      const revenueTotal = Number(flowRow.revenue_total);
      const wonDeals = Number(flowRow.won_deals);

      return {
        flow: {
          revenueTotal,
          revenue90d: Number(flowRow.revenue_90d),
          wonDeals,
          wonDeals90d: Number(flowRow.won_deals_90d),
          averageCheck: wonDeals > 0 ? revenueTotal / wonDeals : 0,
          revenuePerHead: totalPeople > 0 ? revenueTotal / totalPeople : 0,
          grantRevenue: Number(flowRow.grant_revenue),
          commercialRevenue: Number(flowRow.commercial_revenue),
          openPipeline: Number(flowRow.open_pipeline),
          openDeals: Number(flowRow.open_deals),
        },
        investments: {
          basePeople: totalPeople,
          activated,
          activationRate: totalPeople > 0 ? activated / totalPeople : 0,
          churned,
          churnRate: activated > 0 ? churned / activated : 0,
          newPeople30d: Number(baseRow.new_people_30d),
          artifactAuthors90d: Number(baseRow.artifact_authors_90d),
        },
        processes: {
          partnersTotal: Number(processRow.partners_total),
          partnersActive: Number(processRow.partners_active),
          partnersTouched30d: Number(processRow.partners_touched_30d),
          activeAgreements: Number(processRow.active_agreements),
          productsTotal: Number(processRow.products_total),
          productsOnSale: Number(processRow.products_on_sale),
          productsClosed: Number(processRow.products_closed),
          eventsTotal: Number(processRow.events_total),
          eventsUpcoming: Number(processRow.events_upcoming),
        },
      };
    },
  );
}
