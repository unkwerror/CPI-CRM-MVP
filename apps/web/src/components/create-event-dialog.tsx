'use client';

import { Check, Search, UserPlus, Users, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import type { PeopleResponse, PersonSummary } from '@/lib/types';

const EVENT_STATUSES = [
  { value: 'PLANNED', label: 'Запланировано' },
  { value: 'ACTIVE', label: 'Идёт' },
  { value: 'COMPLETED', label: 'Завершено' },
  { value: 'CANCELLED', label: 'Отменено' },
] as const;

type EventStatus = (typeof EVENT_STATUSES)[number]['value'];

export function CreateEventDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<EventStatus>('PLANNED');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [participantQuery, setParticipantQuery] = useState('');
  const [participants, setParticipants] = useState<PersonSummary[]>([]);
  const [selected, setSelected] = useState<PersonSummary[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(true);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setParticipantsLoading(true);
      setParticipantsError(null);
      const params = new URLSearchParams({ limit: '20' });
      if (participantQuery.trim()) params.set('q', participantQuery.trim());
      try {
        const response = await api<PeopleResponse>(`/people?${params}`, {
          signal: controller.signal,
        });
        setParticipants(response.items);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setParticipantsError('Не удалось загрузить участников');
      } finally {
        if (!controller.signal.aborted) setParticipantsLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [participantQuery]);

  const selectedIds = useMemo(() => new Set(selected.map((person) => person.id)), [selected]);

  function toggleParticipant(person: PersonSummary) {
    setSelected((current) =>
      current.some((item) => item.id === person.id)
        ? current.filter((item) => item.id !== person.id)
        : [...current, person],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!startsAt && endsAt) {
      setError('Укажите дату начала перед датой окончания');
      return;
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError('Дата окончания должна быть позже даты начала');
      return;
    }

    setSaving(true);
    try {
      const result = await api<{ id: string }>('/events', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          name: name.trim(),
          status,
          startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
          endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
          participantIds: selected.map((person) => person.id),
        }),
      });
      onCreated(result.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось создать мероприятие',
      );
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section
        aria-labelledby="create-event-title"
        aria-modal="true"
        className="dialog create-event-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Новое мероприятие</p>
            <h2 id="create-event-title">Создать мероприятие</h2>
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
                placeholder="Например, Демо-день акселератора"
                required
                value={name}
              />
            </label>

            <label className="form-field">
              <span>Статус</span>
              <select
                onChange={(event) => setStatus(event.target.value as EventStatus)}
                value={status}
              >
                {EVENT_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <span aria-hidden="true" className="create-event-dialog__spacer" />

            <label className="form-field">
              <span>Начало (ваше местное время)</span>
              <input
                onChange={(event) => {
                  setStartsAt(event.target.value);
                  if (!event.target.value) setEndsAt('');
                }}
                type="datetime-local"
                value={startsAt}
              />
            </label>

            <label className="form-field">
              <span>Окончание (ваше местное время)</span>
              <input
                disabled={!startsAt}
                min={startsAt || undefined}
                onChange={(event) => setEndsAt(event.target.value)}
                type="datetime-local"
                value={endsAt}
              />
            </label>

            <div className="form-field form-field--full">
              <span>Участники</span>
              <div className="event-participant-picker">
                <label className="event-participant-picker__search">
                  <Search size={16} />
                  <input
                    aria-label="Поиск участника"
                    onChange={(event) => setParticipantQuery(event.target.value)}
                    placeholder="Введите ФИО или контакт…"
                    value={participantQuery}
                  />
                  {participantQuery && (
                    <button
                      aria-label="Очистить поиск"
                      onClick={() => setParticipantQuery('')}
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>

                {selected.length > 0 && (
                  <div className="event-participant-picker__selected">
                    <div className="event-participant-picker__selected-heading">
                      <span>
                        <Users size={14} /> Выбрано: {selected.length}
                      </span>
                      <button onClick={() => setSelected([])} type="button">
                        Очистить
                      </button>
                    </div>
                    <div className="event-participant-picker__chips">
                      {selected.map((person) => (
                        <button
                          aria-label={`Убрать ${person.canonicalFullName}`}
                          className="event-participant-chip"
                          key={person.id}
                          onClick={() => toggleParticipant(person)}
                          type="button"
                        >
                          {person.canonicalFullName} <X size={12} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  aria-busy={participantsLoading}
                  aria-label="Результаты поиска участников"
                  className="event-participant-picker__results"
                  role="listbox"
                >
                  {participantsLoading ? (
                    <p className="event-participant-picker__message">Ищем участников…</p>
                  ) : participantsError ? (
                    <p className="event-participant-picker__message event-participant-picker__message--error">
                      {participantsError}
                    </p>
                  ) : participants.length === 0 ? (
                    <p className="event-participant-picker__message">Участники не найдены</p>
                  ) : (
                    participants.map((person) => {
                      const isSelected = selectedIds.has(person.id);
                      return (
                        <button
                          aria-selected={isSelected}
                          className={
                            isSelected
                              ? 'event-participant-option event-participant-option--selected'
                              : 'event-participant-option'
                          }
                          key={person.id}
                          onClick={() => toggleParticipant(person)}
                          role="option"
                          type="button"
                        >
                          <span className="event-participant-option__icon">
                            {isSelected ? <Check size={15} /> : <UserPlus size={15} />}
                          </span>
                          <span>
                            <strong>{person.canonicalFullName}</strong>
                            <small>
                              {[person.primaryContact, person.organization]
                                .filter(Boolean)
                                .join(' · ') || 'Без дополнительных данных'}
                            </small>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <small className="form-field__hint">
                Выберите участников из реестра; для создания мероприятия это необязательно.
              </small>
            </div>
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
              {saving ? 'Создаём…' : 'Создать мероприятие'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
