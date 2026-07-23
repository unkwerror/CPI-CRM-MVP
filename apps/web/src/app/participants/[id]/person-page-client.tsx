'use client';

import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  ExternalLink,
  FilePlus2,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Tag,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { ArtifactReviewDialog } from '@/components/artifact-review-dialog';
import { EditPersonDialog } from '@/components/edit-person-dialog';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { ApiError, api, formatDate, initials } from '@/lib/api';
import type { CurrentUser, PersonDetail } from '@/lib/types';

type Tab = 'overview' | 'events' | 'artifacts' | 'history';

const ARTIFACT_TYPES = [
  {
    code: 'PITCH_DECK',
    label: 'Презентация / pitch deck',
    description: 'Слайды для защиты проекта или встречи с партнёрами',
  },
  {
    code: 'CODE_REPOSITORY',
    label: 'Код или репозиторий',
    description: 'Ссылка на исходный код и техническую реализацию',
  },
  {
    code: 'APPLICATION',
    label: 'Заявка',
    description: 'Заявка на конкурс, грант, акселератор или программу',
  },
  {
    code: 'INTERVIEW',
    label: 'Интервью',
    description: 'Кастдев, интервью с клиентом или экспертом',
  },
  {
    code: 'FINANCIAL_MODEL',
    label: 'Финансовая модель',
    description: 'Экономика проекта, бюджет или финансовый прогноз',
  },
  {
    code: 'HOMEWORK',
    label: 'Домашнее задание',
    description: 'Результат задания по программе мероприятия',
  },
  {
    code: 'REPORT_RESEARCH',
    label: 'Отчёт / исследование',
    description: 'Аналитический отчёт, исследование или результаты проверки гипотез',
  },
  {
    code: 'PROTOTYPE_MVP',
    label: 'Прототип / MVP',
    description: 'Демонстрация продукта, макет или работающий прототип',
  },
  {
    code: 'OTHER',
    label: 'Другое',
    description: 'Другой подтверждённый результат участника',
  },
] as const;

type ArtifactFilterStatus = 'ALL' | 'DRAFT' | 'SUBMITTED' | 'PENDING_REVIEW' | 'REVIEWED';

export function PersonPageClient({ id }: { id: string }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showArtifact, setShowArtifact] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const canEditPerson = permissions.includes('people.write');
  const canEditContacts = permissions.includes('contacts.write');

  async function reload() {
    try {
      setPerson(await api<PersonDetail>(`/people/${id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Карточка недоступна');
    }
  }

  useEffect(() => {
    void reload();
    void api<CurrentUser>('/auth/me')
      .then((user) => setPermissions(user.permissions))
      .catch(() => setPermissions([]));
  }, [id]);

  async function addContact() {
    const selected = window.prompt('Тип контакта: PHONE, EMAIL, TELEGRAM, MAX или OTHER', 'PHONE');
    if (selected === null) return;
    const type = selected.trim().toUpperCase();
    if (!['PHONE', 'EMAIL', 'TELEGRAM', 'MAX', 'OTHER'].includes(type)) {
      window.alert('Неизвестный тип контакта.');
      return;
    }
    const value = window.prompt('Значение контакта:')?.trim();
    if (!value) return;
    try {
      await api(`/people/${person?.id ?? id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ type, value, isPrimary: true }),
      });
      await reload();
    } catch (caught) {
      window.alert(apiErrorMessage(caught, 'Не удалось добавить контакт'));
    }
  }

  async function createTask() {
    const title = window.prompt('Что нужно сделать?')?.trim();
    if (!title) return;
    const due = window.prompt('Срок в формате ГГГГ-ММ-ДД ЧЧ:ММ (необязательно):', '')?.trim();
    const dueDate = due ? new Date(due.replace(' ', 'T')) : null;
    if (dueDate && !Number.isFinite(dueDate.getTime())) {
      window.alert('Некорректный срок задачи.');
      return;
    }
    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          personId: person?.id ?? id,
          title,
          dueAt: dueDate?.toISOString(),
          isNextStep: true,
        }),
      });
      await reload();
    } catch (caught) {
      window.alert(apiErrorMessage(caught, 'Не удалось создать задачу'));
    }
  }

  async function saveNotes() {
    if (!person || notesDraft === null) return;
    setSavingNotes(true);
    try {
      await api(`/people/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: person.version, notes: notesDraft.trim() || null }),
      });
      setNotesDraft(null);
      await reload();
    } catch (caught) {
      window.alert(apiErrorMessage(caught, 'Не удалось сохранить заметки'));
    } finally {
      setSavingNotes(false);
    }
  }

  async function completeTask(taskId: string) {
    try {
      await api(`/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify({}) });
      await reload();
    } catch (caught) {
      window.alert(apiErrorMessage(caught, 'Не удалось завершить задачу'));
    }
  }

  async function addInteraction() {
    const selected = window.prompt(
      'Канал: EMAIL, PHONE, TELEGRAM, MAX, IN_PERSON или OTHER',
      'PHONE',
    );
    if (selected === null) return;
    const channel = selected.trim().toUpperCase();
    if (!['EMAIL', 'PHONE', 'TELEGRAM', 'MAX', 'IN_PERSON', 'OTHER'].includes(channel)) {
      window.alert('Неизвестный канал взаимодействия.');
      return;
    }
    const outcome = window.prompt('Результат взаимодействия:')?.trim();
    if (outcome === undefined) return;
    const comment = window.prompt('Комментарий (необязательно):', '')?.trim();
    try {
      await api('/interactions', {
        method: 'POST',
        body: JSON.stringify({
          personId: person?.id ?? id,
          channel,
          direction: 'OUTBOUND',
          occurredAt: new Date().toISOString(),
          outcome: outcome || undefined,
          comment: comment || undefined,
        }),
      });
      window.alert('Взаимодействие сохранено.');
    } catch (caught) {
      window.alert(apiErrorMessage(caught, 'Не удалось сохранить взаимодействие'));
    }
  }

  if (error) return <EmptyState title="Не удалось открыть карточку" text={error} />;
  if (!person) return <div className="page-loading">Загружаем карточку…</div>;

  const statusExplanation =
    person.activationState === 'UNKNOWN_LEGACY'
      ? 'Исторические данные неполны — отсутствие артефактов не трактуется как неактивность.'
      : person.activationState === 'NOT_ACTIVATED'
        ? 'После baseline ещё не зафиксировано ни одного отправленного артефакта.'
        : person.activityStatus === 'ACTIVE'
          ? `Последний учитываемый артефакт: ${formatDate(person.lastArtifactAt, true)}.`
          : `Статус рассчитан по последнему артефакту от ${formatDate(person.lastArtifactAt, true)}.`;

  return (
    <div className="page-stack">
      <Link className="back-link" href="/participants">
        <ArrowLeft size={16} /> К списку участников
      </Link>
      <section className="profile-hero">
        <div className="profile-hero__identity">
          <span className="avatar avatar--profile">{initials(person.canonicalFullName)}</span>
          <div>
            <div className="profile-hero__title-line">
              <h1>{person.canonicalFullName}</h1>
            </div>
            <p>
              {person.organization ?? 'Организация не указана'}
              {person.faculty ? ` · ${person.faculty}` : ''}
            </p>
            <div className="profile-hero__tags">
              {person.tags?.map((tag) => (
                <span className="tag-chip" key={tag}>
                  <Tag size={12} />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="profile-hero__actions">
          {canEditPerson && (
            <button className="button button--secondary" onClick={() => setShowEdit(true)}>
              <Pencil size={16} /> Редактировать
            </button>
          )}
          {permissions.includes('tasks.manage') && (
            <button className="button button--secondary" onClick={() => void addInteraction()}>
              <MessageCircle size={16} /> Взаимодействие
            </button>
          )}
          {permissions.includes('artifacts.write') && (
            <button className="button button--primary" onClick={() => setShowArtifact(true)}>
              <FilePlus2 size={16} /> Добавить артефакт
            </button>
          )}
        </div>
        <div className="profile-lifecycle">
          <div>
            <span>Активация</span>
            <strong>
              {person.activationState === 'ACTIVATED'
                ? 'Активирован'
                : person.activationState === 'NOT_ACTIVATED'
                  ? 'Не активирован'
                  : 'Неизвестно'}
            </strong>
            <small>
              {person.activatedAt
                ? `с ${formatDate(person.activatedAt)}`
                : 'нет подтверждённой даты'}
            </small>
          </div>
          <div>
            <span>Текущая активность</span>
            <StatusBadge activity={person.activityStatus} activation={person.activationState} />
            <small>{statusExplanation}</small>
          </div>
          <div>
            <span>Следующая граница</span>
            <strong>{formatDate(person.nextStatusTransitionAt, true)}</strong>
            <small>252 / 504 часа по версии правил</small>
          </div>
          <div>
            <span>Ответственный</span>
            <strong>{person.ownerName ?? 'Не назначен'}</strong>
            <small>комьюнити-менеджер</small>
          </div>
        </div>
      </section>

      <nav className="profile-tabs">
        {(
          [
            ['overview', 'Обзор'],
            ['events', `Мероприятия · ${person.events.length}`],
            ['artifacts', `Артефакты · ${person.artifacts.length}`],
            ['history', 'История'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'profile-tab profile-tab--active' : 'profile-tab'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <section className="profile-grid">
          <article className="panel">
            <header className="panel__header">
              <h2>Контакты</h2>
              {canEditPerson ? (
                <button className="text-link" onClick={() => setShowEdit(true)}>
                  <Pencil size={14} /> Изменить
                </button>
              ) : permissions.includes('contacts.write') ? (
                <button className="text-link" onClick={() => void addContact()}>
                  <Plus size={14} /> Добавить
                </button>
              ) : null}
            </header>
            <div className="detail-list">
              {person.contacts.map((contact) => (
                <div className="detail-row" key={contact.id}>
                  <span className="detail-row__icon">
                    {contact.type === 'EMAIL' ? (
                      <Mail size={16} />
                    ) : contact.type === 'PHONE' ? (
                      <Phone size={16} />
                    ) : (
                      <MessageCircle size={16} />
                    )}
                  </span>
                  <span>
                    <small>
                      {contact.type}
                      {contact.isPrimary ? ' · основной' : ''}
                    </small>
                    <strong>{contact.rawValue}</strong>
                  </span>
                </div>
              ))}
              {person.contacts.length === 0 && <p className="muted">Контакты ещё не указаны.</p>}
            </div>
          </article>
          <article className="panel">
            <header className="panel__header">
              <h2>Принадлежность</h2>
              {canEditPerson && (
                <button className="text-link" onClick={() => setShowEdit(true)}>
                  <Pencil size={14} /> Изменить
                </button>
              )}
            </header>
            <div className="detail-list">
              {person.affiliations.map((item) => (
                <div className="detail-row" key={item.id}>
                  <span className="detail-row__icon">
                    <MapPin size={16} />
                  </span>
                  <span>
                    <small>{item.role ?? 'Участник'}</small>
                    <strong>{item.organization}</strong>
                    <em>{item.faculty}</em>
                  </span>
                </div>
              ))}
              {person.affiliations.length === 0 && <p className="muted">Организация не связана.</p>}
            </div>
          </article>
          <article className="panel panel--wide">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Данные из источников и ручные записи</p>
                <h2>Заметки</h2>
              </div>
              {canEditPerson && notesDraft === null && (
                <button className="text-link" onClick={() => setNotesDraft(person.notes ?? '')}>
                  <Pencil size={14} /> Редактировать
                </button>
              )}
            </header>
            {notesDraft !== null ? (
              <div>
                <textarea
                  className="notes-textarea"
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  rows={14}
                  style={{ width: '100%', resize: 'vertical' }}
                  disabled={savingNotes}
                />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    className="button button--primary button--compact"
                    onClick={() => void saveNotes()}
                    disabled={savingNotes}
                  >
                    {savingNotes ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                  <button
                    className="button button--secondary button--compact"
                    onClick={() => setNotesDraft(null)}
                    disabled={savingNotes}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : person.notes ? (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  font: 'inherit',
                  margin: 0,
                }}
              >
                {person.notes}
              </pre>
            ) : (
              <p className="muted">Заметок пока нет.</p>
            )}
          </article>
          <article className="panel panel--wide">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Следующий шаг</p>
                <h2>Задачи</h2>
              </div>
              {permissions.includes('tasks.manage') && (
                <button className="text-link" onClick={() => void createTask()}>
                  <Plus size={14} /> Создать задачу
                </button>
              )}
            </header>
            {person.tasks.length ? (
              <div className="task-list">
                {person.tasks.map((task) => (
                  <div className="task-row" key={task.id}>
                    <button
                      className={`task-check task-check--${task.status.toLowerCase()}`}
                      aria-label={`Завершить задачу «${task.title}»`}
                      disabled={task.status !== 'OPEN' || !permissions.includes('tasks.manage')}
                      onClick={() => void completeTask(task.id)}
                    />
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        <CalendarDays size={13} /> {formatDate(task.dueAt)}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Нет открытых задач" text="Добавьте следующий шаг для участника." />
            )}
          </article>
          <article className="panel artifact-stat-panel">
            <header className="panel__header">
              <h2>Артефакты</h2>
            </header>
            <div className="artifact-stat">
              <strong>{person.countableArtifactCount}</strong>
              <span>уникальных учитываемых</span>
            </div>
            <div className="mini-stat">
              <Clock3 size={15} />
              <span>Последний</span>
              <strong>{formatDate(person.lastArtifactAt)}</strong>
            </div>
            <div className="mini-stat">
              <span className="score-chip">{person.latestArtifactScore ?? '—'}</span>
              <span>Последняя оценка</span>
            </div>
          </article>
        </section>
      )}

      {tab === 'events' && <EventsTab person={person} onOpenArtifact={setSelectedVersionId} />}
      {tab === 'artifacts' && (
        <ArtifactsTab
          person={person}
          canAdd={permissions.includes('artifacts.write')}
          onAdd={() => setShowArtifact(true)}
          onOpen={setSelectedVersionId}
        />
      )}
      {tab === 'history' && <TimelineTab person={person} />}
      {showArtifact && (
        <ArtifactDialog
          personId={person.id}
          events={person.events}
          onClose={() => setShowArtifact(false)}
          onCreated={async () => {
            setShowArtifact(false);
            await reload();
            setTab('artifacts');
          }}
        />
      )}
      {showEdit && (
        <EditPersonDialog
          person={person}
          canEditContacts={canEditContacts}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            await reload();
          }}
        />
      )}
      {selectedVersionId && (
        <ArtifactReviewDialog
          versionId={selectedVersionId}
          onClose={() => setSelectedVersionId(null)}
          onReviewed={reload}
        />
      )}
    </div>
  );
}

function EventsTab({
  person,
  onOpenArtifact,
}: {
  person: PersonDetail;
  onOpenArtifact: (versionId: string) => void;
}) {
  if (!person.events.length) {
    return (
      <section className="panel">
        <EmptyState
          title="Мероприятия не найдены"
          text="В импортных и текущих данных пока нет подтверждённых записей участия."
        />
      </section>
    );
  }

  return (
    <section className="event-list">
      {person.events.map((event) => (
        <article className="event-card" key={event.id}>
          <header className="event-card__header">
            <div>
              <p className="eyebrow">Мероприятие</p>
              <h2>{event.name}</h2>
              <p className="event-card__period">
                <CalendarDays size={14} /> {formatEventPeriod(event.startsAt, event.endsAt)}
              </p>
            </div>
            <span className="event-status">{eventStatusLabel(event.status)}</span>
          </header>

          <div className="event-participation-list">
            {event.participations.map((participation, index) => (
              <section className="event-participation" key={participation.id}>
                {event.participations.length > 1 && (
                  <p className="eyebrow">Запись участия {index + 1}</p>
                )}
                <div className="event-participation__facts">
                  <span>
                    <small>Роль</small>
                    <strong>{participation.role ?? 'Не указана в источнике'}</strong>
                  </span>
                  <span>
                    <small>Решение</small>
                    <strong>{decisionLabel(participation.decision)}</strong>
                  </span>
                  <span>
                    <small>Участие</small>
                    <strong>{attendanceLabel(participation.attendance)}</strong>
                  </span>
                  <span>
                    <small>Источник данных</small>
                    <strong>
                      {participation.dataOrigin === 'LEGACY_IMPORT' ? 'Импорт из таблицы' : 'CRM'}
                    </strong>
                  </span>
                </div>
                {(participation.registeredAt || participation.attendedAt) && (
                  <p className="event-participation__dates">
                    {participation.registeredAt &&
                      `Регистрация: ${formatDate(participation.registeredAt, true)}`}
                    {participation.registeredAt && participation.attendedAt && ' · '}
                    {participation.attendedAt &&
                      `Участие: ${formatDate(participation.attendedAt, true)}`}
                  </p>
                )}
                {participation.comments.length > 0 && (
                  <div className="event-comments">
                    <strong>Комментарии из таблицы</strong>
                    {participation.comments.map((comment) => (
                      <p key={comment}>{comment}</p>
                    ))}
                  </div>
                )}
                {participation.sources.length > 0 && (
                  <div className="event-sources">
                    {participation.sources.map((source) => (
                      <span key={source.id}>
                        {source.sheetName} · строка {source.rowNumber} · {source.fileName}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          <section className="event-artifacts">
            <h3>Артефакты участника с мероприятия</h3>
            {event.artifacts.length ? (
              <div className="event-artifacts__list">
                {event.artifacts.map((artifact) => (
                  <button
                    className="event-artifact"
                    type="button"
                    key={artifact.id}
                    disabled={!artifact.latestVersionId}
                    onClick={() =>
                      artifact.latestVersionId && onOpenArtifact(artifact.latestVersionId)
                    }
                  >
                    <FilePlus2 size={16} />
                    <span>
                      <strong>{artifact.title}</strong>
                      <small>
                        {artifact.typeName} · {formatDate(artifact.submittedAt)}
                      </small>
                    </span>
                    <ExternalLink size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Связанных артефактов пока нет.</p>
            )}
          </section>
        </article>
      ))}
    </section>
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

function decisionLabel(decision: string): string {
  return (
    {
      UNKNOWN: 'Не указано',
      PENDING: 'На рассмотрении',
      ACCEPTED: 'Принят',
      REJECTED: 'Отклонён',
      WAITLISTED: 'Лист ожидания',
    }[decision] ?? decision
  );
}

function attendanceLabel(attendance: string): string {
  return (
    {
      UNKNOWN: 'Не указано',
      ATTENDED: 'Участвовал',
      NO_SHOW: 'Не пришёл',
      PARTIAL: 'Частичное участие',
    }[attendance] ?? attendance
  );
}

function ArtifactsTab({
  person,
  canAdd,
  onAdd,
  onOpen,
}: {
  person: PersonDetail;
  canAdd: boolean;
  onAdd: () => void;
  onOpen: (versionId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [eventFilter, setEventFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<ArtifactFilterStatus>('ALL');

  const eventNames = useMemo(
    () => new Map(person.events.map((event) => [event.id, event.name])),
    [person.events],
  );
  const typeOptions = useMemo(
    () =>
      [...new Set(person.artifacts.map((artifact) => artifact.typeName))].sort((left, right) =>
        left.localeCompare(right, 'ru'),
      ),
    [person.artifacts],
  );
  const eventOptions = useMemo(() => {
    const artifactEventIds = new Set(
      person.artifacts
        .map((artifact) => artifact.eventId)
        .filter((eventId): eventId is string => Boolean(eventId)),
    );
    return person.events
      .filter((event) => artifactEventIds.has(event.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [person.artifacts, person.events]);
  const filteredArtifacts = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);
    return person.artifacts.filter((artifact) => {
      const eventName = artifact.eventId ? eventNames.get(artifact.eventId) : undefined;
      const matchesQuery =
        !normalizedQuery ||
        normalizeSearchValue(
          [
            artifact.title,
            artifact.typeName,
            eventName,
            ...(artifact.authors?.map((author) => author.name) ?? []),
          ].join(' '),
        ).includes(normalizedQuery);
      const matchesType = typeFilter === 'ALL' || artifact.typeName === typeFilter;
      const matchesEvent =
        eventFilter === 'ALL' ||
        (eventFilter === 'NONE' ? !artifact.eventId : artifact.eventId === eventFilter);
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'DRAFT' && artifact.latestVersionStatus === 'DRAFT') ||
        (statusFilter === 'SUBMITTED' && artifact.latestVersionStatus === 'SUBMITTED') ||
        (statusFilter === 'PENDING_REVIEW' &&
          artifact.latestVersionStatus === 'SUBMITTED' &&
          artifact.score == null) ||
        (statusFilter === 'REVIEWED' && artifact.score != null);
      return matchesQuery && matchesType && matchesEvent && matchesStatus;
    });
  }, [eventFilter, eventNames, person.artifacts, query, statusFilter, typeFilter]);
  const hasFilters =
    Boolean(query.trim()) ||
    typeFilter !== 'ALL' ||
    eventFilter !== 'ALL' ||
    statusFilter !== 'ALL';

  function resetFilters() {
    setQuery('');
    setTypeFilter('ALL');
    setEventFilter('ALL');
    setStatusFilter('ALL');
  }

  if (!person.artifacts.length)
    return (
      <section className="panel">
        <EmptyState
          title="Артефактов пока нет"
          text="Первый отправленный результат активирует участника."
        />
        {canAdd && (
          <div className="empty-action">
            <button className="button button--primary" type="button" onClick={onAdd}>
              Добавить артефакт
            </button>
          </div>
        )}
      </section>
    );

  return (
    <section className="artifact-section">
      <div className="artifact-filter-panel">
        <div className="artifact-filter-panel__topline">
          <div>
            <strong>Артефакты участника</strong>
            <small>
              Показано {filteredArtifacts.length} из {person.artifacts.length}
            </small>
          </div>
          <div className="artifact-filter-panel__actions">
            {hasFilters && (
              <button
                className="button button--secondary button--compact"
                type="button"
                onClick={resetFilters}
              >
                <RotateCcw size={14} /> Сбросить
              </button>
            )}
            {canAdd && (
              <button
                className="button button--primary button--compact"
                type="button"
                onClick={onAdd}
              >
                <Plus size={14} /> Добавить
              </button>
            )}
          </div>
        </div>
        <div className="artifact-filters">
          <label className="artifact-filter-search">
            <span className="sr-only">Поиск артефактов</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название, тип, автор или мероприятие"
            />
          </label>
          <label className="artifact-filter-control">
            <span>Тип</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="ALL">Все типы</option>
              {typeOptions.map((typeName) => (
                <option value={typeName} key={typeName}>
                  {typeName}
                </option>
              ))}
            </select>
          </label>
          <label className="artifact-filter-control">
            <span>Мероприятие</span>
            <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
              <option value="ALL">Все мероприятия</option>
              <option value="NONE">Без мероприятия</option>
              {eventOptions.map((event) => (
                <option value={event.id} key={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
          <label className="artifact-filter-control">
            <span>Статус</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ArtifactFilterStatus)}
            >
              <option value="ALL">Все статусы</option>
              <option value="SUBMITTED">Отправленные</option>
              <option value="PENDING_REVIEW">Ожидают оценки</option>
              <option value="REVIEWED">Оценённые</option>
              <option value="DRAFT">Черновики</option>
            </select>
          </label>
        </div>
      </div>

      {filteredArtifacts.length ? (
        <div className="artifact-list">
          {filteredArtifacts.map((artifact) => {
            const eventName = artifact.eventId ? eventNames.get(artifact.eventId) : undefined;
            return (
              <article className="artifact-card" key={artifact.id}>
                <div className="artifact-card__icon">
                  <FilePlus2 size={20} />
                </div>
                <div className="artifact-card__main">
                  <small>
                    {artifact.typeName} · версия {artifact.latestVersionNumber ?? '—'}
                  </small>
                  <h3>{artifact.title}</h3>
                  <div className="artifact-card__meta">
                    <span>{artifactVersionStatusLabel(artifact)}</span>
                    <span>{formatDate(artifact.submittedAt, true)}</span>
                    {eventName && (
                      <span className="artifact-card__event">
                        <CalendarDays size={12} /> {eventName}
                      </span>
                    )}
                    <span>{artifact.authors?.map((author) => author.name).join(', ')}</span>
                  </div>
                </div>
                <div className="artifact-card__review">
                  <small>Оценка</small>
                  {artifact.score == null ? (
                    <strong className="muted">Не оценён</strong>
                  ) : (
                    <strong className="score-large">
                      {artifact.score}
                      <small>/10</small>
                    </strong>
                  )}
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Открыть последнюю версию «${artifact.title}»`}
                  disabled={!artifact.latestVersionId}
                  onClick={() => artifact.latestVersionId && onOpen(artifact.latestVersionId)}
                >
                  <ExternalLink size={17} />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel artifact-filter-empty">
          <EmptyState
            title="По этим условиям ничего не найдено"
            text="Измените строку поиска или один из фильтров."
          />
          <div className="empty-action">
            <button className="button button--secondary" type="button" onClick={resetFilters}>
              <RotateCcw size={14} /> Сбросить фильтры
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

function artifactVersionStatusLabel(artifact: PersonDetail['artifacts'][number]): string {
  if (artifact.latestVersionStatus === 'DRAFT') return 'Черновик';
  if (artifact.latestVersionStatus === 'SUBMITTED')
    return artifact.score == null ? 'Ожидает оценки' : 'Оценён';
  if (!artifact.latestVersionStatus) return 'Нет версии';
  return artifact.latestVersionStatus;
}

function TimelineTab({ person }: { person: PersonDetail }) {
  return (
    <section className="panel">
      <div className="timeline">
        <div className="timeline-item">
          <span className="timeline-item__dot" />
          <div>
            <small>{formatDate(person.activatedAt, true)}</small>
            <strong>
              {person.activationState === 'ACTIVATED'
                ? 'Участник активирован'
                : 'Карточка участника создана'}
            </strong>
            <p>Событие рассчитано из первичных данных и сохранено в истории статусов.</p>
          </div>
        </div>
        {person.artifacts.map((artifact) => (
          <div className="timeline-item" key={artifact.id}>
            <span className="timeline-item__dot timeline-item__dot--violet" />
            <div>
              <small>{formatDate(artifact.submittedAt, true)}</small>
              <strong>Артефакт: {artifact.title}</strong>
              <p>
                {artifact.typeName} ·{' '}
                {artifact.score == null ? 'не оценён' : `оценка ${artifact.score}/10`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArtifactDialog({
  personId,
  events,
  onClose,
  onCreated,
}: {
  personId: string;
  events: PersonDetail['events'];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [contentType, setContentType] = useState<'TEXT' | 'EXTERNAL_URL'>('TEXT');
  const [content, setContent] = useState('');
  const [submittedAt, setSubmittedAt] = useState(toLocalDateTimeValue(new Date()));
  const [backdateReason, setBackdateReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artifactIdRef = useRef<string | null>(null);
  const versionIdRef = useRef<string | null>(null);
  const parsedSubmittedAt = new Date(submittedAt);
  const isBackdated =
    Number.isFinite(parsedSubmittedAt.getTime()) &&
    Date.now() - parsedSubmittedAt.getTime() > 5 * 60 * 1000;
  const matchingEvents = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(eventQuery);
    return events
      .filter((event) => {
        if (!normalizedQuery) return true;
        return normalizeSearchValue(
          [event.name, eventStatusLabel(event.status), event.startsAt, event.endsAt].join(' '),
        ).includes(normalizedQuery);
      })
      .sort((left, right) => {
        const leftTime = left.startsAt ? new Date(left.startsAt).getTime() : 0;
        const rightTime = right.startsAt ? new Date(right.startsAt).getTime() : 0;
        return rightTime - leftTime || left.name.localeCompare(right.name, 'ru');
      });
  }, [eventQuery, events]);
  const visibleEvents = useMemo(() => {
    if (!eventId || matchingEvents.some((event) => event.id === eventId)) return matchingEvents;
    const selectedEvent = events.find((event) => event.id === eventId);
    return selectedEvent ? [selectedEvent, ...matchingEvents] : matchingEvents;
  }, [eventId, events, matchingEvents]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedDate = new Date(submittedAt);
    if (!Number.isFinite(submittedDate.getTime())) {
      setError('Укажите корректную дату отправки.');
      return;
    }
    const backdated = Date.now() - submittedDate.getTime() > 5 * 60 * 1000;
    if (backdated && backdateReason.trim().length < 3) {
      setError('Для даты задним числом укажите причину не короче трёх символов.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let artifactId = artifactIdRef.current;
      if (!artifactId) {
        const artifact = await api<{ id: string }>('/artifacts', {
          method: 'POST',
          body: JSON.stringify({
            title,
            typeCode: type,
            eventId: eventId || undefined,
          }),
        });
        artifactId = artifact.id;
        artifactIdRef.current = artifact.id;
      }

      let versionId = versionIdRef.current;
      if (!versionId) {
        const version = await api<{ id: string }>(`/artifacts/${artifactId}/versions`, {
          method: 'POST',
          body: JSON.stringify({
            contentType,
            textContent: contentType === 'TEXT' ? content : undefined,
            externalUrls: contentType === 'EXTERNAL_URL' ? [content] : [],
            contributors: [{ personId, role: 'AUTHOR' }],
          }),
        });
        versionId = version.id;
        versionIdRef.current = version.id;
      }

      await api(`/artifact-versions/${versionId}/submit`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          submittedAt: submittedDate.toISOString(),
          backdateReason: backdated ? backdateReason.trim() : undefined,
        }),
      });
      onCreated();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось отправить артефакт'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Новый результат</p>
            <h2>Добавить артефакт</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>Название *</span>
              <input
                required
                disabled={Boolean(artifactIdRef.current)}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <fieldset
              className="form-field form-field--full artifact-type-fieldset"
              disabled={Boolean(artifactIdRef.current)}
            >
              <legend>Тип артефакта *</legend>
              <div className="artifact-type-options">
                {ARTIFACT_TYPES.map((artifactType) => (
                  <label
                    className={
                      type === artifactType.code
                        ? 'artifact-type-option artifact-type-option--selected'
                        : 'artifact-type-option'
                    }
                    key={artifactType.code}
                  >
                    <input
                      type="radio"
                      name="artifact-type"
                      required
                      value={artifactType.code}
                      checked={type === artifactType.code}
                      onChange={(event) => setType(event.target.value)}
                    />
                    <span>
                      <strong>{artifactType.label}</strong>
                      <small>{artifactType.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-field form-field--full">
              <span>Мероприятие (необязательно)</span>
              {events.length ? (
                <div className="artifact-event-picker">
                  <label className="artifact-event-picker__search">
                    <span className="sr-only">Найти мероприятие</span>
                    <Search size={15} aria-hidden="true" />
                    <input
                      type="search"
                      disabled={Boolean(artifactIdRef.current)}
                      value={eventQuery}
                      onChange={(event) => setEventQuery(event.target.value)}
                      placeholder="Введите название мероприятия"
                    />
                  </label>
                  <select
                    aria-label="Выбрать мероприятие"
                    disabled={Boolean(artifactIdRef.current)}
                    value={eventId}
                    onChange={(event) => setEventId(event.target.value)}
                  >
                    <option value="">Без привязки к мероприятию</option>
                    {visibleEvents.map((event) => (
                      <option value={event.id} key={event.id}>
                        {event.name}
                        {event.startsAt ? ` · ${formatDate(event.startsAt)}` : ''}
                      </option>
                    ))}
                  </select>
                  <small className="artifact-event-picker__count">
                    {eventQuery.trim()
                      ? `Найдено мероприятий: ${matchingEvents.length}`
                      : `Доступно мероприятий участника: ${events.length}`}
                  </small>
                </div>
              ) : (
                <small className="form-field__hint">
                  У участника пока нет мероприятий, поэтому артефакт будет создан без привязки.
                </small>
              )}
            </div>
            <label className="form-field">
              <span>Формат</span>
              <select
                value={contentType}
                disabled={Boolean(versionIdRef.current)}
                onChange={(e) => setContentType(e.target.value as typeof contentType)}
              >
                <option value="TEXT">Текст</option>
                <option value="EXTERNAL_URL">Внешняя ссылка</option>
              </select>
            </label>
            <label className="form-field form-field--full">
              <span>{contentType === 'TEXT' ? 'Содержание' : 'Ссылка'} *</span>
              <textarea
                required
                disabled={Boolean(versionIdRef.current)}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
              />
            </label>
            <label className="form-field form-field--full">
              <span>Фактическая дата отправки *</span>
              <input
                type="datetime-local"
                required
                max={toLocalDateTimeValue(new Date(Date.now() + 5 * 60 * 1000))}
                value={submittedAt}
                onChange={(e) => setSubmittedAt(e.target.value)}
              />
            </label>
            {isBackdated && (
              <label className="form-field form-field--full">
                <span>Причина даты задним числом *</span>
                <textarea
                  required
                  minLength={3}
                  rows={2}
                  value={backdateReason}
                  onChange={(event) => setBackdateReason(event.target.value)}
                  placeholder="Например: перенос подтверждённого результата из прежней системы"
                />
              </label>
            )}
          </div>
          {versionIdRef.current && (
            <p className="form-note">
              Черновик версии уже сохранён. Повторная отправка не создаст копию.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
          <footer className="dialog__footer">
            <button type="button" className="button button--secondary" onClick={onClose}>
              Отмена
            </button>
            <button className="button button--primary" disabled={saving}>
              {saving
                ? 'Отправляем…'
                : versionIdRef.current
                  ? 'Повторить отправку'
                  : 'Создать и отправить'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function apiErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError)
    return caught.detail ? `${caught.message}: ${caught.detail}` : caught.message;
  return caught instanceof Error ? caught.message : fallback;
}
