'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { api, formatDate } from '@/lib/api';

interface OrganizationSettings {
  id: string;
  name: string;
  artifact_baseline_at: string;
  timezone: string;
  version: number;
  rule_set_id: string;
  rule_version: number;
  active_window_hours: number;
  inactive_after_hours: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<OrganizationSettings>('/settings/organization')
      .then(setSettings)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Настройки недоступны'),
      );
  }, []);

  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">Система</p>
        <h1>Настройки организации</h1>
        <p>Пороговые правила версионируются и применяются единообразно.</p>
      </section>
      {error ? (
        <section className="panel">
          <EmptyState title="Настройки недоступны" text={error} />
        </section>
      ) : !settings ? (
        <div className="page-loading">Загружаем настройки…</div>
      ) : (
        <section className="profile-grid">
          <article className="panel">
            <p className="eyebrow">{settings.name}</p>
            <h2>Текущие правила lifecycle</h2>
            <div className="settings-values">
              <div>
                <span>Активный период</span>
                <strong>{settings.active_window_hours} часов</strong>
              </div>
              <div>
                <span>До неактивности</span>
                <strong>{settings.inactive_after_hours} часов</strong>
              </div>
              <div>
                <span>Версия правил</span>
                <strong>v{settings.rule_version}</strong>
              </div>
            </div>
          </article>
          <article className="panel">
            <h2>Локаль и границы</h2>
            <div className="settings-values">
              <div>
                <span>Часовая зона</span>
                <strong>{settings.timezone}</strong>
              </div>
              <div>
                <span>Baseline артефактов</span>
                <strong>{formatDate(settings.artifact_baseline_at, true)}</strong>
              </div>
              <div>
                <span>Версия настроек</span>
                <strong>{settings.version}</strong>
              </div>
            </div>
          </article>
        </section>
      )}
    </div>
  );
}
