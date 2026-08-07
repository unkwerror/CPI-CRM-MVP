'use client';

import { CheckIcon, SearchIcon, UserPlusIcon, UsersIcon, XIcon } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiErrorMessage } from '@/lib/api';
import { EVENT_STATUS_LABELS, EVENT_STATUS_ORDER } from '@/lib/status-labels';
import type { PeopleResponse, PersonSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

type EventStatus = (typeof EVENT_STATUS_ORDER)[number];

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
      toast.success('Мероприятие создано');
      onCreated(result.id);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось создать мероприятие'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Новое мероприятие</DialogDescription>
          <DialogTitle>Создать мероприятие</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="contents">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="event-name">Название *</Label>
              <Input
                id="event-name"
                autoFocus
                maxLength={500}
                minLength={2}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Демо-день акселератора"
                required
                value={name}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select value={status} onValueChange={(next) => setStatus(next as EventStatus)}>
                  <SelectTrigger aria-label="Статус мероприятия">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_STATUS_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {EVENT_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-start">Начало</Label>
                <Input
                  id="event-start"
                  onChange={(event) => {
                    setStartsAt(event.target.value);
                    if (!event.target.value) setEndsAt('');
                  }}
                  type="datetime-local"
                  value={startsAt}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-end">Окончание</Label>
                <Input
                  id="event-end"
                  disabled={!startsAt}
                  min={startsAt || undefined}
                  onChange={(event) => setEndsAt(event.target.value)}
                  type="datetime-local"
                  value={endsAt}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Участники</Label>
              <div className="relative">
                <SearchIcon
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Поиск участника"
                  className="pl-9"
                  onChange={(event) => setParticipantQuery(event.target.value)}
                  placeholder="Введите ФИО или контакт…"
                  value={participantQuery}
                />
              </div>

              {selected.length > 0 && (
                <div className="bg-muted/50 space-y-2 rounded-lg border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
                      <UsersIcon className="size-3.5" /> Выбрано: {selected.length}
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setSelected([])}>
                      Очистить
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.map((person) => (
                      <Badge key={person.id} variant="soft-primary" asChild>
                        <button
                          type="button"
                          aria-label={`Убрать ${person.canonicalFullName}`}
                          onClick={() => toggleParticipant(person)}
                        >
                          {person.canonicalFullName}
                          <XIcon />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div
                aria-busy={participantsLoading}
                aria-label="Результаты поиска участников"
                className="scrollbar-thin max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1"
                role="listbox"
              >
                {participantsLoading ? (
                  <div className="space-y-1 p-1">
                    {Array.from({ length: 3 }, (_, index) => (
                      <Skeleton key={index} className="h-11 rounded-md" />
                    ))}
                  </div>
                ) : participantsError ? (
                  <p className="text-destructive p-3 text-[13px]">{participantsError}</p>
                ) : participants.length === 0 ? (
                  <p className="text-muted-foreground p-3 text-[13px]">Участники не найдены</p>
                ) : (
                  participants.map((person) => {
                    const isSelected = selectedIds.has(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => toggleParticipant(person)}
                        className={cn(
                          'hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                          isSelected && 'bg-primary/10',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-md border',
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'text-muted-foreground',
                          )}
                        >
                          {isSelected ? (
                            <CheckIcon className="size-4" />
                          ) : (
                            <UserPlusIcon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate text-[13px] font-medium">
                            {person.canonicalFullName}
                          </strong>
                          <small className="text-muted-foreground block truncate text-xs">
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
              <p className="text-muted-foreground text-xs">
                Участников можно добавить и позже — для создания мероприятия это необязательно.
              </p>
            </div>

            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving || name.trim().length < 2}>
              {saving ? 'Создаём…' : 'Создать мероприятие'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
