'use client';

import { ArrowRight, Handshake, Plus, RotateCcw, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ApiError, api, formatDate, formatMoney } from '@/lib/api';
import { PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS } from '@/lib/fpf-labels';
import type { CurrentUser, PartnerKind, PartnerStatus, PartnerSummary } from '@/lib/types';

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="page-loading">Загружаем партнёров…</div>}>
      <PartnersContent />
    </Suspense>
  );
}

function PartnersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [items, setItems] = useState<PartnerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const key of ['q', 'status', 'kind'] as const) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    try {
      const response = await api<{ items: PartnerSummary[] }>(`/partners?${params}`);
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить партнёров');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanWrite(user.permissions.includes('partners.write')))
      .catch(() => setCanWrite(false));
  }, []);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/partners${params.size ? `?${params}` : ''}`);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ q: query.trim() || null });
  }

  const hasFilters = ['q', 'status', 'kind'].some((key) => searchParams.has(key));

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">База партнёров: ЮЛ, ЛПР и соглашения</p>
          <h1>Партнёры</h1>
          <p>
            Учитываются активные соглашения с взаимодействиями — развитие отношений отделено от
            продаж.
          </p>
        </div>
        {canWrite && (
          <div className="heading-actions">
            <button className="button button--primary" onClick={() => setShowCreate(true)}>
              <Plus size={17} /> Новый партнёр
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
            aria-label="Поиск партнёра"
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
          aria-label="Статус партнёра"
          className="select-control"
          value={searchParams.get('status') ?? ''}
          onChange={(event) => updateParams({ status: event.target.value || null })}
        >
          <option value="">Любой статус</option>
          {Object.entries(PARTNER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Тип партнёра"
          className="select-control"
          value={searchParams.get('kind') ?? ''}
          onChange={(event) => updateParams({ kind: event.target.value || null })}
        >
          <option value="">Любой тип</option>
          {Object.entries(PARTNER_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="button button--secondary registry-filter-reset"
            type="button"
            onClick={() => {
              setQuery('');
              router.push('/partners');
            }}
          >
            <RotateCcw size={15} /> Сбросить
          </button>
        )}
        <span className="registry-result-count">Найдено: {items.length}</span>
      </section>

      <section className="table-panel">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            title="Партнёры не найдены"
            text={
              hasFilters
                ? 'Измените или сбросьте фильтры.'
                : 'Заведите первого партнёра: ЮЛ, его ЛПР и историю взаимодействий.'
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Партнёр</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th className="number-cell">ЛПР</th>
                  <th className="number-cell">Активные соглашения</th>
                  <th>Последнее взаимодействие</th>
                  <th className="number-cell">Выручка</th>
                  <th>
                    <span className="sr-only">Открыть</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }, (_, index) => (
                      <tr className="skeleton-row" key={index}>
                        <td colSpan={8}>
                          <span />
                        </td>
                      </tr>
                    ))
                  : items.map((partner) => (
                      <tr key={partner.id}>
                        <td>
                          <Link className="event-name-cell" href={`/partners/${partner.id}`}>
                            <span className="table-file-icon">
                              <Handshake size={16} />
                            </span>
                            <strong>{partner.name}</strong>
                          </Link>
                        </td>
                        <td>{PARTNER_KIND_LABELS[partner.kind]}</td>
                        <td>
                          <span className="event-status">
                            {PARTNER_STATUS_LABELS[partner.status]}
                          </span>
                        </td>
                        <td className="number-cell">{partner.contactCount}</td>
                        <td className="number-cell">{partner.activeAgreements}</td>
                        <td>
                          {partner.lastInteractionAt
                            ? formatDate(partner.lastInteractionAt, true)
                            : 'Не было'}
                        </td>
                        <td className="number-cell">{formatMoney(partner.wonAmount)}</td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={`Открыть «${partner.name}»`}
                            href={`/partners/${partner.id}`}
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
      </section>

      {showCreate && (
        <CreatePartnerDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/partners/${id}`)}
        />
      )}
    </div>
  );
}

function CreatePartnerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PartnerKind>('COMMERCIAL');
  const [status, setStatus] = useState<PartnerStatus>('PROSPECT');
  const [inn, setInn] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api<{ id: string }>('/partners', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          kind,
          status,
          ...(inn.trim() ? { inn: inn.trim() } : {}),
          ...(website.trim() ? { website: website.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      onCreated(result.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось создать партнёра',
      );
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section
        aria-labelledby="create-partner-title"
        aria-modal="true"
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Новый партнёр</p>
            <h2 id="create-partner-title">Добавить партнёра</h2>
          </div>
          <button
            aria-label="Закрыть"
            className="icon-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>Название организации *</span>
              <input
                autoFocus
                maxLength={500}
                minLength={2}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Фонд содействия инновациям"
                required
                value={name}
              />
            </label>
            <label className="form-field">
              <span>Тип</span>
              <select onChange={(event) => setKind(event.target.value as PartnerKind)} value={kind}>
                {Object.entries(PARTNER_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Статус</span>
              <select
                onChange={(event) => setStatus(event.target.value as PartnerStatus)}
                value={status}
              >
                {Object.entries(PARTNER_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>ИНН</span>
              <input maxLength={20} onChange={(event) => setInn(event.target.value)} value={inn} />
            </label>
            <label className="form-field">
              <span>Сайт</span>
              <input
                maxLength={1000}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://…"
                value={website}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Заметки</span>
              <textarea
                maxLength={10_000}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                value={notes}
              />
            </label>
          </div>
          {error && (
            <p aria-live="polite" className="form-error">
              {error}
            </p>
          )}
          <footer className="dialog__footer">
            <button
              className="button button--secondary"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Отмена
            </button>
            <button
              className="button button--primary"
              disabled={saving || name.trim().length < 2}
              type="submit"
            >
              {saving ? 'Создаём…' : 'Создать партнёра'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
