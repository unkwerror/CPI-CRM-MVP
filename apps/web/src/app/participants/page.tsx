'use client';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  MailIcon,
  PhoneIcon,
  PlusIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { CreatePersonDialog } from '@/components/create-person-dialog';
import { DataToolbar, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { api, apiErrorMessage, formatDate, initials } from '@/lib/api';
import { scoreVariant } from '@/lib/status-labels';
import type { PeopleResponse } from '@/lib/types';

const SAVED_VIEWS = [
  { label: 'Все', params: '' },
  { label: 'Не активированы', params: 'activationState=NOT_ACTIVATED' },
  { label: 'Активные', params: 'activityStatus=ACTIVE' },
  { label: 'Средняя активность', params: 'activityStatus=MEDIUM' },
  { label: 'Неактивные', params: 'activityStatus=INACTIVE' },
  { label: 'Legacy неизвестен', params: 'activationState=UNKNOWN_LEGACY' },
  { label: 'Ожидают оценки', params: 'awaitingReview=true' },
];

const ACTIVITY_OPTIONS = [
  { value: 'ALL', label: 'Любая активность' },
  { value: 'ACTIVE', label: 'Активные' },
  { value: 'MEDIUM', label: 'Средняя активность' },
  { value: 'INACTIVE', label: 'Неактивные' },
  { value: 'UNKNOWN', label: 'Неизвестно' },
];

const COLUMN_COUNT = 8;

export default function ParticipantsPage() {
  return (
    <Suspense fallback={<RegistrySkeleton />}>
      <ParticipantsContent />
    </Suspense>
  );
}

function RegistrySkeleton() {
  return (
    <PageStack>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
    </PageStack>
  );
}

function ParticipantsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { can } = useCurrentUser();
  const [data, setData] = useState<PeopleResponse>({ items: [], nextCursor: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === '1');
  const [history, setHistory] = useState<string[]>([]);
  const canExport = can('exports.bulk');

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    params.set('limit', '50');
    try {
      setData(await api<PeopleResponse>(`/people?${params.toString()}`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить участников'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('cursor');
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/participants${params.size ? `?${params}` : ''}`);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ q: query.trim() || null });
  }

  const activeView = SAVED_VIEWS.find((view) => {
    const params = new URLSearchParams(view.params);
    return (
      [...params.entries()].every(([key, value]) => searchParams.get(key) === value) &&
      ['activityStatus', 'activationState', 'awaitingReview'].every(
        (key) => params.has(key) || !searchParams.has(key),
      )
    );
  });
  const exportParams = new URLSearchParams();
  for (const key of ['q', 'activityStatus', 'activationState', 'awaitingReview'] as const) {
    const value = searchParams.get(key);
    if (value) exportParams.set(key, value);
  }
  const exportHref = `/api/exports/participants.csv${exportParams.size ? `?${exportParams}` : ''}`;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Единый реестр"
        title="Участники"
        description={`${data.total.toLocaleString('ru-RU')} канонических профилей`}
        actions={
          <>
            {canExport && (
              <Button asChild variant="outline">
                <a href={exportHref}>
                  <DownloadIcon />
                  {exportParams.size ? 'Экспорт по фильтрам' : 'Экспорт всех'}
                </a>
              </Button>
            )}
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon /> Новый участник
            </Button>
          </>
        }
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Сохранённые представления">
        {SAVED_VIEWS.map((view) => {
          const active = activeView?.label === view.label;
          return (
            <Button
              aria-current={active ? 'true' : undefined}
              key={view.label}
              onClick={() => router.push(`/participants${view.params ? `?${view.params}` : ''}`)}
              size="sm"
              variant={active ? 'secondary' : 'ghost'}
            >
              {view.label}
            </Button>
          );
        })}
      </nav>

      <DataToolbar>
        <form className="flex min-w-56 flex-1" onSubmit={submitSearch}>
          <ToolbarSearch
            label="Поиск участников"
            onChange={(next) => {
              setQuery(next);
              if (!next) updateParams({ q: null });
            }}
            placeholder="Поиск по ФИО, контакту, организации…"
            value={query}
          />
        </form>
        <ToolbarSelect
          label="Активность"
          onChange={(value) => updateParams({ activityStatus: value === 'ALL' ? null : value })}
          options={ACTIVITY_OPTIONS}
          value={searchParams.get('activityStatus') ?? 'ALL'}
          width="w-52"
        />
      </DataToolbar>

      <Card>
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : data.items.length === 0 && !loading ? (
          <EmptyState
            icon={UsersIcon}
            title="Участники не найдены"
            text="Измените фильтры или запустите импорт книги."
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Участник</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Организация / факультет</TableHead>
                  <TableHead>Активность</TableHead>
                  <TableHead>Последний артефакт</TableHead>
                  <TableHead className="text-right">Артефактов</TableHead>
                  <TableHead className="text-right">Оценка</TableHead>
                  <TableHead>Ответственный</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 8 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={COLUMN_COUNT}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : data.items.map((person) => (
                      <TableRow key={person.id}>
                        <TableCell>
                          <Link
                            className="hover:text-primary flex items-center gap-2.5 transition-colors"
                            href={`/participants/${person.id}`}
                          >
                            <Avatar>
                              <AvatarFallback>{initials(person.canonicalFullName)}</AvatarFallback>
                            </Avatar>
                            <span className="leading-tight">
                              <strong className="block text-[13px] font-medium">
                                {person.canonicalFullName}
                              </strong>
                              <small className="text-muted-foreground block text-xs">
                                ID {person.id.slice(0, 8)}
                              </small>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
                            {person.primaryContact?.includes('@') ? (
                              <MailIcon className="size-3.5 shrink-0" />
                            ) : (
                              <PhoneIcon className="size-3.5 shrink-0" />
                            )}
                            {person.primaryContact ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="leading-tight">
                            <strong className="block text-[13px] font-medium">
                              {person.organization ?? '—'}
                            </strong>
                            {person.faculty && (
                              <small className="text-muted-foreground block text-xs">
                                {person.faculty}
                              </small>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            activity={person.activityStatus}
                            activation={person.activationState}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[13px] whitespace-nowrap">
                          {formatDate(person.lastArtifactAt)}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {person.countableArtifactCount}
                        </TableCell>
                        <TableCell className="text-right">
                          {person.latestArtifactScore == null ? (
                            <span className="text-muted-foreground text-[13px]">Не оценён</span>
                          ) : (
                            <Badge
                              className="tabular min-w-8 justify-center"
                              variant={scoreVariant(person.latestArtifactScore)}
                            >
                              {person.latestArtifactScore}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[13px]">
                          {person.ownerName ?? (
                            <span className="text-muted-foreground">Не назначен</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}

        <CardFooter className="justify-between">
          <span className="text-muted-foreground text-[13px]">
            Показано {data.items.length} из {data.total.toLocaleString('ru-RU')}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              aria-label="Предыдущая страница"
              disabled={history.length === 0}
              onClick={() => {
                const previous = history.at(-1) ?? null;
                setHistory((items) => items.slice(0, -1));
                updateParams({ cursor: previous });
              }}
              size="icon-sm"
              variant="outline"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              aria-label="Следующая страница"
              disabled={!data.nextCursor}
              onClick={() => {
                setHistory((items) => [...items, searchParams.get('cursor') ?? '']);
                updateParams({ cursor: data.nextCursor });
              }}
              size="icon-sm"
              variant="outline"
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </CardFooter>
      </Card>

      <CreatePersonDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(id) => router.push(`/participants/${id}`)}
      />
    </PageStack>
  );
}
