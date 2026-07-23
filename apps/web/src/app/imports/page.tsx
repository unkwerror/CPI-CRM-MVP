'use client';

import {
  CheckCircle2,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { api, formatDate } from '@/lib/api';
import type { ImportRunSummary } from '@/lib/types';

export default function ImportsPage() {
  const [runs, setRuns] = useState<ImportRunSummary[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    const result = await api<{ items: ImportRunSummary[] }>('/imports');
    setRuns(result.items);
  }
  useEffect(() => {
    void reload();
  }, []);
  async function start(mode: 'dry-run' | 'commit', runId?: string) {
    setWorking(true);
    setError(null);
    try {
      if (mode === 'dry-run')
        await api('/imports/local-workbook/dry-run', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: '{}',
        });
      else
        await api(`/imports/${runId}/commit`, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: '{}',
        });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Импорт не запущен');
    } finally {
      setWorking(false);
    }
  }
  const latestDryRun = runs.find((run) => run.mode === 'DRY_RUN' && run.status === 'COMPLETED');
  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <p className="eyebrow">Воспроизводимый ETL</p>
          <h1>Импорт исходной книги</h1>
          <p>
            Координаты и hash исходных строк сохраняются неизменно; чувствительные значения
            редактируются до staging, а создание людей проходит через безопасное разрешение дублей.
          </p>
        </div>
        <button
          className="button button--primary"
          disabled={working}
          onClick={() => start('dry-run')}
        >
          <Play size={16} /> {working ? 'Обрабатываем…' : 'Запустить dry-run'}
        </button>
      </section>
      {error && <p className="form-error">{error}</p>}
      <section className="import-overview">
        <article className="source-file-card">
          <span className="source-file-card__icon">
            <FileSpreadsheet size={25} />
          </span>
          <div>
            <small>Локальный источник</small>
            <strong>Участники_всех_мероприятий_Стартап_студии_ЯДРО1.xlsx</strong>
            <p>34 листа · контроль: 11 739 строк · 12 122 наблюдения</p>
          </div>
          <span className="verified-pill">
            <ShieldCheck size={14} /> SHA-256 при запуске
          </span>
        </article>
        <article className="import-guardrails">
          <h3>Что гарантирует импорт</h3>
          <ul>
            <li>
              <CheckCircle2 size={15} />
              Формулы не исполняются
            </li>
            <li>
              <CheckCircle2 size={15} />
              Повторный запуск идемпотентен
            </li>
            <li>
              <CheckCircle2 size={15} />
              Каждое импортированное значение связано с листом и строкой
            </li>
            <li>
              <CheckCircle2 size={15} />
              Сильные совпадения объединяются, спорные закрываются без merge
            </li>
            <li>
              <CheckCircle2 size={15} />
              Test и технические значения ФИО остаются в аудите, но не создают участников
            </li>
          </ul>
        </article>
      </section>
      {latestDryRun && (
        <section className="panel dry-run-result">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Последняя проверка</p>
              <h2>Dry-run завершён</h2>
            </div>
            <button
              className="button button--primary"
              disabled={working}
              onClick={() => start('commit', latestDryRun.id)}
            >
              <Database size={15} /> Подтвердить импорт
            </button>
          </header>
          <div className="import-stats">
            <div>
              <strong>{latestDryRun.sheetsProcessed}/34</strong>
              <span>листов</span>
            </div>
            <div>
              <strong>{latestDryRun.sourceRecords.toLocaleString('ru-RU')}</strong>
              <span>raw-строк</span>
            </div>
            <div>
              <strong>{latestDryRun.observations.toLocaleString('ru-RU')}</strong>
              <span>наблюдений</span>
            </div>
            <div>
              <strong>{latestDryRun.duplicatesQueued}</strong>
              <span>совпадений найдено</span>
            </div>
            <div>
              <strong>{latestDryRun.rejected}</strong>
              <span>отклонено ФИО</span>
            </div>
            <div>
              <strong>{latestDryRun.quarantined}</strong>
              <span>карантин</span>
            </div>
          </div>
        </section>
      )}
      <section className="panel">
        <header className="panel__header">
          <div>
            <p className="eyebrow">История</p>
            <h2>Запуски импорта</h2>
          </div>
        </header>
        {runs.length ? (
          <div className="import-runs">
            {runs.map((run) => (
              <div className="import-run" key={run.id}>
                <span className={`run-status run-status--${run.status.toLowerCase()}`}>
                  {run.status === 'RUNNING' ? (
                    <LoaderCircle size={16} />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                </span>
                <span>
                  <strong>{run.mode}</strong>
                  <small>{run.fileName}</small>
                </span>
                <span>{run.sourceRecords.toLocaleString('ru-RU')} строк</span>
                <span>{formatDate(run.createdAt, true)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Запусков ещё нет"
            text="Dry-run проверит книгу без изменения канонических данных."
          />
        )}
      </section>
    </div>
  );
}
