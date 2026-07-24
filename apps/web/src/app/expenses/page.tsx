'use client';

import { ChevronLeft, ChevronRight, Plus, Trash2, Wallet, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ApiError, api, formatDate, formatMoney } from '@/lib/api';
import type {
  CurrentUser,
  DealSummary,
  EventSummary,
  ExpenseCategory,
  ExpenseSummary,
  ProductSummary,
} from '@/lib/types';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  VARIABLE: 'Переменные',
  OPEX: 'Операционные',
  BACK_OFFICE: 'Бэк-офис',
  ACQUISITION: 'Привлечение',
  ACTIVATION: 'Активация',
};

const EXPENSE_CATEGORY_HINTS: Record<ExpenseCategory, string> = {
  VARIABLE: 'Возникают только из-за конкретной сделки/мероприятия: подрядчик, материалы, призовой фонд',
  OPEX: 'Содержание системы: команда, регулярные сервисы, административные процессы',
  BACK_OFFICE: 'Документы, заявки, бюджеты, сопровождение',
  ACQUISITION: 'Привлечение новых строк в базу: реклама, информационная политика',
  ACTIVATION: 'Трекинг, эксперты, активационные сессии, инструменты',
};

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(key: string): { from: string; to: string } {
  const [year, month] = key.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year!, month! - 1, 1)).toISOString(),
    to: new Date(Date.UTC(year!, month!, 1)).toISOString(),
  };
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year!, month! - 1 + delta, 1)));
}

export default function ExpensesPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<ExpenseSummary[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const bounds = useMemo(() => monthBounds(month), [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: bounds.from, to: bounds.to });
    if (category) params.set('category', category);
    try {
      const response = await api<{
        items: ExpenseSummary[];
        totalsByCategory: Record<string, number>;
      }>(`/expenses?${params}`);
      setItems(response.items);
      setTotals(response.totalsByCategory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить расходы');
    } finally {
      setLoading(false);
    }
  }, [bounds, category]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanWrite(user.permissions.includes('expenses.write')))
      .catch(() => setCanWrite(false));
  }, []);

  async function archiveExpense(expense: ExpenseSummary) {
    if (!window.confirm(`Удалить расход «${expense.description}»?`)) return;
    try {
      await api(`/expenses/${expense.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: expense.version, archive: true }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить расход');
    }
  }

  const totalAmount = Object.values(totals).reduce((sum, value) => sum + value, 0);

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Переменные, операционные, привлечение и активация</p>
          <h1>Расходы</h1>
          <p>
            Каждый расход привязан хотя бы к одному уровню: период, мероприятие, продукт, сделка
            или проект. На этих данных считаются поток, OpEx % и стоимости.
          </p>
        </div>
        {canWrite && (
          <div className="heading-actions">
            <button className="button button--primary" onClick={() => setShowCreate(true)}>
              <Plus size={17} /> Новый расход
            </button>
          </div>
        )}
      </section>

      <section className="registry-toolbar registry-toolbar--filters">
        <button
          aria-label="Предыдущий месяц"
          className="button button--secondary button--compact"
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="Период"
          className="select-control"
          onChange={(event) => event.target.value && setMonth(event.target.value)}
          type="month"
          value={month}
        />
        <button
          aria-label="Следующий месяц"
          className="button button--secondary button--compact"
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
          type="button"
        >
          <ChevronRight size={16} />
        </button>
        <select
          aria-label="Категория"
          className="select-control"
          onChange={(event) => setCategory(event.target.value)}
          value={category}
        >
          <option value="">Все категории</option>
          {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="registry-result-count">
          Итого за период: {formatMoney(totalAmount)}
        </span>
      </section>

      <section className="metric-grid">
        {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
          <div className="metric-card" key={value} title={EXPENSE_CATEGORY_HINTS[value as ExpenseCategory]}>
            <span className="metric-card__label">{label}</span>
            <strong>{formatMoney(totals[value] ?? 0)}</strong>
          </div>
        ))}
      </section>

      <section className="table-panel">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            title="Расходов за период нет"
            text="Добавьте расходы, чтобы панель метрик считала поток, OpEx % и стоимости."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Категория</th>
                  <th>Описание</th>
                  <th>Привязка</th>
                  <th className="number-cell">Сумма</th>
                  {canWrite && (
                    <th>
                      <span className="sr-only">Действия</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }, (_, index) => (
                      <tr className="skeleton-row" key={index}>
                        <td colSpan={canWrite ? 6 : 5}>
                          <span />
                        </td>
                      </tr>
                    ))
                  : items.map((expense) => (
                      <tr key={expense.id}>
                        <td>{expense.occurredAt ? formatDate(expense.occurredAt) : '—'}</td>
                        <td>
                          <span className="event-status">
                            {EXPENSE_CATEGORY_LABELS[expense.category]}
                          </span>
                        </td>
                        <td>
                          <span className="event-name-cell">
                            <span className="table-file-icon">
                              <Wallet size={16} />
                            </span>
                            <span>{expense.description}</span>
                          </span>
                        </td>
                        <td>
                          {[
                            expense.eventName,
                            expense.productName,
                            expense.dealTitle,
                            expense.projectName,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'период'}
                        </td>
                        <td className="number-cell">
                          {formatMoney(expense.amount, expense.currency)}
                        </td>
                        {canWrite && (
                          <td>
                            <button
                              aria-label={`Удалить «${expense.description}»`}
                              className="icon-button"
                              onClick={() => void archiveExpense(expense)}
                              type="button"
                            >
                              <Trash2 size={16} />
                            </button>
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
        <CreateExpenseDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateExpenseDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>('VARIABLE');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [eventId, setEventId] = useState('');
  const [productId, setProductId] = useState('');
  const [dealId, setDealId] = useState('');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [deals, setDeals] = useState<DealSummary[]>([]);
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
    void api<{ items: EventSummary[] }>('/events')
      .then((response) => setEvents(response.items))
      .catch(() => setEvents([]));
    void api<{ items: ProductSummary[] }>('/products')
      .then((response) => setProducts(response.items))
      .catch(() => setProducts([]));
    void api<{ items: DealSummary[] }>('/deals')
      .then((response) => setDeals(response.items))
      .catch(() => setDeals([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category,
          amount: Number(amount || 0),
          occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
          description: description.trim(),
          ...(eventId ? { eventId } : {}),
          ...(productId ? { productId } : {}),
          ...(dealId ? { dealId } : {}),
        }),
      });
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось создать расход',
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
            <p className="eyebrow">Учёт затрат</p>
            <h2>Новый расход</h2>
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
            <label className="form-field">
              <span>Категория *</span>
              <select
                onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
                title={EXPENSE_CATEGORY_HINTS[category]}
                value={category}
              >
                {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Сумма, ₽ *</span>
              <input
                min={0.01}
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={amount}
              />
            </label>
            <label className="form-field">
              <span>Дата *</span>
              <input
                onChange={(event) => setOccurredAt(event.target.value)}
                required
                type="date"
                value={occurredAt}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Описание *</span>
              <input
                maxLength={2000}
                minLength={2}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Например, призовой фонд хакатона"
                required
                value={description}
              />
            </label>
            <label className="form-field">
              <span>Мероприятие</span>
              <select onChange={(event) => setEventId(event.target.value)} value={eventId}>
                <option value="">Не привязан</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Продукт</span>
              <select onChange={(event) => setProductId(event.target.value)} value={productId}>
                <option value="">Не привязан</option>
                {products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Сделка</span>
              <select onChange={(event) => setDealId(event.target.value)} value={dealId}>
                <option value="">Не привязан</option>
                {deals.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
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
              disabled={saving || description.trim().length < 2 || amount === ''}
              type="submit"
            >
              {saving ? 'Создаём…' : 'Добавить расход'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
