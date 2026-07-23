'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { api, formatDate } from '@/lib/api';

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  reason?: string | null;
  occurred_at: string;
  actor_name?: string | null;
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: AuditEntry[] }>('/audit?limit=100')
      .then((result) => setItems(result.items))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Журнал недоступен'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">Контроль</p>
        <h1>Журнал действий</h1>
        <p>Мутации, изменения статусов и доступ к защищённым данным.</p>
      </section>
      <section className="table-panel">
        {error ? (
          <EmptyState title="Журнал недоступен" text={error} />
        ) : items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>Инициатор</th>
                  <th>Причина</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.occurred_at, true)}</td>
                    <td>{actionLabel(item.action)}</td>
                    <td>
                      {item.entity_type}
                      {item.entity_id ? ` · ${item.entity_id.slice(0, 8)}` : ''}
                    </td>
                    <td>{item.actor_name ?? 'Система'}</td>
                    <td>{item.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading ? (
          <EmptyState title="Журнал включён" text="Записи появятся после первых действий в CRM." />
        ) : (
          <div className="empty-state">
            <span className="empty-state__icon">
              <ShieldCheck size={22} />
            </span>
            <strong>Загружаем журнал…</strong>
          </div>
        )}
      </section>
    </div>
  );
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    'person.created': 'Участник создан',
    'person.updated': 'Участник изменён',
    'contact.created': 'Контакт добавлен',
    'artifact.created': 'Артефакт создан',
    'artifact.version_created': 'Версия создана',
    'artifact.version_submitted': 'Версия отправлена',
    'artifact.reviewed': 'Оценка сохранена',
    'task.created': 'Задача создана',
    'task.completed': 'Задача завершена',
    'interaction.created': 'Взаимодействие записано',
    'person.merge': 'Карточки объединены',
    'person.unmerge': 'Объединение отменено',
    'import.commit_completed': 'Импорт зафиксирован',
    'audit.read': 'Журнал просмотрен',
  };
  return labels[action] ?? action;
}
