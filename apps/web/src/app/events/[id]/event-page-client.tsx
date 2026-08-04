'use client';

import {
  ArrowLeft,
  CalendarDays,
  Download,
  ExternalLink,
  FileCheck2,
  MessageSquare,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { ArtifactReviewDialog } from '@/components/artifact-review-dialog';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { ApiError, api, formatDate, initials } from '@/lib/api';
import type { CurrentUser, EventAttendanceImportResult, EventDetail } from '@/lib/types';

export function EventPageClient({ id }: { id: string }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<EventAttendanceImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void api<EventDetail>(`/events/${id}`)
      .then((result) => {
        if (active) setEvent(result);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Мероприятие недоступно');
      });
    void api<CurrentUser>('/auth/me')
      .then((user) => {
        if (active) {
          setCanExport(user.permissions.includes('exports.bulk'));
          setCanImport(user.permissions.includes('people.write'));
        }
      })
      .catch(() => {
        if (active) {
          setCanExport(false);
          setCanImport(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (error) return <EmptyState title="Не удалось открыть мероприятие" text={error} />;
  if (!event) return <div className="page-loading">Загружаем мероприятие…</div>;

  async function importAttendance(file: File) {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const response = await fetch(`/api/events/${id}/participants/import-xlsx`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: file,
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as {
          title?: string;
          detail?: string;
        } | null;
        throw new ApiError(
          problem?.title ?? 'Не удалось загрузить таблицу',
          response.status,
          problem?.detail,
        );
      }
      const result = (await response.json()) as EventAttendanceImportResult;
      setImportResult(result);
      setEvent(await api<EventDetail>(`/events/${id}`));
    } catch (caught) {
      setImportError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось загрузить таблицу посещений',
      );
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="page-stack">
      <Link className="back-link" href="/events">
        <ArrowLeft size={16} /> К списку мероприятий
      </Link>

      <section className="event-detail-hero">
        <span className="event-detail-hero__icon">
          <CalendarDays size={26} />
        </span>
        <div>
          <p className="eyebrow">Мероприятие</p>
          <h1>{event.name}</h1>
          <p>
            {formatEventPeriod(event.startsAt, event.endsAt)} · {eventStatusLabel(event.status)}
          </p>
        </div>
        <div className="event-detail-hero__actions">
          {canExport && (
            <a
              className="button button--secondary"
              href={`/api/exports/events/${event.id}/participants.xlsx`}
            >
              <Download size={16} /> Скачать XLSX
            </a>
          )}
          {canImport && (
            <>
              <input
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(inputEvent) => {
                  const file = inputEvent.target.files?.[0];
                  if (file) void importAttendance(file);
                }}
                ref={fileInput}
                type="file"
              />
              <button
                className="button button--secondary"
                disabled={importing}
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                <Upload size={16} /> {importing ? 'Загружаем…' : 'Загрузить посещения'}
              </button>
            </>
          )}
          <div className="event-detail-hero__count">
            <Users size={18} />
            <strong>{event.participants.length}</strong>
            <span>участников</span>
          </div>
        </div>
      </section>

      {(importResult || importError) && (
        <section className="panel">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Загрузка посещений</p>
              <h2>{importError ? 'Таблица не загружена' : 'Таблица обработана'}</h2>
            </div>
          </header>
          {importError ? (
            <p className="form-error">{importError}</p>
          ) : importResult ? (
            <div className="page-stack page-stack--compact">
              <p>
                Строк «Да»: <strong>{importResult.attendedRows}</strong> · найдено в CRM:{' '}
                <strong>{importResult.resolved}</strong> · добавлено:{' '}
                <strong>{importResult.added}</strong> · отмечено посещение:{' '}
                <strong>{importResult.markedAttended}</strong>.
              </p>
              {(importResult.invalid.length > 0 ||
                importResult.unmatched.length > 0 ||
                importResult.ambiguous.length > 0) && (
                <details>
                  <summary className="muted">
                    Не прошли ФИО: {importResult.invalid.length}; не найдены:{' '}
                    {importResult.unmatched.length}; неоднозначны: {importResult.ambiguous.length}
                  </summary>
                  <ul>
                    {importResult.invalid.slice(0, 20).map((item) => (
                      <li key={`invalid-${item.rowNumber}`}>
                        Строка {item.rowNumber}: {item.rawFullName || 'ФИО не заполнено'} — неверное
                        ФИО
                      </li>
                    ))}
                    {importResult.unmatched.slice(0, 20).map((item) => (
                      <li key={`unmatched-${item.rowNumber}`}>
                        Строка {item.rowNumber}: {item.fullName} — нет в базе
                      </li>
                    ))}
                    {importResult.ambiguous.slice(0, 20).map((item) => (
                      <li key={`ambiguous-${item.rowNumber}`}>
                        Строка {item.rowNumber}: {item.fullName} — несколько карточек
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : null}
        </section>
      )}

      <section className="table-panel">
        <header className="panel__header event-participants-heading">
          <div>
            <p className="eyebrow">Состав мероприятия</p>
            <h2>Участники</h2>
          </div>
        </header>
        {event.participants.length === 0 ? (
          <EmptyState title="Участников пока нет" text="В источниках не найдено записей участия." />
        ) : (
          <div className="table-scroll">
            <table className="data-table event-participants-table">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Контакт</th>
                  <th>Активность</th>
                  <th>Участие</th>
                  <th>Артефакты</th>
                  <th>Комментарии</th>
                </tr>
              </thead>
              <tbody>
                {event.participants.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <Link className="person-cell" href={`/participants/${person.id}`}>
                        <span className="avatar">{initials(person.canonicalFullName)}</span>
                        <span>
                          <strong>{person.canonicalFullName}</strong>
                          <small>
                            {person.participationCount > 1
                              ? `${person.participationCount} записей участия`
                              : '1 запись участия'}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>{person.primaryContact ?? '—'}</td>
                    <td>
                      <StatusBadge
                        activity={person.activityStatus}
                        activation={person.activationState}
                      />
                    </td>
                    <td>
                      <span className="stacked-cell">
                        <strong>
                          {person.decisions.map(decisionLabel).join(', ') || 'Не указано'}
                        </strong>
                        <small>
                          {person.attendances.map(attendanceLabel).join(', ') ||
                            'Посещение не указано'}
                        </small>
                      </span>
                    </td>
                    <td>
                      {person.artifacts.length ? (
                        <div className="event-person-artifacts">
                          {person.artifacts.map((artifact) => (
                            <button
                              type="button"
                              className="event-person-artifact"
                              key={artifact.id}
                              disabled={!artifact.latestVersionId}
                              onClick={() => setSelectedVersionId(artifact.latestVersionId ?? null)}
                            >
                              <FileCheck2 size={14} />
                              <span>{artifact.title}</span>
                              <ExternalLink size={13} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">Нет</span>
                      )}
                    </td>
                    <td>
                      {person.comments.length ? (
                        <div className="event-person-comments">
                          {person.comments.map((comment) => (
                            <span key={comment}>
                              <MessageSquare size={13} /> {comment}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedVersionId && (
        <ArtifactReviewDialog
          versionId={selectedVersionId}
          onClose={() => setSelectedVersionId(null)}
          onReviewed={() => undefined}
        />
      )}
    </div>
  );
}

function formatEventPeriod(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt && !endsAt) return 'Дата не указана';
  if (startsAt && endsAt) return `${formatDate(startsAt, true)} — ${formatDate(endsAt, true)}`;
  return formatDate(startsAt ?? endsAt, true);
}

function eventStatusLabel(status: string): string {
  return (
    {
      UNKNOWN: 'Статус не указан',
      PLANNED: 'Запланировано',
      ACTIVE: 'Идёт',
      COMPLETED: 'Завершено',
      CANCELLED: 'Отменено',
    }[status] ?? status
  );
}

function decisionLabel(value: string): string {
  return (
    {
      UNKNOWN: 'Решение не указано',
      PENDING: 'На рассмотрении',
      ACCEPTED: 'Принят',
      REJECTED: 'Отклонён',
      WAITLISTED: 'Лист ожидания',
    }[value] ?? value
  );
}

function attendanceLabel(value: string): string {
  return (
    {
      UNKNOWN: 'Посещение не указано',
      ATTENDED: 'Участвовал',
      NO_SHOW: 'Не пришёл',
      PARTIAL: 'Частично',
    }[value] ?? value
  );
}
