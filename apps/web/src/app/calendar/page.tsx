'use client';

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListChecksIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import { EVENT_STATUS_LABELS, EVENT_STATUS_VARIANTS } from '@/lib/status-labels';
import type { EventSummary, TaskSummary, TasksResponse } from '@/lib/types';
import { cn } from '@/lib/utils';

type CalendarEntry =
  | { kind: 'task'; date: Date; task: TaskSummary }
  | { kind: 'event'; date: Date; event: EventSummary };

function entryKey(entry: CalendarEntry): string {
  return entry.kind === 'task' ? `task-${entry.task.id}` : `event-${entry.event.id}`;
}

function isTaskOverdue(task: TaskSummary): boolean {
  if (!task.dueAt || task.status === 'DONE' || task.status === 'CANCELLED') return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

export default function CalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskResponse, eventResponse] = await Promise.all([
        api<TasksResponse>('/tasks?limit=500'),
        api<{ items: EventSummary[] }>('/events?limit=200'),
      ]);
      setTasks(taskResponse.items);
      setEvents(eventResponse.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить календарь'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo<CalendarEntry[]>(() => {
    const result: CalendarEntry[] = [];
    for (const task of tasks) {
      if (task.dueAt) result.push({ kind: 'task', date: startOfDay(new Date(task.dueAt)), task });
    }
    for (const event of events) {
      const start = event.startsAt ?? event.endsAt;
      if (start) result.push({ kind: 'event', date: startOfDay(new Date(start)), event });
    }
    return result;
  }, [events, tasks]);

  const days = useMemo(() => {
    const from = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [month]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = format(entry.date, 'yyyy-MM-dd');
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [entries]);

  const selectedEntries = entriesByDay.get(format(selected, 'yyyy-MM-dd')) ?? [];
  const overdueTasks = tasks.filter(isTaskOverdue);

  return (
    <PageStack>
      <PageHeader
        eyebrow="Сроки и расписание"
        title="Календарь"
        description="Дедлайны задач и даты мероприятий на одной сетке."
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Предыдущий месяц"
              onClick={() => setMonth((current) => addMonths(current, -1))}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="w-40 text-center text-[13px] font-medium capitalize">
              {format(month, 'LLLL yyyy', { locale: ru })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Следующий месяц"
              onClick={() => setMonth((current) => addMonths(current, 1))}
            >
              <ChevronRightIcon />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const today = new Date();
                setMonth(startOfMonth(today));
                setSelected(startOfDay(today));
              }}
            >
              Сегодня
            </Button>
          </div>
        }
      />

      {overdueTasks.length > 0 && (
        <div className="border-destructive/30 bg-destructive/8 text-destructive flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px]">
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="flex-1">
            Просрочено задач: <strong className="tabular">{overdueTasks.length}</strong>
          </span>
          <Button variant="outline" size="xs" asChild>
            <Link href="/tasks">Открыть очередь</Link>
          </Button>
        </div>
      )}

      {error ? (
        <Card>
          <EmptyState title="Ошибка загрузки" text={error} />
        </Card>
      ) : loading ? (
        <Skeleton className="h-[32rem] rounded-xl" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="overflow-hidden">
            <div className="text-muted-foreground bg-muted/50 grid grid-cols-7 border-b text-center text-[11px] font-semibold tracking-wide uppercase">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label) => (
                <div key={label} className="py-2">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const dayEntries = entriesByDay.get(format(day, 'yyyy-MM-dd')) ?? [];
                const outside = !isSameMonth(day, month);
                const active = isSameDay(day, selected);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelected(startOfDay(day))}
                    className={cn(
                      'hover:bg-accent/50 focus-visible:ring-ring/50 min-h-24 border-r border-b p-1.5 text-left transition-colors last:border-r-0 focus-visible:ring-[3px] focus-visible:outline-none',
                      outside && 'bg-muted/25 text-muted-foreground/60',
                      active && 'bg-accent/70',
                    )}
                  >
                    <span
                      className={cn(
                        'mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular',
                        isToday(day) && 'bg-primary text-primary-foreground font-semibold',
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                    <span className="space-y-0.5">
                      {dayEntries.slice(0, 3).map((entry) => (
                        <span
                          key={entryKey(entry)}
                          className={cn(
                            'block truncate rounded px-1 py-0.5 text-[11px] leading-tight',
                            entry.kind === 'event'
                              ? 'bg-primary/12 text-primary'
                              : isTaskOverdue(entry.task)
                                ? 'bg-destructive/12 text-destructive'
                                : 'bg-info/12 text-info',
                          )}
                        >
                          {entry.kind === 'event' ? entry.event.name : entry.task.title}
                        </span>
                      ))}
                      {dayEntries.length > 3 && (
                        <span className="text-muted-foreground block px-1 text-[11px]">
                          ещё {dayEntries.length - 3}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="capitalize">
                {format(selected, 'd MMMM yyyy', { locale: ru })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {selectedEntries.length === 0 ? (
                <EmptyState
                  icon={CalendarDaysIcon}
                  title="На этот день ничего нет"
                  className="py-8"
                />
              ) : (
                selectedEntries.map((entry) =>
                  entry.kind === 'event' ? (
                    <Link
                      key={entryKey(entry)}
                      href={`/events/${entry.event.id}`}
                      className="hover:bg-accent/50 block rounded-lg border p-3 transition-colors"
                    >
                      <span className="flex items-start gap-2">
                        <CalendarDaysIcon className="text-primary mt-0.5 size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <strong className="block text-[13px] leading-snug">
                            {entry.event.name}
                          </strong>
                          <span className="mt-1 flex items-center gap-1.5">
                            <Badge variant={EVENT_STATUS_VARIANTS[entry.event.status] ?? 'soft-muted'}>
                              {EVENT_STATUS_LABELS[entry.event.status] ?? entry.event.status}
                            </Badge>
                            <span className="text-muted-foreground text-xs">
                              {entry.event.participantCount} участн.
                            </span>
                          </span>
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <div key={entryKey(entry)} className="rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <ListChecksIcon
                          className={cn(
                            'mt-0.5 size-4 shrink-0',
                            isTaskOverdue(entry.task) ? 'text-destructive' : 'text-info',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] leading-snug font-medium">{entry.task.title}</p>
                          {entry.task.personId && entry.task.personName && (
                            <Link
                              href={`/participants/${entry.task.personId}`}
                              className="text-muted-foreground hover:text-foreground mt-0.5 block truncate text-xs"
                            >
                              {entry.task.personName}
                            </Link>
                          )}
                          {isTaskOverdue(entry.task) && (
                            <p className="text-destructive mt-1 text-xs font-semibold">
                              Просрочено с {formatDate(entry.task.dueAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ),
                )
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageStack>
  );
}
