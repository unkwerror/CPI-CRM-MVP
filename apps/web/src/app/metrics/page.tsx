'use client';

import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Handshake,
  Package,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { api, formatMoney } from '@/lib/api';
import type { CpiMetrics } from '@/lib/types';

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(key: string): { from: string; to: string } {
  const [year, month] = key.split('-').map(Number);
  const from = new Date(Date.UTC(year!, month! - 1, 1));
  const to = new Date(Date.UTC(year!, month!, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year!, month! - 1 + delta, 1)));
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : formatMoney(value);
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : `${value.toFixed(1)} %`;

export default function MetricsPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [metrics, setMetrics] = useState<CpiMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(() => monthBounds(month), [month]);

  useEffect(() => {
    setMetrics(null);
    setError(null);
    const params = new URLSearchParams({ from: bounds.from, to: bounds.to });
    void api<CpiMetrics>(`/dashboard/cpi?${params}`)
      .then(setMetrics)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Метрики недоступны'),
      );
  }, [bounds]);

  if (error) {
    return (
      <div className="page-stack">
        <section className="page-heading">
          <p className="eyebrow">Метрики ЦПИ</p>
          <h1>Метрики недоступны</h1>
        </section>
        <section className="panel">
          <EmptyState title="Не удалось загрузить показатели" text={error} />
        </section>
      </div>
    );
  }

  const m = metrics;

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">ЦПИ: метрики и рабочие определения</p>
          <h1>Панель метрик</h1>
          <p>
            Выручка, поток и средний чек — по факту оплаты. Артефакт засчитывается только после
            оценки по рубрикатору (Q ≥ 7 без нуля по релевантности и проверяемости).
          </p>
        </div>
        <div className="heading-actions" style={{ alignItems: 'center', display: 'flex', gap: '0.4rem' }}>
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
        </div>
      </section>

      <section className="page-heading">
        <p className="eyebrow">Экономика</p>
      </section>
      <section className="metric-grid">
        <Link className="metric-card metric-card--hero" href="/deals">
          <span className="metric-card__icon">
            <Banknote size={20} />
          </span>
          <span className="metric-card__label">Выручка (оплачено)</span>
          <strong>{m ? money(m.economics.revenue) : '…'}</strong>
          <small>{m?.economics.paidDeals ?? '…'} оплаченных сделок за период</small>
        </Link>
        <div className="metric-card">
          <span className="metric-card__kicker metric-card__kicker--green">Главная метрика</span>
          <span className="metric-card__label">Поток</span>
          <strong>{m ? money(m.economics.flow) : '…'}</strong>
          <small>
            выручка − переменные затраты ({m ? money(m.economics.variableExpenses) : '…'})
          </small>
        </div>
        <div className="metric-card">
          <span className="metric-card__kicker metric-card__kicker--green">Пара к выручке</span>
          <span className="metric-card__label">Средний чек</span>
          <strong>{m ? money(m.economics.averageCheck) : '…'}</strong>
          <small>по оплаченным сделкам периода</small>
        </div>
        <Link className="metric-card" href="/expenses">
          <span className="metric-card__icon">
            <Wallet size={20} />
          </span>
          <span className="metric-card__label">OpEx %</span>
          <strong>{m ? pct(m.economics.opexPercent) : '…'}</strong>
          <small>
            операционные + бэк-офис: {m ? money(m.economics.opexExpenses) : '…'} (бэк-офис{' '}
            {m ? pct(m.economics.backOfficePercent) : '…'})
          </small>
        </Link>
        <div className="metric-card">
          <span className="metric-card__label">Средняя выручка на голову</span>
          <strong>{m ? money(m.economics.revenuePerActiveHead) : '…'}</strong>
          <small>
            активные головы: {m?.economics.activeHeadsStart ?? '…'} →{' '}
            {m?.economics.activeHeadsEnd ?? '…'} (среднее за период)
          </small>
        </div>
      </section>

      <section className="page-heading">
        <p className="eyebrow">Воронка и артефакты</p>
      </section>
      <section className="metric-grid">
        <Link className="metric-card" href="/participants">
          <span className="metric-card__icon">
            <Users size={20} />
          </span>
          <span className="metric-card__label">Новые строки в базе</span>
          <strong>{m?.funnel.newPeople ?? '…'}</strong>
          <small>
            стоимость строки: {m ? money(m.funnel.costPerNewPerson) : '…'} (привлечение{' '}
            {m ? money(m.funnel.acquisitionExpenses) : '…'})
          </small>
        </Link>
        <div className="metric-card">
          <span className="metric-card__label">Конверсия в качественный артефакт</span>
          <strong>{m ? pct(m.funnel.artifactConversion) : '…'}</strong>
          <small>
            {m?.funnel.qualityArtifactAuthors ?? '…'} авторов из{' '}
            {m?.funnel.actualParticipants ?? '…'} фактических участников
          </small>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Стоимость человека с артефактом</span>
          <strong>{m ? money(m.funnel.costPerQualityAuthor) : '…'}</strong>
          <small>
            прямые расходы {m ? money(m.funnel.directExpenses) : '…'} / уникальные авторы
          </small>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Средний Q_artifact</span>
          <strong>
            {m ? (m.funnel.averageQArtifact === null ? 'н/д' : m.funnel.averageQArtifact.toFixed(1)) : '…'}
          </strong>
          <small>{m?.funnel.reviewedArtifacts ?? '…'} оценённых артефактов за период</small>
        </div>
      </section>

      <section className="page-heading">
        <p className="eyebrow">Активация и удержание</p>
      </section>
      <section className="metric-grid">
        <div className="metric-card">
          <span className="metric-card__kicker metric-card__kicker--green">Ключевой переход</span>
          <span className="metric-card__label">Процент активированных</span>
          <strong>{m ? pct(m.activation.activationRate) : '…'}</strong>
          <small>
            {m?.activation.newActivatedHeads ?? '…'} активированных из{' '}
            {m?.activation.firstQualityAuthors ?? '…'} с первым качественным артефактом
          </small>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Стоимость активации</span>
          <strong>{m ? money(m.activation.activationCost) : '…'}</strong>
          <small>
            расходы на активацию: {m ? money(m.activation.activationExpenses) : '…'}
          </small>
        </div>
        <div className="metric-card">
          <span className="metric-card__kicker metric-card__kicker--amber">
            Отрицательная метрика
          </span>
          <span className="metric-card__label">Отток 90</span>
          <strong>{m ? pct(m.activation.churn90) : '…'}</strong>
          <small>
            <TrendingDown size={13} /> {m?.activation.churnedFromStart ?? '…'} из{' '}
            {m?.activation.activeAtStart ?? '…'} активных на начало без артефакта 90 дней
          </small>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Удержание активных голов</span>
          <strong>{m ? pct(m.activation.retention) : '…'}</strong>
          <small>
            <TrendingUp size={13} /> 100 % − отток 90
          </small>
        </div>
      </section>

      <section className="page-heading">
        <p className="eyebrow">Монетизация</p>
      </section>
      <section className="metric-grid">
        <div className="metric-card">
          <span className="metric-card__label">Конверсия в монетизацию</span>
          <strong>{m ? pct(m.monetization.monetizationRate) : '…'}</strong>
          <small>
            {m?.monetization.monetizedHeads ?? '…'} из {m?.monetization.activatedHeads ?? '…'}{' '}
            активированных связаны с оплаченной сделкой
          </small>
        </div>
        <Link className="metric-card" href="/partners">
          <span className="metric-card__icon">
            <Handshake size={20} />
          </span>
          <span className="metric-card__label">Выручка на активного партнёра</span>
          <strong>{m ? money(m.monetization.revenuePerActivePartner) : '…'}</strong>
          <small>
            {m ? money(m.monetization.partnerRevenue) : '…'} партнёрской выручки /{' '}
            {m?.monetization.activePartners ?? '…'} активных партнёров
          </small>
        </Link>
      </section>

      <section className="panel panel--wide">
        <header className="panel__header">
          <div>
            <p className="eyebrow">Поток продукта</p>
            <h2>Продуктовая результативность</h2>
          </div>
          <Link className="text-link" href="/products">
            <Package size={14} /> Все продукты
          </Link>
        </header>
        {m && m.monetization.products.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Продукт</th>
                  <th className="number-cell">Выручка (оплачено)</th>
                  <th className="number-cell">Переменные затраты</th>
                  <th className="number-cell">Поток</th>
                </tr>
              </thead>
              <tbody>
                {m.monetization.products.map((product) => (
                  <tr key={product.productId}>
                    <td>{product.name}</td>
                    <td className="number-cell">{money(product.revenue)}</td>
                    <td className="number-cell">{money(product.variableExpenses)}</td>
                    <td className="number-cell">
                      <strong>{money(product.flow)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            {m ? 'За период нет продуктов с выручкой или затратами.' : 'Загружаем…'}
          </p>
        )}
      </section>
    </div>
  );
}
