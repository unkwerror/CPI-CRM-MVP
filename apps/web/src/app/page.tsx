'use client';

import { AlertCircle, ArrowRight, CalendarDays, Clock3, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { DashboardMetrics, PeopleResponse } from '@/lib/types';

const emptyMetrics: DashboardMetrics = {
  totalPeople: 0,
  activatedEver: 0,
  active: 0,
  medium: 0,
  inactive: 0,
  notActivated: 0,
  unknownLegacy: 0,
  unreviewedArtifacts: 0,
  duplicateCandidates: 0,
  overdueTasks: 0,
  recentVersions: 0,
  recentAuthors: 0,
  eventCount: 0,
  scoreDistribution: Array.from({ length: 10 }, (_, index) => ({ score: index + 1, count: 0 })),
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [attention, setAttention] = useState<PeopleResponse['items']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<DashboardMetrics>('/dashboard/participants'),
      api<PeopleResponse>('/people?activityStatus=MEDIUM&limit=5'),
    ])
      .then(([nextMetrics, people]) => {
        setMetrics(nextMetrics);
        setAttention(people.items);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Дашборд недоступен'))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div className="page-stack">
        <section className="page-heading">
          <p className="eyebrow">Операционный дашборд</p>
          <h1>Состояние CRM</h1>
        </section>
        <section className="panel">
          <EmptyState title="Не удалось загрузить показатели" text={error} />
        </section>
      </div>
    );
  }

  const maxScore = Math.max(1, ...metrics.scoreDistribution.map((item) => item.count));

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Операционный дашборд</p>
          <h1>Добрый день</h1>
          <p>Состояние базы и приоритеты команды на сегодня.</p>
        </div>
        <div className="heading-actions">
          <Link className="button button--secondary" href="/imports">
            Импортировать данные
          </Link>
          <Link className="button button--primary" href="/participants?create=1">
            + Новый участник
          </Link>
        </div>
      </section>

      <section className="metric-grid">
        <Link className="metric-card metric-card--hero" href="/participants">
          <span className="metric-card__icon">
            <Users size={20} />
          </span>
          <span className="metric-card__label">Всего участников</span>
          <strong>{loading ? '…' : metrics.totalPeople.toLocaleString('ru-RU')}</strong>
          <small>{metrics.activatedEver.toLocaleString('ru-RU')} активированы когда-либо</small>
        </Link>
        <Link className="metric-card" href="/participants?activityStatus=ACTIVE">
          <span className="metric-card__kicker metric-card__kicker--green">Сейчас</span>
          <span className="metric-card__label">Активные</span>
          <strong>{loading ? '…' : metrics.active.toLocaleString('ru-RU')}</strong>
          <small>Артефакт за последние 252 часа</small>
        </Link>
        <Link className="metric-card" href="/participants?activityStatus=MEDIUM">
          <span className="metric-card__kicker metric-card__kicker--amber">Внимание</span>
          <span className="metric-card__label">Средняя активность</span>
          <strong>{loading ? '…' : metrics.medium.toLocaleString('ru-RU')}</strong>
          <small>Главная рабочая очередь</small>
        </Link>
        <Link className="metric-card" href="/participants?activityStatus=INACTIVE">
          <span className="metric-card__kicker metric-card__kicker--red">Более 3 недель</span>
          <span className="metric-card__label">Неактивные</span>
          <strong>{loading ? '…' : metrics.inactive.toLocaleString('ru-RU')}</strong>
          <small>Нужен новый содержательный результат</small>
        </Link>
      </section>

      <section className="dashboard-columns">
        <article className="panel panel--wide">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Рабочая очередь</p>
              <h2>Требуют внимания</h2>
            </div>
            <Link className="text-link" href="/participants?activityStatus=MEDIUM">
              Вся очередь <ArrowRight size={15} />
            </Link>
          </header>
          {attention.length === 0 && !loading ? (
            <EmptyState title="Очередь пуста" text="Участники средней активности появятся здесь." />
          ) : (
            <div className="attention-list">
              {attention.map((person) => (
                <Link className="attention-row" href={`/participants/${person.id}`} key={person.id}>
                  <span className="attention-row__signal" />
                  <span className="attention-row__main">
                    <strong>{person.canonicalFullName}</strong>
                    <small>
                      {person.organization ?? person.primaryContact ?? 'Данные уточняются'}
                    </small>
                  </span>
                  <span className="attention-row__meta">
                    <Clock3 size={14} />
                    {person.lastArtifactAt
                      ? new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' }).format(
                          -Math.floor(
                            (Date.now() - new Date(person.lastArtifactAt).getTime()) / 86_400_000,
                          ),
                          'day',
                        )
                      : 'нет даты'}
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="panel lifecycle-panel">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Качество данных</p>
              <h2>Очереди</h2>
            </div>
          </header>
          <Link className="queue-item" href="/events">
            <span className="queue-item__icon queue-item__icon--violet">
              <CalendarDays size={19} />
            </span>
            <span>
              <strong>{metrics.eventCount}</strong>
              <small>мероприятий в базе</small>
            </span>
            <ArrowRight size={16} />
          </Link>
          <Link className="queue-item" href="/participants?activationState=UNKNOWN_LEGACY">
            <span className="queue-item__icon queue-item__icon--red">
              <AlertCircle size={19} />
            </span>
            <span>
              <strong>{metrics.unknownLegacy}</strong>
              <small>профилей с неполной историей</small>
            </span>
            <ArrowRight size={16} />
          </Link>
        </article>
      </section>

      <section className="dashboard-columns dashboard-columns--bottom">
        <article className="panel panel--wide">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Последние 3 недели</p>
              <h2>Артефактная активность</h2>
            </div>
          </header>
          <div className="artifact-activity">
            <div>
              <strong>{metrics.recentVersions}</strong>
              <span>учитываемых версий</span>
            </div>
            <div>
              <strong>{metrics.recentAuthors}</strong>
              <span>уникальных авторов</span>
            </div>
            <div>
              <strong>{metrics.notActivated}</strong>
              <span>не активированы после baseline</span>
            </div>
          </div>
        </article>
        <article className="panel score-panel">
          <header className="panel__header">
            <h2>Распределение оценок</h2>
          </header>
          <div className="score-chart">
            {metrics.scoreDistribution.map((item) => (
              <div className="score-bar" key={item.score} title={`${item.score}: ${item.count}`}>
                <span style={{ height: `${Math.max(4, (item.count / maxScore) * 72)}px` }} />
                <small>{item.score}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
