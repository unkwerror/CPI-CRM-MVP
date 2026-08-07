'use client';

import {
  AlertCircleIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  Clock3Icon,
  type LucideIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { DashboardMetrics, PeopleResponse } from '@/lib/types';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

/** Гистограмма оценок строится по всему диапазону рубрикатора, включая ноль. */
const SCORE_RANGE = Array.from({ length: 11 }, (_, index) => ({ score: index, count: 0 }));

const emptyMetrics: DashboardMetrics = {
  totalPeople: 0,
  activatedEver: 0,
  active: 0,
  medium: 0,
  inactive: 0,
  notActivated: 0,
  unknownLegacy: 0,
  unreviewedArtifacts: 0,
  duplicateCandidates: 0,
  overdueTasks: 0,
  recentVersions: 0,
  recentAuthors: 0,
  eventCount: 0,
  scoreDistribution: SCORE_RANGE,
};

const relativeFormatter = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

function relativeDays(value?: string | null): string {
  if (!value) return 'нет даты';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return relativeFormatter.format(-days, 'day');
}

function MetricTile({
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
  href: string;
  icon?: LucideIcon;
  kicker?: { text: string; variant: BadgeVariant };
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-primary/40 h-full transition-colors">
        <CardContent className="flex h-full flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-[13px] font-medium">{label}</span>
            {kicker ? (
              <Badge variant={kicker.variant}>{kicker.text}</Badge>
            ) : Icon ? (
              <Icon className="text-muted-foreground size-4" />
            ) : null}
          </div>
          {loading ? (
            <Skeleton className="my-1 h-7 w-24" />
          ) : (
            <strong className="text-2xl font-semibold tracking-tight tabular">{value}</strong>
          )}
          {loading ? (
            <Skeleton className="mt-auto h-3.5 w-36" />
          ) : (
            <span className="text-muted-foreground mt-auto text-xs">{hint}</span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function QueueItem({
  href,
  icon: Icon,
  value,
  label,
}: {
  href: string;
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  return (
    <Link
      className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors"
      href={href}
    >
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <strong className="block text-base font-semibold tabular">{value}</strong>
        <small className="text-muted-foreground text-xs">{label}</small>
      </span>
      <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [attention, setAttention] = useState<PeopleResponse['items']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<DashboardMetrics>('/dashboard/participants'),
      api<PeopleResponse>('/people?activityStatus=MEDIUM&limit=5'),
    ])
      .then(([nextMetrics, people]) => {
        setMetrics(nextMetrics);
        setAttention(people.items);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Дашборд недоступен'))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <PageStack>
        <PageHeader eyebrow="Операционный дашборд" title="Состояние CRM" />
        <Card>
          <EmptyState title="Не удалось загрузить показатели" text={error} />
        </Card>
      </PageStack>
    );
  }

  const maxScore = Math.max(1, ...metrics.scoreDistribution.map((item) => item.count));

  return (
    <PageStack>
      <PageHeader
        eyebrow="Операционный дашборд"
        title="Добрый день"
        description="Состояние базы и приоритеты команды на сегодня."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/imports">Импортировать данные</Link>
            </Button>
            <Button asChild>
              <Link href="/participants?create=1">Новый участник</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          href="/participants"
          icon={UsersIcon}
          label="Всего участников"
          loading={loading}
          value={metrics.totalPeople.toLocaleString('ru-RU')}
          hint={`${metrics.activatedEver.toLocaleString('ru-RU')} активированы когда-либо`}
        />
        <MetricTile
          href="/participants?activityStatus=ACTIVE"
          kicker={{ text: 'Сейчас', variant: 'soft-success' }}
          label="Активные"
          loading={loading}
          value={metrics.active.toLocaleString('ru-RU')}
          hint="Артефакт за последние 252 часа"
        />
        <MetricTile
          href="/participants?activityStatus=MEDIUM"
          kicker={{ text: 'Внимание', variant: 'soft-warning' }}
          label="Средняя активность"
          loading={loading}
          value={metrics.medium.toLocaleString('ru-RU')}
          hint="Главная рабочая очередь"
        />
        <MetricTile
          href="/participants?activityStatus=INACTIVE"
          kicker={{ text: 'Более 3 недель', variant: 'soft-destructive' }}
          label="Неактивные"
          loading={loading}
          value={metrics.inactive.toLocaleString('ru-RU')}
          hint="Нужен новый содержательный результат"
        />
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(280px,0.85fr)]">
        <Card>
          <CardHeader>
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Рабочая очередь
              </p>
              <CardTitle className="mt-1">Требуют внимания</CardTitle>
            </div>
            <CardAction>
              <Button asChild size="sm" variant="ghost">
                <Link href="/participants?activityStatus=MEDIUM">
                  Вся очередь
                  <ArrowRightIcon />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          {loading ? (
            <CardContent className="space-y-3">
              {[0, 1, 2].map((row) => (
                <Skeleton className="h-12 w-full" key={row} />
              ))}
            </CardContent>
          ) : attention.length === 0 ? (
            <EmptyState title="Очередь пуста" text="Участники средней активности появятся здесь." />
          ) : (
            <div className="divide-y">
              {attention.map((person) => (
                <Link
                  className="hover:bg-muted/50 flex items-center gap-3 px-5 py-3 transition-colors"
                  href={`/participants/${person.id}`}
                  key={person.id}
                >
                  <span className="bg-warning h-7 w-1 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <strong className="block truncate text-[13px] font-medium">
                      {person.canonicalFullName}
                    </strong>
                    <small className="text-muted-foreground block truncate text-xs">
                      {person.organization ?? person.primaryContact ?? 'Данные уточняются'}
                    </small>
                  </span>
                  <span className="text-warning inline-flex shrink-0 items-center gap-1 text-xs">
                    <Clock3Icon className="size-3.5" />
                    {relativeDays(person.lastArtifactAt)}
                  </span>
                  <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Качество данных
              </p>
              <CardTitle className="mt-1">Очереди</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-3">
            <QueueItem
              href="/events"
              icon={CalendarDaysIcon}
              label="мероприятий в базе"
              value={metrics.eventCount}
            />
            <QueueItem
              href="/participants?activationState=UNKNOWN_LEGACY"
              icon={AlertCircleIcon}
              label="профилей с неполной историей"
              value={metrics.unknownLegacy}
            />
          </CardContent>
        </Card>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <Card>
          <CardHeader>
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Последние 3 недели
              </p>
              <CardTitle className="mt-1">Артефактная активность</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {[
              { value: metrics.recentVersions, label: 'учитываемых версий' },
              { value: metrics.recentAuthors, label: 'уникальных авторов' },
              { value: metrics.notActivated, label: 'не активированы после baseline' },
            ].map((item) => (
              <div className="bg-muted/50 rounded-lg px-4 py-3" key={item.label}>
                <strong className="block text-2xl font-semibold tracking-tight tabular">
                  {item.value.toLocaleString('ru-RU')}
                </strong>
                <span className="text-muted-foreground text-xs">{item.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Распределение оценок</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-28 items-end gap-1.5">
              {metrics.scoreDistribution.map((item) => (
                <div
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                  key={item.score}
                  title={`${item.score}: ${item.count}`}
                >
                  <div
                    className="bg-primary w-full max-w-4 rounded-t-sm"
                    style={{ height: `${Math.max(4, (item.count / maxScore) * 80)}px` }}
                  />
                  <span className="text-muted-foreground text-[10px] tabular">{item.score}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </PageStack>
  );
}
