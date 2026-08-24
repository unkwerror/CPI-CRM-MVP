'use client';

import { CheckIcon, ListChecksIcon, PaperclipIcon, PlusIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataToolbar, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { KanbanBoard, type KanbanColumn } from '@/components/kanban';
import { PageHeader, PageStack } from '@/components/page-header';
import { TaskDialog } from '@/components/task-dialog';
import { ViewSwitch, type RegistryView } from '@/components/view-switch';
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
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER, TASK_STATUS_VARIANTS } from '@/lib/status-labels';
import type { TaskStatus, TaskSummary, TasksResponse } from '@/lib/types';
import { cn } from '@/lib/utils';

const COLUMN_ACCENTS: Record<TaskStatus, string> = {
  OPEN: 'text-info',
  IN_PROGRESS: 'text-warning',
  DONE: 'text-success',
  CANCELLED: 'text-muted-foreground',
};

function isOverdue(task: TaskSummary): boolean {
  if (!task.dueAt || task.status === 'DONE' || task.status === 'CANCELLED') return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

export default function TasksPage() {
  const { can } = useCurrentUser();
  const canManage = can('tasks.manage');
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<RegistryView>('board');
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('me');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '300' });
    if (assignee === 'me') params.set('assignee', 'me');
    try {
      const response = await api<TasksResponse>(`/tasks?${params}`);
      setTasks(response.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить задачи'));
    } finally {
      setLoading(false);
    }
  }, [assignee]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(needle) ||
        (task.personName ?? '').toLowerCase().includes(needle),
    );
  }, [search, tasks]);

  const overdueCount = filtered.filter(isOverdue).length;

  const columns: KanbanColumn[] = TASK_STATUS_ORDER.map((status) => ({
    id: status,
    title: TASK_STATUS_LABELS[status],
    accentClassName: COLUMN_ACCENTS[status],
  }));

  async function moveTask(taskId: string, status: string) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const previous = tasks;
    setTasks((current) =>
      current.map((item) =>
        item.id === taskId ? { ...item, status: status as TaskStatus } : item,
      ),
    );
    try {
      await api(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: task.version ?? 1, status }),
      });
      await load();
    } catch (caught) {
      setTasks(previous);
      toast.error(apiErrorMessage(caught, 'Не удалось перенести задачу'));
    }
  }

  function openEditor(task: TaskSummary | null) {
    setEditing(task);
    setDialogOpen(true);
  }

  function renderCard(task: TaskSummary) {
    const overdue = isOverdue(task);
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left text-[13px] leading-snug font-medium hover:underline"
            onClick={() => canManage && openEditor(task)}
            disabled={!canManage}
          >
            {task.title}
          </button>
          {task.isNextStep && (
            <StarIcon
              className="text-warning mt-0.5 size-3.5 shrink-0"
              aria-label="Следующий шаг"
            />
          )}
        </div>
        {task.personId && task.personName && (
          <Link
            href={`/participants/${task.personId}`}
            className="text-muted-foreground hover:text-foreground block truncate text-xs"
          >
            {task.personName}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {task.dueAt && (
            <span
              className={cn(
                'text-xs tabular',
                overdue ? 'text-destructive font-semibold' : 'text-muted-foreground',
              )}
            >
              {overdue ? 'Просрочено ' : 'До '}
              {formatDate(task.dueAt)}
            </span>
          )}
          {task.assigneeName && (
            <Badge variant="soft-muted" className="ml-auto">
              {task.assigneeName}
            </Badge>
          )}
          {(task.attachments?.length ?? 0) > 0 && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <PaperclipIcon className="size-3" /> {task.attachments!.length}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <PageStack>
      <PageHeader
        eyebrow="Рабочая очередь"
        title="Задачи"
        description={
          overdueCount > 0
            ? `${filtered.length} задач, из них просрочено ${overdueCount}`
            : `${filtered.length} задач, просрочек нет`
        }
        actions={
          canManage && (
            <Button onClick={() => openEditor(null)}>
              <PlusIcon />
              Новая задача
            </Button>
          )
        }
      />

      <DataToolbar>
        <ToolbarSearch
          value={search}
          onChange={setSearch}
          placeholder="Поиск по задаче или участнику…"
        />
        <ToolbarSelect
          label="Исполнитель"
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: 'me', label: 'Мои задачи' },
            { value: 'all', label: 'Все задачи' },
          ]}
        />
        <div className="ml-auto">
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </DataToolbar>

      {error ? (
        <Card>
          <EmptyState title="Ошибка загрузки" text={error} />
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecksIcon}
            title="Задач нет"
            text="Заведите задачу по участнику, чтобы она попала в рабочую очередь."
            action={
              canManage && (
                <Button onClick={() => openEditor(null)}>
                  <PlusIcon />
                  Новая задача
                </Button>
              )
            }
          />
        </Card>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={columns}
          items={filtered}
          getId={(task) => task.id}
          getColumnId={(task) => task.status}
          renderCard={renderCard}
          {...(canManage ? { onMove: moveTask } : {})}
          emptyColumnText="Нет задач"
        />
      ) : (
        <Card>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Задача</TableHead>
                  <TableHead>Участник</TableHead>
                  <TableHead>Срок</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Исполнитель</TableHead>
                  {canManage && (
                    <TableHead>
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="max-w-96">
                      <span className="flex items-center gap-1.5">
                        {task.isNextStep && <StarIcon className="text-warning size-3.5 shrink-0" />}
                        <span className="truncate font-medium">{task.title}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {task.personId && task.personName ? (
                        <Link
                          href={`/participants/${task.personId}`}
                          className="text-primary hover:underline"
                        >
                          {task.personName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell
                      className={cn('tabular', isOverdue(task) && 'text-destructive font-semibold')}
                    >
                      {task.dueAt ? formatDate(task.dueAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
                        {TASK_STATUS_LABELS[task.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {task.assigneeName ?? '—'}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {task.status !== 'DONE' && task.status !== 'CANCELLED' && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => void moveTask(task.id, 'DONE')}
                            >
                              <CheckIcon />
                              Готово
                            </Button>
                          )}
                          <Button variant="ghost" size="xs" onClick={() => openEditor(task)}>
                            Открыть
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </Card>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        onSaved={() => void load()}
      />
    </PageStack>
  );
}
