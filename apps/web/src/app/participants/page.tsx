'use client';

import { ChevronLeft, ChevronRight, Download, Mail, Phone, Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { api, formatDate, initials } from '@/lib/api';
import type { CurrentUser, PeopleResponse } from '@/lib/types';

const savedViews = [
  { label: 'Все', params: '' },
  { label: 'Не активированы', params: 'activationState=NOT_ACTIVATED' },
  { label: 'Активные', params: 'activityStatus=ACTIVE' },
  { label: 'Средняя активность', params: 'activityStatus=MEDIUM' },
  { label: 'Неактивные', params: 'activityStatus=INACTIVE' },
  { label: 'Legacy неизвестен', params: 'activationState=UNKNOWN_LEGACY' },
  { label: 'Ожидают оценки', params: 'awaitingReview=true' },
];

export default function ParticipantsPage() {
  return (
    <Suspense fallback={<div className="page-loading">Загружаем реестр…</div>}>
      <ParticipantsContent />
    </Suspense>
  );
}

function ParticipantsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<PeopleResponse>({ items: [], nextCursor: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === '1');
  const [history, setHistory] = useState<string[]>([]);
  const [canExport, setCanExport] = useState(false);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    params.set('limit', '50');
    try {
      setData(await api<PeopleResponse>(`/people?${params.toString()}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить участников');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanExport(user.permissions.includes('exports.bulk')))
      .catch(() => setCanExport(false));
  }, []);

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

  const activeView = savedViews.find((view) => {
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
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Единый реестр</p>
          <h1>Участники</h1>
          <p>{data.total.toLocaleString('ru-RU')} канонических профилей</p>
        </div>
        <div className="heading-actions">
          {canExport && (
            <a className="button button--secondary" href={exportHref}>
              <Download size={16} />
              {exportParams.size ? 'Экспорт по фильтрам' : 'Экспорт всех'}
            </a>
          )}
          <button className="button button--primary" onClick={() => setShowCreate(true)}>
            <Plus size={17} /> Новый участник
          </button>
        </div>
      </section>

      <section className="view-tabs" aria-label="Сохранённые представления">
        {savedViews.map((view) => (
          <button
            className={activeView?.label === view.label ? 'view-tab view-tab--active' : 'view-tab'}
            key={view.label}
            onClick={() => router.push(`/participants${view.params ? `?${view.params}` : ''}`)}
          >
            {view.label}
          </button>
        ))}
      </section>

      <section className="registry-toolbar">
        <form className="registry-search" onSubmit={submitSearch}>
          <Search size={18} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по ФИО, контакту, организации…"
            value={query}
          />
          {query && (
            <button
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
          aria-label="Статус активности"
          className="select-control"
          onChange={(event) => updateParams({ activityStatus: event.target.value || null })}
          value={searchParams.get('activityStatus') ?? ''}
        >
          <option value="">Любая активность</option>
          <option value="ACTIVE">Активные</option>
          <option value="MEDIUM">Средняя активность</option>
          <option value="INACTIVE">Неактивные</option>
          <option value="UNKNOWN">Неизвестно</option>
        </select>
      </section>

      <section className="table-panel">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : data.items.length === 0 && !loading ? (
          <EmptyState
            title="Участники не найдены"
            text="Измените фильтры или запустите импорт книги."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table people-table">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Контакт</th>
                  <th>Организация / факультет</th>
                  <th>Активность</th>
                  <th>Последний артефакт</th>
                  <th className="number-cell">Артефактов</th>
                  <th className="number-cell">Оценка</th>
                  <th>Ответственный</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }, (_, index) => (
                      <tr className="skeleton-row" key={index}>
                        <td colSpan={8}>
                          <span />
                        </td>
                      </tr>
                    ))
                  : data.items.map((person) => (
                      <tr key={person.id}>
                        <td>
                          <Link className="person-cell" href={`/participants/${person.id}`}>
                            <span className="avatar">{initials(person.canonicalFullName)}</span>
                            <span>
                              <strong>{person.canonicalFullName}</strong>
                              <small>ID {person.id.slice(0, 8)}</small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="contact-cell">
                            {person.primaryContact?.includes('@') ? (
                              <Mail size={14} />
                            ) : (
                              <Phone size={14} />
                            )}
                            {person.primaryContact ?? '—'}
                          </span>
                        </td>
                        <td>
                          <span className="stacked-cell">
                            <strong>{person.organization ?? '—'}</strong>
                            <small>{person.faculty ?? ''}</small>
                          </span>
                        </td>
                        <td>
                          <StatusBadge
                            activity={person.activityStatus}
                            activation={person.activationState}
                          />
                        </td>
                        <td>{formatDate(person.lastArtifactAt)}</td>
                        <td className="number-cell">{person.countableArtifactCount}</td>
                        <td className="number-cell">
                          {person.latestArtifactScore == null ? (
                            <span className="muted">Не оценён</span>
                          ) : (
                            <span className="score-chip">{person.latestArtifactScore}</span>
                          )}
                        </td>
                        <td>{person.ownerName ?? 'Не назначен'}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="table-footer">
          <span>
            Показано {data.items.length} из {data.total.toLocaleString('ru-RU')}
          </span>
          <div className="pagination">
            <button
              className="icon-button icon-button--bordered"
              disabled={history.length === 0}
              onClick={() => {
                const previous = history.at(-1) ?? null;
                setHistory((items) => items.slice(0, -1));
                updateParams({ cursor: previous });
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-button icon-button--bordered"
              disabled={!data.nextCursor}
              onClick={() => {
                setHistory((items) => [...items, searchParams.get('cursor') ?? '']);
                updateParams({ cursor: data.nextCursor });
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      </section>

      {showCreate && (
        <CreatePersonDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/participants/${id}`)}
        />
      )}
    </div>
  );
}

function CreatePersonDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [contactType, setContactType] = useState<'PHONE' | 'EMAIL' | 'TELEGRAM'>('PHONE');
  const [contact, setContact] = useState('');
  const [organization, setOrganization] = useState('');
  const [faculty, setFaculty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ id: string }>('/people', {
        method: 'POST',
        body: JSON.stringify({
          canonicalFullName: name,
          lifecycleDataState: 'COMPLETE',
          contacts: contact ? [{ type: contactType, value: contact, isPrimary: true }] : [],
          organization: organization || undefined,
          faculty: faculty || undefined,
        }),
      });
      onCreated(result.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить участника');
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Новая карточка</p>
            <h2 id="create-title">Добавить участника</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>ФИО *</span>
              <input
                autoFocus
                required
                minLength={2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Иванов Иван Иванович"
              />
            </label>
            <label className="form-field">
              <span>Тип контакта</span>
              <select
                value={contactType}
                onChange={(event) => setContactType(event.target.value as typeof contactType)}
              >
                <option value="PHONE">Телефон</option>
                <option value="EMAIL">Email</option>
                <option value="TELEGRAM">Telegram</option>
              </select>
            </label>
            <label className="form-field">
              <span>Контакт</span>
              <input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="+7 999 123-45-67"
              />
            </label>
            <label className="form-field">
              <span>Организация</span>
              <input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="НГУ"
              />
            </label>
            <label className="form-field">
              <span>Факультет</span>
              <input
                value={faculty}
                onChange={(event) => setFaculty(event.target.value)}
                placeholder="ФИТ"
              />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <footer className="dialog__footer">
            <button className="button button--secondary" type="button" onClick={onClose}>
              Отмена
            </button>
            <button className="button button--primary" disabled={saving}>
              {saving ? 'Сохраняем…' : 'Создать карточку'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
