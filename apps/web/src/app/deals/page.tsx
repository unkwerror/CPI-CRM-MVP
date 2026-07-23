'use client';

import { HandCoins, Plus, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ApiError, api, formatDate, formatMoney } from '@/lib/api';
import { DEAL_STATUS_LABELS, DEAL_TYPE_LABELS } from '@/lib/fpf-labels';
import type {
  CurrentUser,
  DealStatus,
  DealSummary,
  DealType,
  PartnerSummary,
  ProductSummary,
} from '@/lib/types';

export default function DealsPage() {
  return (
    <Suspense fallback={<div className="page-loading">Загружаем сделки…</div>}>
      <DealsContent />
    </Suspense>
  );
}

function DealsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const key of ['status', 'dealType'] as const) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    try {
      const response = await api<{ items: DealSummary[] }>(`/deals?${params}`);
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить сделки');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanWrite(user.permissions.includes('deals.write')))
      .catch(() => setCanWrite(false));
  }, []);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/deals${params.size ? `?${params}` : ''}`);
  }

  async function changeStatus(deal: DealSummary, status: DealStatus) {
    try {
      await api(`/deals/${deal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: deal.version, status }),
      });
      await loadDeals();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить статус');
    }
  }

  const hasFilters = ['status', 'dealType'].some((key) => searchParams.has(key));
  const wonAmount = items
    .filter((deal) => deal.status === 'WON')
    .reduce((sum, deal) => sum + deal.amount, 0);
  const openAmount = items
    .filter((deal) => deal.status === 'LEAD' || deal.status === 'NEGOTIATION')
    .reduce((sum, deal) => sum + deal.amount, 0);

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Обеспечение выручки: гранты и коммерция</p>
          <h1>Продажи</h1>
          <p>
            Выиграно {formatMoney(wonAmount)} · в работе {formatMoney(openAmount)}
          </p>
        </div>
        {canWrite && (
          <div className="heading-actions">
            <button className="button button--primary" onClick={() => setShowCreate(true)}>
              <Plus size={17} /> Новая сделка
            </button>
          </div>
        )}
      </section>

      <section className="registry-toolbar registry-toolbar--filters">
        <select
          aria-label="Статус сделки"
          className="select-control"
          value={searchParams.get('status') ?? ''}
          onChange={(event) => updateParams({ status: event.target.value || null })}
        >
          <option value="">Любой статус</option>
          {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Тип сделки"
          className="select-control"
          value={searchParams.get('dealType') ?? ''}
          onChange={(event) => updateParams({ dealType: event.target.value || null })}
        >
          <option value="">Гранты и коммерция</option>
          {Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="button button--secondary registry-filter-reset"
            type="button"
            onClick={() => router.push('/deals')}
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
            title="Сделок нет"
            text="Заведите первую сделку: продажу «голов», проекта или продукта."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Сделка</th>
                  <th>Тип</th>
                  <th>Партнёр</th>
                  <th className="number-cell">Сумма</th>
                  <th>Статус</th>
                  <th>Закрыта</th>
                  {canWrite && (
                    <th>
                      <span className="sr-only">Действия</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }, (_, index) => (
                      <tr className="skeleton-row" key={index}>
                        <td colSpan={canWrite ? 7 : 6}>
                          <span />
                        </td>
                      </tr>
                    ))
                  : items.map((deal) => (
                      <tr key={deal.id}>
                        <td>
                          <span className="event-name-cell">
                            <span className="table-file-icon">
                              <HandCoins size={16} />
                            </span>
                            <span>
                              <strong>{deal.title}</strong>
                              {deal.productName && (
                                <small style={{ display: 'block' }}>{deal.productName}</small>
                              )}
                            </span>
                          </span>
                        </td>
                        <td>{DEAL_TYPE_LABELS[deal.dealType]}</td>
                        <td>
                          {deal.partnerId ? (
                            <Link className="text-link" href={`/partners/${deal.partnerId}`}>
                              {deal.partnerName}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="number-cell">{formatMoney(deal.amount, deal.currency)}</td>
                        <td>
                          <span className="event-status">{DEAL_STATUS_LABELS[deal.status]}</span>
                        </td>
                        <td>{deal.closedAt ? formatDate(deal.closedAt) : '—'}</td>
                        {canWrite && (
                          <td>
                            <select
                              aria-label={`Статус «${deal.title}»`}
                              className="select-control"
                              value={deal.status}
                              onChange={(event) =>
                                void changeStatus(deal, event.target.value as DealStatus)
                              }
                            >
                              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                        )}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && (
        <CreateDealDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void loadDeals();
          }}
        />
      )}
    </div>
  );
}

function CreateDealDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [dealType, setDealType] = useState<DealType>('COMMERCIAL');
  const [amount, setAmount] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [productId, setProductId] = useState('');
  const [expectedCloseAt, setExpectedCloseAt] = useState('');
  const [comment, setComment] = useState('');
  const [partners, setPartners] = useState<PartnerSummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  useEffect(() => {
    void api<{ items: PartnerSummary[] }>('/partners')
      .then((response) => setPartners(response.items))
      .catch(() => setPartners([]));
    void api<{ items: ProductSummary[] }>('/products')
      .then((response) => setProducts(response.items))
      .catch(() => setProducts([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api('/deals', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          dealType,
          amount: Number(amount || 0),
          ...(partnerId ? { partnerId } : {}),
          ...(productId ? { productId } : {}),
          ...(expectedCloseAt
            ? { expectedCloseAt: new Date(expectedCloseAt).toISOString() }
            : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось создать сделку',
      );
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section
        aria-modal="true"
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Обеспечение выручки</p>
            <h2>Новая сделка</h2>
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
              <span>Название *</span>
              <input
                autoFocus
                maxLength={500}
                minLength={2}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например, Грант ФСИ «Студенческий стартап»"
                required
                value={title}
              />
            </label>
            <label className="form-field">
              <span>Тип *</span>
              <select onChange={(event) => setDealType(event.target.value as DealType)} value={dealType}>
                <option value="COMMERCIAL">Коммерция</option>
                <option value="GRANT">Грант</option>
              </select>
            </label>
            <label className="form-field">
              <span>Сумма, ₽ *</span>
              <input
                min={0}
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={amount}
              />
            </label>
            <label className="form-field">
              <span>Партнёр</span>
              <select onChange={(event) => setPartnerId(event.target.value)} value={partnerId}>
                <option value="">Не выбран</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Продукт</span>
              <select onChange={(event) => setProductId(event.target.value)} value={productId}>
                <option value="">Не выбран</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Ожидаемое закрытие</span>
              <input
                onChange={(event) => setExpectedCloseAt(event.target.value)}
                type="date"
                value={expectedCloseAt}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Комментарий</span>
              <textarea
                maxLength={10_000}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                value={comment}
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
              disabled={saving || title.trim().length < 2 || amount === ''}
              type="submit"
            >
              {saving ? 'Создаём…' : 'Создать сделку'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
