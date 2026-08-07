'use client';

import {
  BanknoteIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HandshakeIcon,
  type LucideIcon,
  PackageIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { api, formatMoney } from '@/lib/api';
import type { CpiMetrics } from '@/lib/types';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(key: string): { from: string; to: string } {
  const [year, month] = key.split('-').map(Number);
  const from = new Date(Date.UTC(year!, month! - 1, 1));
  const to = new Date(Date.UTC(year!, month!, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year!, month! - 1 + delta, 1)));
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : formatMoney(value);

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : `${value.toFixed(1)} %`;

const count = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : value.toLocaleString('ru-RU');

const decimal = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : value.toFixed(1);

function Metric({
  label,
  value,
  hint,
  loading,
  href,
  icon: Icon,
  kicker,
}: {
  label: string;
  value: string;
  hint: ReactNode;
  loading: boolean;
  href?: string;
  icon?: LucideIcon;
  kicker?: { text: string; variant: BadgeVariant };
}) {
  const body = (
    <div className="group-hover:border-primary/40 flex h-full flex-col gap-1 rounded-lg border px-3.5 py-3 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground text-[13px] font-medium">{label}</span>
        {kicker ? (
          <Badge variant={kicker.variant}>{kicker.text}</Badge>
        ) : Icon ? (
          <Icon className="text-muted-foreground size-4 shrink-0" />
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="my-1 h-7 w-28" />
      ) : (
        <strong className="text-2xl font-semibold tracking-tight tabular">{value}</strong>
      )}
      {loading ? (
        <Skeleton className="mt-auto h-3.5 w-full" />
      ) : (
        <span className="text-muted-foreground mt-auto text-xs">{hint}</span>
      )}
    </div>
  );

  if (!href) return body;
  return (
    <Link className="group block" href={href}>
      {body}
    </Link>
  );
}

function MetricGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</CardContent>
    </Card>
  );
}

export default function MetricsPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [metrics, setMetrics] = useState<CpiMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(() => monthBounds(month), [month]);

  useEffect(() => {
    setMetrics(null);
    setError(null);
    const params = new URLSearchParams({ from: bounds.from, to: bounds.to });
    void api<CpiMetrics>(`/dashboard/cpi?${params}`)
      .then(setMetrics)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Метрики недоступны'));
  }, [bounds]);

  if (error) {
    return (
      <PageStack>
        <PageHeader eyebrow="Метрики ЦПИ" title="Метрики недоступны" />
        <Card>
          <EmptyState title="Не удалось загрузить показатели" text={error} />
        </Card>
      </PageStack>
    );
  }

  const m = metrics;
  const loading = m === null;

  return (
    <PageStack>
      <PageHeader
        eyebrow="ЦПИ: метрики и рабочие определения"
        title="Панель метрик"
        description="Выручка, поток и средний чек — по факту оплаты. Артефакт засчитывается только после оценки по рубрикатору (Q ≥ 7 без нуля по релевантности и проверяемости)."
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              aria-label="Предыдущий месяц"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeftIcon />
            </Button>
            <Input
              aria-label="Период"
              className="w-40"
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              type="month"
              value={month}
            />
            <Button
              aria-label="Следующий месяц"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRightIcon />
            </Button>
          </div>
        }
      />

      <MetricGroup title="Экономика">
        <Metric
          href="/deals"
          icon={BanknoteIcon}
          label="Выручка (оплачено)"
          loading={loading}
          value={money(m?.economics.revenue)}
          hint={`${count(m?.economics.paidDeals)} оплаченных сделок за период`}
        />
        <Metric
          kicker={{ text: 'Главная метрика', variant: 'soft-success' }}
          label="Поток"
          loading={loading}
          value={money(m?.economics.flow)}
          hint={`выручка − переменные затраты (${money(m?.economics.variableExpenses)})`}
        />
        <Metric
          kicker={{ text: 'Пара к выручке', variant: 'soft-primary' }}
          label="Средний чек"
          loading={loading}
          value={money(m?.economics.averageCheck)}
          hint="по оплаченным сделкам периода"
        />
        <Metric
          href="/expenses"
          icon={WalletIcon}
          label="OpEx %"
          loading={loading}
          value={percent(m?.economics.opexPercent)}
          hint={`операционные + бэк-офис: ${money(m?.economics.opexExpenses)} (бэк-офис ${percent(
            m?.economics.backOfficePercent,
          )})`}
        />
        <Metric
          label="Средняя выручка на голову"
          loading={loading}
          value={money(m?.economics.revenuePerActiveHead)}
          hint={`активные головы: ${count(m?.economics.activeHeadsStart)} → ${count(
            m?.economics.activeHeadsEnd,
          )} (среднее за период)`}
        />
      </MetricGroup>

      <MetricGroup title="Воронка и артефакты">
        <Metric
          href="/participants"
          icon={UsersIcon}
          label="Новые строки в базе"
          loading={loading}
          value={count(m?.funnel.newPeople)}
          hint={`стоимость строки: ${money(m?.funnel.costPerNewPerson)} (привлечение ${money(
            m?.funnel.acquisitionExpenses,
          )})`}
        />
        <Metric
          label="Конверсия в качественный артефакт"
          loading={loading}
          value={percent(m?.funnel.artifactConversion)}
          hint={`${count(m?.funnel.qualityArtifactAuthors)} авторов из ${count(
            m?.funnel.actualParticipants,
          )} фактических участников`}
        />
        <Metric
          label="Стоимость человека с артефактом"
          loading={loading}
          value={money(m?.funnel.costPerQualityAuthor)}
          hint={`прямые расходы ${money(m?.funnel.directExpenses)} / уникальные авторы`}
        />
        <Metric
          label="Средний Q_artifact"
          loading={loading}
          value={decimal(m?.funnel.averageQArtifact)}
          hint={`${count(m?.funnel.reviewedArtifacts)} оценённых артефактов за период`}
        />
      </MetricGroup>

      <MetricGroup title="Активация и удержание">
        <Metric
          kicker={{ text: 'Ключевой переход', variant: 'soft-success' }}
          label="Процент активированных"
          loading={loading}
          value={percent(m?.activation.activationRate)}
          hint={`${count(m?.activation.newActivatedHeads)} активированных из ${count(
            m?.activation.firstQualityAuthors,
          )} с первым качественным артефактом`}
        />
        <Metric
          label="Стоимость активации"
          loading={loading}
          value={money(m?.activation.activationCost)}
          hint={`расходы на активацию: ${money(m?.activation.activationExpenses)}`}
        />
        <Metric
          kicker={{ text: 'Отрицательная метрика', variant: 'soft-warning' }}
          label="Отток 90"
          loading={loading}
          value={percent(m?.activation.churn90)}
          hint={
            <span className="inline-flex items-center gap-1">
              <TrendingDownIcon className="size-3.5 shrink-0" />
              {count(m?.activation.churnedFromStart)} из {count(m?.activation.activeAtStart)}{' '}
              активных на начало без артефакта 90 дней
            </span>
          }
        />
        <Metric
          label="Удержание активных голов"
          loading={loading}
          value={percent(m?.activation.retention)}
          hint={
            <span className="inline-flex items-center gap-1">
              <TrendingUpIcon className="size-3.5 shrink-0" />
              100 % − отток 90
            </span>
          }
        />
      </MetricGroup>

      <MetricGroup title="Монетизация">
        <Metric
          label="Конверсия в монетизацию"
          loading={loading}
          value={percent(m?.monetization.monetizationRate)}
          hint={`${count(m?.monetization.monetizedHeads)} из ${count(
            m?.monetization.activatedHeads,
          )} активированных связаны с оплаченной сделкой`}
        />
        <Metric
          href="/partners"
          icon={HandshakeIcon}
          label="Выручка на активного партнёра"
          loading={loading}
          value={money(m?.monetization.revenuePerActivePartner)}
          hint={`${money(m?.monetization.partnerRevenue)} партнёрской выручки / ${count(
            m?.monetization.activePartners,
          )} активных партнёров`}
        />
      </MetricGroup>

      <Card>
        <CardHeader>
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Поток продукта
            </p>
            <CardTitle className="mt-1">Продуктовая результативность</CardTitle>
          </div>
          <CardAction>
            <Button asChild size="sm" variant="ghost">
              <Link href="/products">
                <PackageIcon />
                Все продукты
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        {loading ? (
          <CardContent className="space-y-3">
            {[0, 1, 2].map((row) => (
              <Skeleton className="h-9 w-full" key={row} />
            ))}
          </CardContent>
        ) : m.monetization.products.length === 0 ? (
          <EmptyState
            title="Нет продуктовой выручки"
            text="За период нет продуктов с выручкой или затратами."
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Продукт</TableHead>
                  <TableHead className="text-right">Выручка (оплачено)</TableHead>
                  <TableHead className="text-right">Переменные затраты</TableHead>
                  <TableHead className="text-right">Поток</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.monetization.products.map((product) => (
                  <TableRow key={product.productId}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-right tabular">{money(product.revenue)}</TableCell>
                    <TableCell className="text-right tabular">
                      {money(product.variableExpenses)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular">
                      {money(product.flow)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>
    </PageStack>
  );
}
