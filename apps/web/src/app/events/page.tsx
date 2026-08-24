'use client';

import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileCheck2Icon,
  PlusIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CreateEventDialog } from '@/components/create-event-dialog';
import { DataToolbar, ToolbarReset, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { KanbanBoard, type KanbanColumn } from '@/components/kanban';
import { PageHeader, PageStack } from '@/components/page-header';
import { ViewSwitch, type RegistryView } from '@/components/view-switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardFooter } from '@/components/ui/card';
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
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import {
  EVENT_STATUS_LABELS,
  EVENT_STATUS_ORDER,
  EVENT_STATUS_VARIANTS,
} from '@/lib/status-labels';
import type { EventSummary } from '@/lib/types';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['q', 'status', 'period', 'participants', 'artifacts'] as const;

const COLUMN_ACCENTS: Record<string, string> = {
  PLANNED: 'text-info',
  ACTIVE: 'text-primary',
  COMPLETED: 'text-success',
  CANCELLED: 'text-destructive',
};

export default function EventsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <EventsContent />
    </Suspense>
  );
}

function EventsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useCurrentUser();
  const canWrite = can('events.write');
  const pageParameter = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParameter) && pageParameter > 0 ? pageParameter : 1;
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [data, setData] = useState<{ items: EventSummary[]; total: number }>({
    items: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<RegistryView>('table');
  const [showCreate, setShowCreate] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    // Доска показывает все статусы сразу, поэтому постраничность ей не нужна.
    params.set('limit', String(view === 'board' ? 200 : PAGE_SIZE));
    params.set('offset', String(view === 'board' ? 0 : (page - 1) * PAGE_SIZE));
    try {
      setData(await api<{ items: EventSummary[]; total: number }>(`/events?${params}`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить мероприятия'));
    } finally {
      setLoading(false);
    }
  }, [page, searchParams, view]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  function updateParams(next: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString());
    if (resetPage) params.delete('page');
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/events${params.size ? `?${params}` : ''}`);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ q: query.trim() || null });
  }

  async function changeStatus(eventId: string, status: string) {
    const event = data.items.find((candidate) => candidate.id === eventId);
    if (!event || event.status === status) return;
    const previous = data;
    setData((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === eventId ? { ...item, status } : item)),
    }));
    try {
      await api(`/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: event.version, status }),
      });
      await loadEvents();
    } catch (caught) {
      setData(previous);
      toast.error(apiErrorMessage(caught, 'Не удалось изменить статус'));
    }
  }

  const hasFilters = FILTER_KEYS.some((key) => searchParams.has(key));
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const shownFrom = data.items.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const shownTo = data.items.length === 0 ? 0 : Math.min(page * PAGE_SIZE, data.total);

  useEffect(() => {
    if (loading || error || view === 'board' || page <= totalPages) return;
    const params = new URLSearchParams(searchParams.toString());
    if (totalPages === 1) params.delete('page');
    else params.set('page', String(totalPages));
    router.replace(`/events${params.size ? `?${params}` : ''}`);
  }, [error, loading, page, router, searchParams, totalPages, view]);

  const columns: KanbanColumn[] = EVENT_STATUS_ORDER.map((status) => ({
    id: status,
    title: EVENT_STATUS_LABELS[status] ?? status,
    accentClassName: COLUMN_ACCENTS[status] ?? 'text-muted-foreground',
  }));

  function renderCard(event: EventSummary) {
    return (
      <div className="space-y-2">
        <Link
          href={`/events/${event.id}`}
          className="block text-[13px] leading-snug font-medium hover:underline"
        >
          {event.name}
        </Link>
        <p className="text-muted-foreground text-xs">
          {formatEventPeriod(event.startsAt, event.endsAt)}
        </p>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 tabular">
            <UsersIcon className="size-3.5" /> {event.participantCount}
          </span>
          <span className="inline-flex items-center gap-1 tabular">
            <FileCheck2Icon className="size-3.5" /> {event.artifactCount}
          </span>
        </div>
      </div>
    );
  }

  return (
    <PageStack>
      <PageHeader
        eyebrow="Участники и их история"
        title="Мероприятия"
        description={`${hasFilters ? 'Найдено' : 'В общей базе'} ${data.total.toLocaleString('ru-RU')} ${eventCountLabel(data.total)}`}
        actions={
          canWrite && (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon />
              Новое мероприятие
            </Button>
          )
        }
      />

      <DataToolbar>
        <form className="flex min-w-72 flex-1 gap-2" onSubmit={submitSearch}>
          <ToolbarSearch
            value={query}
            onChange={(value) => {
              setQuery(value);
              if (value === '') updateParams({ q: null });
            }}
            placeholder="Название, участник, проект или ID…"
          />
          <Button type="submit" variant="outline" size="sm">
            Найти
          </Button>
        </form>
        <ToolbarSelect
          label="Статус"
          value={searchParams.get('status') ?? ''}
          onChange={(value) => updateParams({ status: value || null })}
          options={[
            { value: '', label: 'Любой статус' },
            ...EVENT_STATUS_ORDER.map((status) => ({
              value: status,
              label: EVENT_STATUS_LABELS[status] ?? status,
            })),
            { value: 'UNKNOWN', label: 'Статус не указан' },
          ]}
        />
        <ToolbarSelect
          label="Период"
          value={searchParams.get('period') ?? ''}
          onChange={(value) => updateParams({ period: value || null })}
          options={[
            { value: '', label: 'Любой период' },
            { value: 'UPCOMING', label: 'Текущие и будущие' },
            { value: 'PAST', label: 'Прошедшие' },
            { value: 'DATED', label: 'Дата указана' },
            { value: 'UNDATED', label: 'Без даты' },
          ]}
        />
        <ToolbarSelect
          label="Артефакты"
          value={searchParams.get('artifacts') ?? ''}
          onChange={(value) => updateParams({ artifacts: value || null })}
          options={[
            { value: '', label: 'Любое число' },
            { value: 'WITH', label: 'Есть артефакты' },
            { value: 'WITHOUT', label: 'Без артефактов' },
          ]}
        />
        {hasFilters && (
          <ToolbarReset
            onClick={() => {
              setQuery('');
              router.push('/events');
            }}
          />
        )}
        <div className="ml-auto">
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </DataToolbar>

      {error ? (
        <Card>
          <EmptyState title="Ошибка загрузки" text={error} />
        </Card>
      ) : loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDaysIcon}
            title="Мероприятия не найдены"
            text={
              hasFilters
                ? 'Измените или сбросьте фильтры.'
                : 'Создайте первое мероприятие или запустите импорт исходной книги.'
            }
          />
        </Card>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={columns}
          items={data.items.filter((event) => EVENT_STATUS_ORDER.includes(event.status as never))}
          getId={(event) => event.id}
          getColumnId={(event) => event.status}
          renderCard={renderCard}
          {...(canWrite ? { onMove: changeStatus } : {})}
          emptyColumnText="Нет мероприятий"
        />
      ) : (
        <Card>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Мероприятие</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Участников</TableHead>
                  <TableHead className="text-right">Артефактов</TableHead>
                  <TableHead>
                    <span className="sr-only">Открыть</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Link href={`/events/${event.id}`} className="flex items-center gap-2.5">
                        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                          <CalendarDaysIcon className="size-4" />
                        </span>
                        <strong className="font-medium hover:underline">{event.name}</strong>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatEventPeriod(event.startsAt, event.endsAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={EVENT_STATUS_VARIANTS[event.status] ?? 'soft-muted'}>
                        {EVENT_STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular">{event.participantCount}</TableCell>
                    <TableCell className="text-right tabular">{event.artifactCount}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={`/events/${event.id}`} aria-label={`Открыть «${event.name}»`}>
                          <ArrowRightIcon />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
          <CardFooter className="justify-between">
            <span className="text-muted-foreground text-[13px]">
              Показано {shownFrom}–{shownTo} из {data.total.toLocaleString('ru-RU')}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Предыдущая страница"
                disabled={loading || page <= 1}
                onClick={() => updateParams({ page: page === 2 ? null : String(page - 1) }, false)}
              >
                <ChevronLeftIcon />
              </Button>
              <span className="text-[13px] tabular">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Следующая страница"
                disabled={loading || page >= totalPages}
                onClick={() => updateParams({ page: String(page + 1) }, false)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}

      {showCreate && (
        <CreateEventDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/events/${id}`)}
        />
      )}
    </PageStack>
  );
}

function eventCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'мероприятий';
  if (last === 1) return 'мероприятие';
  if (last >= 2 && last <= 4) return 'мероприятия';
  return 'мероприятий';
}

function formatEventPeriod(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt && !endsAt) return 'Дата не указана';
  if (startsAt && endsAt) return `${formatDate(startsAt)} — ${formatDate(endsAt)}`;
  return formatDate(startsAt ?? endsAt);
}
