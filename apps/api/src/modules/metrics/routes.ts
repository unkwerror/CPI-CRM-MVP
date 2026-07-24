import { Permissions } from '@cpi-crm/domain';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { HttpProblem } from '../../lib/problem.js';

/**
 * Панель метрик ЦПИ («ЦПИ: метрики и рабочие определения», июль 2026).
 *
 * Четыре блока: экономика (выручка по факту оплаты, поток, средний чек,
 * OpEx%, выручка на голову), воронка и артефакты, активация и удержание,
 * монетизация. Качественный артефакт: Q_artifact >= 7 без нуля по
 * релевантности/проверяемости (для старых ревью — только порог балла).
 */

/** Событие «качественный артефакт» на человека: текущее финальное принятое ревью. */
const QUALITY_EVENTS_CTE = `
  quality AS (
    SELECT avc.person_id, av.submitted_at
      FROM artifact_version_contributors avc
      JOIN artifact_versions av ON av.id = avc.artifact_version_id
      JOIN artifact_review_selections sel ON sel.artifact_version_id = av.id
      JOIN artifact_reviews ar ON ar.id = sel.current_final_review_id
      JOIN persons p ON p.id = avc.person_id
     WHERE av.qualifies_for_activity
       AND av.submitted_at IS NOT NULL
       AND ar.voided_at IS NULL
       AND ar.status = 'FINAL'
       AND ar.decision = 'ACCEPTED'
       AND ar.score >= 7
       AND (
         ar.criteria IS NULL
         OR ((ar.criteria->>'relevance')::int > 0 AND (ar.criteria->>'verifiability')::int > 0)
       )
       AND p.archived_at IS NULL
       AND p.merged_into_person_id IS NULL
  )
`;

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function percent(numerator: number, denominator: number): number | null {
  const value = ratio(numerator, denominator);
  return value === null ? null : value * 100;
}

export async function registerMetricRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/cpi',
    {
      preHandler: app.requirePermission(Permissions.METRICS_READ),
      schema: {
        tags: ['Дашборд'],
        querystring: Type.Object({
          from: Type.Optional(Type.String({ format: 'date-time' })),
          to: Type.Optional(Type.String({ format: 'date-time' })),
        }),
      },
    },
    async (request) => {
      const query = request.query as { from?: string; to?: string };
      const now = new Date();
      const from = query.from
        ? new Date(query.from)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const to = query.to
        ? new Date(query.to)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      if (!(from < to)) throw new HttpProblem(400, 'Начало периода должно быть раньше конца');

      const params = [from, to];

      const [economics, expensesByCategory, heads, funnel, activation, monetization, products] =
        await Promise.all([
          // Выручка и сделки — строго по факту оплаты (paid_at в периоде).
          app.pool.query<{
            revenue: string;
            paid_deals: string;
            partner_revenue: string;
          }>(
            `SELECT COALESCE(sum(paid_amount), 0)::text AS revenue,
                    count(*)::text AS paid_deals,
                    COALESCE(sum(paid_amount) FILTER (WHERE partner_id IS NOT NULL), 0)::text AS partner_revenue
               FROM deals
              WHERE archived_at IS NULL
                AND paid_at >= $1 AND paid_at < $2`,
            params,
          ),
          app.pool.query<{ category: string; total: string }>(
            `SELECT category, COALESCE(sum(amount), 0)::text AS total
               FROM expenses
              WHERE archived_at IS NULL
                AND occurred_at >= $1 AND occurred_at < $2
              GROUP BY category`,
            params,
          ),
          // Активные головы на границах периода: качественный артефакт за 30 дней до точки.
          app.pool.query<{ active_start: string; active_end: string }>(
            `WITH ${QUALITY_EVENTS_CTE}
             SELECT
               (SELECT count(DISTINCT person_id) FROM quality
                 WHERE submitted_at > $1::timestamptz - interval '30 days' AND submitted_at <= $1)::text AS active_start,
               (SELECT count(DISTINCT person_id) FROM quality
                 WHERE submitted_at > $2::timestamptz - interval '30 days' AND submitted_at <= $2)::text AS active_end`,
            params,
          ),
          app.pool.query<{
            new_people: string;
            actual_participants: string;
            quality_authors: string;
            reviewed_artifacts: string;
            average_q: string | null;
          }>(
            `WITH ${QUALITY_EVENTS_CTE}
             SELECT
               (SELECT count(*) FROM persons
                 WHERE archived_at IS NULL AND merged_into_person_id IS NULL
                   AND created_at >= $1 AND created_at < $2)::text AS new_people,
               (SELECT count(DISTINCT ep.person_id)
                  FROM event_participations ep
                  JOIN events e ON e.id = ep.event_id
                  JOIN persons p ON p.id = ep.person_id
                 WHERE ep.archived_at IS NULL AND e.archived_at IS NULL
                   AND p.archived_at IS NULL AND p.merged_into_person_id IS NULL
                   AND COALESCE(e.starts_at, ep.registered_at) >= $1
                   AND COALESCE(e.starts_at, ep.registered_at) < $2)::text AS actual_participants,
               (SELECT count(DISTINCT person_id) FROM quality
                 WHERE submitted_at >= $1 AND submitted_at < $2)::text AS quality_authors,
               (SELECT count(*) FROM artifact_reviews ar
                  JOIN artifact_review_selections sel ON sel.current_final_review_id = ar.id
                 WHERE ar.voided_at IS NULL AND ar.status = 'FINAL' AND ar.score IS NOT NULL
                   AND ar.reviewed_at >= $1 AND ar.reviewed_at < $2)::text AS reviewed_artifacts,
               (SELECT avg(ar.score)::text FROM artifact_reviews ar
                  JOIN artifact_review_selections sel ON sel.current_final_review_id = ar.id
                 WHERE ar.voided_at IS NULL AND ar.status = 'FINAL' AND ar.score IS NOT NULL
                   AND ar.reviewed_at >= $1 AND ar.reviewed_at < $2) AS average_q`,
            params,
          ),
          // Активация: первый качественный артефакт в периоде; активированной
          // голова остаётся, если на конец периода артефакт не старше 30 дней.
          app.pool.query<{
            first_quality_authors: string;
            new_activated: string;
            churned_from_start: string;
          }>(
            `WITH ${QUALITY_EVENTS_CTE},
             firsts AS (
               SELECT person_id, min(submitted_at) AS first_at FROM quality GROUP BY person_id
             ),
             active_start AS (
               SELECT DISTINCT person_id FROM quality
                WHERE submitted_at > $1::timestamptz - interval '30 days' AND submitted_at <= $1
             )
             SELECT
               (SELECT count(*) FROM firsts WHERE first_at >= $1 AND first_at < $2)::text AS first_quality_authors,
               (SELECT count(*) FROM firsts f
                 WHERE f.first_at >= $1 AND f.first_at < $2
                   AND EXISTS (
                     SELECT 1 FROM quality q
                      WHERE q.person_id = f.person_id
                        AND q.submitted_at > $2::timestamptz - interval '30 days'
                        AND q.submitted_at <= $2
                   ))::text AS new_activated,
               (SELECT count(*) FROM active_start a
                 WHERE NOT EXISTS (
                   SELECT 1 FROM quality q
                    WHERE q.person_id = a.person_id
                      AND q.submitted_at > $2::timestamptz - interval '90 days'
                      AND q.submitted_at <= $2
                 ))::text AS churned_from_start`,
            params,
          ),
          // Монетизация: активированные на конец периода, связанные с оплаченной сделкой.
          app.pool.query<{ activated_end: string; monetized: string; active_partners: string }>(
            `WITH ${QUALITY_EVENTS_CTE},
             activated_end AS (
               SELECT DISTINCT person_id FROM quality
                WHERE submitted_at > $2::timestamptz - interval '30 days' AND submitted_at <= $2
             )
             SELECT
               (SELECT count(*) FROM activated_end)::text AS activated_end,
               (SELECT count(*) FROM activated_end a
                 WHERE EXISTS (
                   SELECT 1 FROM deals d
                    WHERE d.person_id = a.person_id AND d.archived_at IS NULL AND d.paid_at IS NOT NULL
                 ))::text AS monetized,
               (SELECT count(DISTINCT pt.id) FROM partners pt
                 WHERE pt.archived_at IS NULL AND pt.status <> 'CLOSED'
                   AND EXISTS (
                     SELECT 1 FROM partner_interactions pi
                      WHERE pi.partner_id = pt.id AND pi.archived_at IS NULL
                        AND pi.occurred_at >= $1 AND pi.occurred_at < $2
                   )
                   AND (
                     EXISTS (SELECT 1 FROM partner_agreements pa
                              WHERE pa.partner_id = pt.id AND pa.archived_at IS NULL AND pa.status = 'ACTIVE')
                     OR EXISTS (SELECT 1 FROM deals d
                                 WHERE d.partner_id = pt.id AND d.archived_at IS NULL)
                   ))::text AS active_partners`,
            params,
          ),
          // Поток по продуктам: оплаченная выручка минус переменные затраты продукта.
          app.pool.query<{
            product_id: string;
            name: string;
            revenue: string;
            variable_expenses: string;
          }>(
            `SELECT product_id, name, revenue::text AS revenue, variable_expenses::text AS variable_expenses
               FROM (
                 SELECT pr.id AS product_id, pr.name,
                        COALESCE((SELECT sum(d.paid_amount) FROM deals d
                                   WHERE d.product_id = pr.id AND d.archived_at IS NULL
                                     AND d.paid_at >= $1 AND d.paid_at < $2), 0) AS revenue,
                        COALESCE((SELECT sum(e.amount) FROM expenses e
                                   WHERE e.product_id = pr.id AND e.archived_at IS NULL
                                     AND e.category = 'VARIABLE'
                                     AND e.occurred_at >= $1 AND e.occurred_at < $2), 0) AS variable_expenses
                   FROM products pr
                  WHERE pr.archived_at IS NULL
               ) product_flow
              ORDER BY revenue DESC, variable_expenses DESC
              LIMIT 5`,
            params,
          ),
        ]);

      const economicsRow = economics.rows[0]!;
      const headsRow = heads.rows[0]!;
      const funnelRow = funnel.rows[0]!;
      const activationRow = activation.rows[0]!;
      const monetizationRow = monetization.rows[0]!;

      const expenseTotals: Record<string, number> = Object.fromEntries(
        expensesByCategory.rows.map((row) => [row.category, Number(row.total)]),
      );
      const variableExpenses = expenseTotals['VARIABLE'] ?? 0;
      const opexExpenses = (expenseTotals['OPEX'] ?? 0) + (expenseTotals['BACK_OFFICE'] ?? 0);
      const backOfficeExpenses = expenseTotals['BACK_OFFICE'] ?? 0;
      const acquisitionExpenses = expenseTotals['ACQUISITION'] ?? 0;
      const activationExpenses = expenseTotals['ACTIVATION'] ?? 0;

      const revenue = Number(economicsRow.revenue);
      const paidDeals = Number(economicsRow.paid_deals);
      const partnerRevenue = Number(economicsRow.partner_revenue);
      const activeStart = Number(headsRow.active_start);
      const activeEnd = Number(headsRow.active_end);
      const averageActiveHeads = (activeStart + activeEnd) / 2;

      const newPeople = Number(funnelRow.new_people);
      const actualParticipants = Number(funnelRow.actual_participants);
      const qualityAuthors = Number(funnelRow.quality_authors);

      const firstQualityAuthors = Number(activationRow.first_quality_authors);
      const newActivated = Number(activationRow.new_activated);
      const churnedFromStart = Number(activationRow.churned_from_start);

      const activatedEnd = Number(monetizationRow.activated_end);
      const monetized = Number(monetizationRow.monetized);
      const activePartners = Number(monetizationRow.active_partners);

      const churn90 = percent(churnedFromStart, activeStart);

      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        economics: {
          revenue,
          paidDeals,
          variableExpenses,
          flow: revenue - variableExpenses,
          averageCheck: ratio(revenue, paidDeals),
          opexExpenses,
          backOfficeExpenses,
          opexPercent: percent(opexExpenses, revenue),
          backOfficePercent: percent(backOfficeExpenses, revenue),
          activeHeadsStart: activeStart,
          activeHeadsEnd: activeEnd,
          revenuePerActiveHead: ratio(revenue, averageActiveHeads),
        },
        funnel: {
          newPeople,
          acquisitionExpenses,
          costPerNewPerson: ratio(acquisitionExpenses, newPeople),
          actualParticipants,
          qualityArtifactAuthors: qualityAuthors,
          artifactConversion: percent(qualityAuthors, actualParticipants),
          directExpenses: variableExpenses,
          costPerQualityAuthor: ratio(variableExpenses, qualityAuthors),
          reviewedArtifacts: Number(funnelRow.reviewed_artifacts),
          averageQArtifact:
            funnelRow.average_q === null ? null : Number(funnelRow.average_q),
        },
        activation: {
          firstQualityAuthors,
          newActivatedHeads: newActivated,
          activationRate: percent(newActivated, firstQualityAuthors),
          activationExpenses,
          activationCost: ratio(activationExpenses, newActivated),
          activeAtStart: activeStart,
          churnedFromStart,
          churn90,
          retention: churn90 === null ? null : 100 - churn90,
        },
        monetization: {
          activatedHeads: activatedEnd,
          monetizedHeads: monetized,
          monetizationRate: percent(monetized, activatedEnd),
          partnerRevenue,
          activePartners,
          revenuePerActivePartner: ratio(partnerRevenue, activePartners),
          products: products.rows.map((row) => {
            const productRevenue = Number(row.revenue);
            const productVariable = Number(row.variable_expenses);
            return {
              productId: row.product_id,
              name: row.name,
              revenue: productRevenue,
              variableExpenses: productVariable,
              flow: productRevenue - productVariable,
            };
          }),
        },
      };
    },
  );
}
