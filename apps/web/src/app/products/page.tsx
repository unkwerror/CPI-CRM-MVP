'use client';

import { Package, Plus, RotateCcw, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ApiError, api, formatDate, formatMoney } from '@/lib/api';
import { PRODUCT_STATUS_LABELS } from '@/lib/fpf-labels';
import type { CurrentUser, ProductStatus, ProductSummary } from '@/lib/types';

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="page-loading">Загружаем продукты…</div>}>
      <ProductsContent />
    </Suspense>
  );
}

function ProductsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [closing, setClosing] = useState<ProductSummary | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const status = searchParams.get('status');
    try {
      const response = await api<{ items: ProductSummary[] }>(
        `/products${status ? `?status=${status}` : ''}`,
      );
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить продукты');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanWrite(user.permissions.includes('products.write')))
      .catch(() => setCanWrite(false));
  }, []);

  async function changeStatus(product: ProductSummary, status: ProductStatus) {
    if (status === 'CLOSED') {
      setClosing(product);
      return;
    }
    try {
      await api(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: product.version, status }),
      });
      await loadProducts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить статус');
    }
  }

  const statusFilter = searchParams.get('status') ?? '';

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Упаковка механик в продаваемый продукт</p>
          <h1>Продукты</h1>
          <p>Описание, документация и модель реализации. Если продукт не продаётся — закрывается.</p>
        </div>
        {canWrite && (
          <div className="heading-actions">
            <button className="button button--primary" onClick={() => setShowCreate(true)}>
              <Plus size={17} /> Новый продукт
            </button>
          </div>
        )}
      </section>

      <section className="registry-toolbar registry-toolbar--filters">
        <select
          aria-label="Статус продукта"
          className="select-control"
          value={statusFilter}
          onChange={(event) =>
            router.push(event.target.value ? `/products?status=${event.target.value}` : '/products')
          }
        >
          <option value="">Любой статус</option>
          {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {statusFilter && (
          <button
            className="button button--secondary registry-filter-reset"
            type="button"
            onClick={() => router.push('/products')}
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
            title="Продукты не найдены"
            text="Упакуйте первую механику (ивент, активацию, образование) в продукт."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Продукт</th>
                  <th>Модель реализации</th>
                  <th>Статус</th>
                  <th className="number-cell">Цена</th>
                  <th className="number-cell">Сделок</th>
                  <th className="number-cell">Выручка</th>
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
                  : items.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <span className="event-name-cell">
                            <span className="table-file-icon">
                              <Package size={16} />
                            </span>
                            <span>
                              <strong>{product.name}</strong>
                              {product.documentationUrl && (
                                <>
                                  {' '}
                                  <a
                                    href={product.documentationUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    документация
                                  </a>
                                </>
                              )}
                              {product.status === 'CLOSED' && product.closeReason && (
                                <small style={{ display: 'block' }}>
                                  Закрыт {formatDate(product.closedAt)}: {product.closeReason}
                                </small>
                              )}
                            </span>
                          </span>
                        </td>
                        <td>{product.deliveryModel ?? '—'}</td>
                        <td>
                          <span className="event-status">
                            {PRODUCT_STATUS_LABELS[product.status]}
                          </span>
                        </td>
                        <td className="number-cell">
                          {product.price === null || product.price === undefined
                            ? '—'
                            : formatMoney(product.price)}
                        </td>
                        <td className="number-cell">{product.dealCount}</td>
                        <td className="number-cell">{formatMoney(product.wonAmount)}</td>
                        {canWrite && (
                          <td>
                            <select
                              aria-label={`Статус «${product.name}»`}
                              className="select-control"
                              value={product.status}
                              onChange={(event) =>
                                void changeStatus(product, event.target.value as ProductStatus)
                              }
                            >
                              {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
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
        <CreateProductDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void loadProducts();
          }}
        />
      )}
      {closing && (
        <CloseProductDialog
          product={closing}
          onClose={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            void loadProducts();
          }}
        />
      )}
    </div>
  );
}

function CreateProductDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deliveryModel, setDeliveryModel] = useState('');
  const [documentationUrl, setDocumentationUrl] = useState('');
  const [status, setStatus] = useState<'IDEA' | 'PACKAGING' | 'ON_SALE'>('IDEA');
  const [price, setPrice] = useState('');
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
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          status,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(deliveryModel.trim() ? { deliveryModel: deliveryModel.trim() } : {}),
          ...(documentationUrl.trim() ? { documentationUrl: documentationUrl.trim() } : {}),
          ...(price ? { price: Number(price) } : {}),
        }),
      });
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось создать продукт',
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
            <p className="eyebrow">База продуктов</p>
            <h2>Новый продукт</h2>
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
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Хакатон под ключ"
                required
                value={name}
              />
            </label>
            <label className="form-field">
              <span>Статус</span>
              <select
                onChange={(event) =>
                  setStatus(event.target.value as 'IDEA' | 'PACKAGING' | 'ON_SALE')
                }
                value={status}
              >
                <option value="IDEA">Идея</option>
                <option value="PACKAGING">Упаковка</option>
                <option value="ON_SALE">В продаже</option>
              </select>
            </label>
            <label className="form-field">
              <span>Цена, ₽</span>
              <input
                min={0}
                onChange={(event) => setPrice(event.target.value)}
                step="0.01"
                type="number"
                value={price}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Модель реализации</span>
              <input
                maxLength={2000}
                onChange={(event) => setDeliveryModel(event.target.value)}
                placeholder="Кто и как проводит, что входит в поставку"
                value={deliveryModel}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Ссылка на документацию</span>
              <input
                maxLength={1000}
                onChange={(event) => setDocumentationUrl(event.target.value)}
                placeholder="https://…"
                value={documentationUrl}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Описание</span>
              <textarea
                maxLength={10_000}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                value={description}
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
              {saving ? 'Создаём…' : 'Создать продукт'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CloseProductDialog({
  product,
  onClose,
  onClosed,
}: {
  product: ProductSummary;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: product.version,
          status: 'CLOSED',
          closeReason: reason.trim(),
        }),
      });
      onClosed();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось закрыть продукт',
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
            <p className="eyebrow">Продукт не продаётся</p>
            <h2>Закрыть «{product.name}»</h2>
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
              <span>Причина закрытия *</span>
              <textarea
                autoFocus
                maxLength={2000}
                minLength={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Почему продукт не продался и что решили"
                required
                rows={3}
                value={reason}
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
              disabled={saving || reason.trim().length < 3}
              type="submit"
            >
              {saving ? 'Закрываем…' : 'Закрыть продукт'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
