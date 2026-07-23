'use client';

import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Plus,
  RotateCcw,
  Search,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { CreateEventDialog } from '@/components/create-event-dialog';
import { api, formatDate } from '@/lib/api';
import type { CurrentUser, EventSummary } from '@/lib/types';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['q', 'status', 'period', 'participants', 'artifacts'] as const;

export default function EventsPage() {
  return (
    <Suspense fallback={<div className="page-loading">Загружаем мероприятия…</div>}>
      <EventsContent />
    </Suspense>
  );
}

function EventsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [canCreate, setCanCreate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    try {
      setData(await api<{ items: EventSummary[]; total: number }>(`/events?${params}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить мероприятия');
    } finally {
      setLoading(false);
    }
  }, [page, searchParams]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanCreate(user.permissions.includes('events.write')))
      .catch(() => setCanCreate(false));
  }, []);

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

  const hasFilters = FILTER_KEYS.some((key) => searchParams.has(key));
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const shownFrom = data.items.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const shownTo = data.items.length === 0 ? 0 : Math.min(page * PAGE_SIZE, data.total);

  useEffect(() => {
    if (loading || error || page <= totalPages) return;
    const params = new URLSearchParams(searchParams.toString());
    if (totalPages === 1) params.delete('page');
    else params.set('page', String(totalPages));
    router.replace(`/events${params.size ? `?${params}` : ''}`);
  }, [error, loading, page, router, searchParams, totalPages]);

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Участники и их история</p>
          <h1>Мероприятия</h1>
          <p>
            {hasFilters ? 'Найдено' : 'В общей базе'} {data.total.toLocaleString('ru-RU')}{' '}
            {eventCountLabel(data.total)}
          </p>
        </div>
        {canCreate && (
          <div className="heading-actions">
            <button className="button button--primary" onClick={() => setShowCreate(true)}>
              <Plus size={17} /> Новое мероприятие
            </button>
          </div>
        )}
      </section>

      <section className="registry-toolbar registry-toolbar--filters">
        <form className="registry-search" onSubmit={submitSearch}>
          <button aria-label="Найти" type="submit">
            <Search size={18} />
          </button>
          <input
            aria-label="Поиск мероприятия"
            placeholder="Поиск по названию…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              aria-label="Очистить поиск"
              type="button"
              onClick={() => {
                setQuery('');
                updateParams({ q: null });
              }}
            >
              <X size={15} />
            </button>
          )}
        </form>
        <select
          aria-label="Статус мероприятия"
          className="select-control"
          value={searchParams.get('status') ?? ''}
          onChange={(event) => updateParams({ status: event.target.value || null })}
        >
          <option value="">Любой статус</option>
          <option value="PLANNED">Запланировано</option>
          <option value="ACTIVE">Идёт</option>
          <option value="COMPLETED">Завершено</option>
          <option value="CANCELLED">Отменено</option>
          <option value="UNKNOWN">Статус не указан</option>
        </select>
        <select
          aria-label="Период мероприятия"
          className="select-control"
          value={searchParams.get('period') ?? ''}
          onChange={(event) => updateParams({ period: event.target.value || null })}
        >
          <option value="">Любой период</option>
          <option value="UPCOMING">Текущие и будущие</option>
          <option value="PAST">Прошедшие</option>
          <option value="DATED">Дата указана</option>
          <option value="UNDATED">Без даты</option>
        </select>
        <select
          aria-label="Наличие участников"
          className="select-control"
          value={searchParams.get('participants') ?? ''}
          onChange={(event) => updateParams({ participants: event.target.value || null })}
        >
          <option value="">Любое число участников</option>
          <option value="WITH">Есть участники</option>
          <option value="WITHOUT">Без участников</option>
        </select>
        <select
          aria-label="Наличие артефактов"
          className="select-control"
          value={searchParams.get('artifacts') ?? ''}
          onChange={(event) => updateParams({ artifacts: event.target.value || null })}
        >
          <option value="">Любое число артефактов</option>
          <option value="WITH">Есть артефакты</option>
          <option value="WITHOUT">Без артефактов</option>
        </select>
        {hasFilters && (
          <button
            className="button button--secondary registry-filter-reset"
            type="button"
            onClick={() => {
              setQuery('');
              router.push('/events');
            }}
          >
            <RotateCcw size={15} /> Сбросить
          </button>
        )}
        <span className="registry-result-count">Найдено: {data.total.toLocaleString('ru-RU')}</span>
      </section>

      <section className="table-panel">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && data.items.length === 0 ? (
          <EmptyState
            title="Мероприятия не найдены"
            text={
              hasFilters
                ? 'Измените или сбросьте фильтры.'
                : 'Создайте первое мероприятие или запустите импорт исходной книги.'
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table events-table">
              <thead>
                <tr>
                  <th>Мероприятие</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th className="number-cell">Участников</th>
                  <th className="number-cell">Артефактов</th>
                  <th>
                    <span className="sr-only">Открыть</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }, (_, index) => (
                      <tr className="skeleton-row" key={index}>
                        <td colSpan={6}>
                          <span />
                        </td>
                      </tr>
                    ))
                  : data.items.map((event) => (
                      <tr key={event.id}>
                        <td>
                          <Link className="event-name-cell" href={`/events/${event.id}`}>
                            <span className="table-file-icon">
                              <CalendarDays size={16} />
                            </span>
                            <strong>{event.name}</strong>
                          </Link>
                        </td>
                        <td>{formatEventPeriod(event.startsAt, event.endsAt)}</td>
                        <td>
                          <span className="event-status">{eventStatusLabel(event.status)}</span>
                        </td>
                        <td className="number-cell">
                          <span className="inline-count">
                            <Users size={14} /> {event.participantCount}
                          </span>
                        </td>
                        <td className="number-cell">
                          <span className="inline-count">
                            <FileCheck2 size={14} /> {event.artifactCount}
                          </span>
                        </td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={`Открыть «${event.name}»`}
                            href={`/events/${event.id}`}
                          >
                            <ArrowRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="table-footer">
          <span>
            Показано {shownFrom}–{shownTo} из {data.total.toLocaleString('ru-RU')}
          </span>
          <div className="pagination">
            <button
              aria-label="Предыдущая страница"
              className="icon-button icon-button--bordered"
              disabled={loading || page <= 1}
              onClick={() => updateParams({ page: page === 2 ? null : String(page - 1) }, false)}
            >
              <ChevronLeft size={17} />
            </button>
            <span className="pagination__label">
              {page} / {totalPages}
            </span>
            <button
              aria-label="Следующая страница"
              className="icon-button icon-button--bordered"
              disabled={loading || page >= totalPages}
              onClick={() => updateParams({ page: String(page + 1) }, false)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      </section>

      {showCreate && (
        <CreateEventDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/events/${id}`)}
        />
      )}
    </div>
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

function eventStatusLabel(status: string): string {
  return (
    {
      UNKNOWN: 'Не указан',
      PLANNED: 'Запланировано',
      ACTIVE: 'Идёт',
      COMPLETED: 'Завершено',
      CANCELLED: 'Отменено',
    }[status] ?? status
  );
}
