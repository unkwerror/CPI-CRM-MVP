'use client';

import {
  Banknote,
  CalendarDays,
  Handshake,
  Package,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { api, formatMoney } from '@/lib/api';
import type { FpfMetrics } from '@/lib/types';

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<FpfMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<FpfMetrics>('/dashboard/fpf')
      .then(setMetrics)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Метрики недоступны'),
      );
  }, []);

  if (error) {
    return (
      <div className="page-stack">
        <section className="page-heading">
          <p className="eyebrow">FPF-метрики</p>
          <h1>Метрики недоступны</h1>
        </section>
        <section className="panel">
          <EmptyState title="Не удалось загрузить показатели" text={error} />
        </section>
      </div>
    );
  }

  const percent = (value: number) => `${(value * 100).toFixed(1)} %`;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">Function → Process → Form</p>
        <h1>Метрики FPF</h1>
        <p>
          Минимальный набор взаимосвязанных показателей: Поток (выручка и средний чек держатся
          парой), Инвестиции (размер и качество базы) и процессные метрики.
        </p>
      </section>

      <section className="page-heading">
        <p className="eyebrow">Поток (Throughput)</p>
      </section>
      <section className="metric-grid">
        <Link className="metric-card metric-card--hero" href="/deals?status=WON">
          <span className="metric-card__icon">
            <Banknote size={20} />
          </span>
          <span className="metric-card__label">Выручка (всего)</span>
          <strong>{metrics ? formatMoney(metrics.flow.revenueTotal) : '…'}</strong>
          <small>
            {metrics ? formatMoney(metrics.flow.revenue90d) : '…'} за последние 90 дней
          </small>
        </Link>
        <div className="metric-card">
          <span className="metric-card__kicker metric-card__kicker--green">Пара к выручке</span>
          <span className="metric-card__label">Средний чек</span>
          <strong>{metrics ? formatMoney(metrics.flow.averageCheck) : '…'}</strong>
          <small>{metrics?.flow.wonDeals ?? '…'} выигранных сделок</small>
        </div>
        <div className="metric-card">
          <span className="metric-card__kicker metric-card__kicker--green">Ключевой показатель</span>
          <span className="metric-card__label">Выручка на голову</span>
          <strong>{metrics ? formatMoney(metrics.flow.revenuePerHead) : '…'}</strong>
          <small>по всей базе ({metrics?.investments.basePeople ?? '…'} чел.)</small>
        </div>
        <Link className="metric-card" href="/deals?status=LEAD">
          <span className="metric-card__kicker metric-card__kicker--amber">В работе</span>
          <span className="metric-card__label">Открытый пайплайн</span>
          <strong>{metrics ? formatMoney(metrics.flow.openPipeline) : '…'}</strong>
          <small>{metrics?.flow.openDeals ?? '…'} сделок в лидах и переговорах</small>
        </Link>
      </section>

      <section className="dashboard-columns">
        <article className="panel panel--wide">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Структура выручки</p>
              <h2>Гранты и коммерция</h2>
            </div>
          </header>
          <div className="artifact-activity">
            <div>
              <strong>{metrics ? formatMoney(metrics.flow.grantRevenue) : '…'}</strong>
              <span>грантовая выручка</span>
            </div>
            <div>
              <strong>{metrics ? formatMoney(metrics.flow.commercialRevenue) : '…'}</strong>
              <span>коммерческая выручка</span>
            </div>
            <div>
              <strong>{metrics?.flow.wonDeals90d ?? '…'}</strong>
              <span>сделок закрыто за 90 дней</span>
            </div>
          </div>
        </article>
        <article className="panel">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Инвестиции (база)</p>
              <h2>Размер и качество</h2>
            </div>
          </header>
          <Link className="queue-item" href="/participants">
            <span className="queue-item__icon queue-item__icon--violet">
              <Users size={19} />
            </span>
            <span>
              <strong>{metrics?.investments.basePeople.toLocaleString('ru-RU') ?? '…'}</strong>
              <small>человек в базе (+{metrics?.investments.newPeople30d ?? '…'} за 30 дней)</small>
            </span>
          </Link>
          <Link className="queue-item" href="/participants?activationState=ACTIVATED">
            <span className="queue-item__icon queue-item__icon--violet">
              <TrendingUp size={19} />
            </span>
            <span>
              <strong>{metrics ? percent(metrics.investments.activationRate) : '…'}</strong>
              <small>активированных участников ({metrics?.investments.activated ?? '…'})</small>
            </span>
          </Link>
          <Link className="queue-item" href="/participants?activityStatus=INACTIVE">
            <span className="queue-item__icon queue-item__icon--red">
              <TrendingDown size={19} />
            </span>
            <span>
              <strong>{metrics ? percent(metrics.investments.churnRate) : '…'}</strong>
              <small>
                отвалившихся: активированы, но без артефактов 3 месяца (
                {metrics?.investments.churned ?? '…'})
              </small>
            </span>
          </Link>
        </article>
      </section>

      <section className="page-heading">
        <p className="eyebrow">Процессные метрики</p>
      </section>
      <section className="metric-grid">
        <Link className="metric-card" href="/partners">
          <span className="metric-card__icon">
            <Handshake size={20} />
          </span>
          <span className="metric-card__label">Партнёры с касанием за 30 дней</span>
          <strong>
            {metrics ? `${metrics.processes.partnersTouched30d} / ${metrics.processes.partnersTotal}` : '…'}
          </strong>
          <small>{metrics?.processes.activeAgreements ?? '…'} активных соглашений</small>
        </Link>
        <Link className="metric-card" href="/products?status=ON_SALE">
          <span className="metric-card__icon">
            <Package size={20} />
          </span>
          <span className="metric-card__label">Продукты в продаже</span>
          <strong>
            {metrics ? `${metrics.processes.productsOnSale} / ${metrics.processes.productsTotal}` : '…'}
          </strong>
          <small>{metrics?.processes.productsClosed ?? '…'} закрыто (не продавались)</small>
        </Link>
        <Link className="metric-card" href="/events">
          <span className="metric-card__icon">
            <CalendarDays size={20} />
          </span>
          <span className="metric-card__label">Мероприятия</span>
          <strong>{metrics?.processes.eventsUpcoming ?? '…'}</strong>
          <small>текущих и запланированных из {metrics?.processes.eventsTotal ?? '…'}</small>
        </Link>
        <Link className="metric-card" href="/participants">
          <span className="metric-card__icon">
            <Users size={20} />
          </span>
          <span className="metric-card__label">Авторы артефактов за 90 дней</span>
          <strong>{metrics?.investments.artifactAuthors90d ?? '…'}</strong>
          <small>артефакт — сквозная «валюта» процессов</small>
        </Link>
      </section>
    </div>
  );
}
