'use client';

import {
  ArrowRightIcon,
  CalendarDaysIcon,
  FileCheck2Icon,
  FolderKanbanIcon,
  PlusIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { DataToolbar, ToolbarReset, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  ProjectDialog,
} from '@/components/project-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import type { ProjectSummary } from '@/lib/types';

const ALL = 'ALL';

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <ProjectsContent />
    </Suspense>
  );
}

function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useCurrentUser();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [data, setData] = useState<{ items: ProjectSummary[]; total: number }>({
    items: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '200' });
    const q = searchParams.get('q');
    const status = searchParams.get('status');
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    try {
      setData(await api<{ items: ProjectSummary[]; total: number }>(`/projects?${params}`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить проекты'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => void load(), [load]);
  useEffect(() => setQuery(searchParams.get('q') ?? ''), [searchParams]);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/projects${params.size ? `?${params}` : ''}`);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ q: query.trim() || null });
  }

  const hasFilters = searchParams.has('q') || searchParams.has('status');
  return (
    <PageStack>
      <PageHeader
        eyebrow="Команды, результаты и участие в программах"
        title="Проекты"
        description={`${data.total.toLocaleString('ru-RU')} проектов в общей базе`}
        actions={
          can('people.write') && (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon /> Новый проект
            </Button>
          )
        }
      />

      <DataToolbar>
        <form className="min-w-56 flex-1" onSubmit={submitSearch}>
          <ToolbarSearch
            label="Поиск проекта"
            onChange={(value) => {
              setQuery(value);
              if (!value && searchParams.has('q')) updateParams({ q: null });
            }}
            placeholder="Название или описание…"
            value={query}
          />
        </form>
        <ToolbarSelect
          label="Статус"
          onChange={(value) => updateParams({ status: value === ALL ? null : value })}
          options={[
            { value: ALL, label: 'Любой статус' },
            ...PROJECT_STATUS_ORDER.map((value) => ({
              value,
              label: PROJECT_STATUS_LABELS[value] ?? value,
            })),
          ]}
          value={searchParams.get('status') ?? ALL}
        />
        {hasFilters && (
          <ToolbarReset
            onClick={() => {
              setQuery('');
              router.push('/projects');
            }}
          />
        )}
      </DataToolbar>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && data.items.length === 0 ? (
          <EmptyState
            icon={FolderKanbanIcon}
            title="Проекты не найдены"
            text={hasFilters ? 'Измените фильтры.' : 'Создайте первый проект и добавьте команду.'}
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Проект</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead className="text-right">Участники</TableHead>
                  <TableHead className="text-right">Артефакты</TableHead>
                  <TableHead className="text-right">Мероприятия</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Открыть</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={7}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : data.items.map((project) => (
                      <TableRow key={project.id}>
                        <TableCell>
                          <Link
                            className="group flex items-start gap-2.5"
                            href={`/projects/${project.id}`}
                          >
                            <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                              <FolderKanbanIcon className="size-4" />
                            </span>
                            <span className="min-w-0">
                              <strong className="block font-medium group-hover:underline">
                                {project.name}
                              </strong>
                              {project.description && (
                                <small className="text-muted-foreground line-clamp-1 block max-w-xl">
                                  {project.description}
                                </small>
                              )}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={project.status === 'ACTIVE' ? 'soft-success' : 'soft-muted'}
                          >
                            {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {project.startsAt ? formatDate(project.startsAt) : 'Без даты'}
                          {project.endsAt ? ` — ${formatDate(project.endsAt)}` : ''}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          <span className="inline-flex items-center gap-1">
                            <UsersIcon className="size-3.5" />
                            {project.memberCount}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          <span className="inline-flex items-center gap-1">
                            <FileCheck2Icon className="size-3.5" />
                            {project.artifactCount}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDaysIcon className="size-3.5" />
                            {project.eventCount}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button asChild size="icon-sm" variant="ghost">
                            <Link
                              aria-label={`Открыть ${project.name}`}
                              href={`/projects/${project.id}`}
                            >
                              <ArrowRightIcon />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {showCreate && (
        <ProjectDialog
          onClose={() => setShowCreate(false)}
          onSaved={(id) => router.push(`/projects/${id}`)}
        />
      )}
    </PageStack>
  );
}
