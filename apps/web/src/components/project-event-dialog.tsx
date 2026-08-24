'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { EventSummary } from '@/lib/types';

export function ProjectEventDialog({
  projectId,
  existingEventIds,
  onClose,
  onSaved,
}: {
  projectId: string;
  existingEventIds: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState('');
  const [result, setResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: EventSummary[] }>('/events?limit=200')
      .then((response) =>
        setEvents(response.items.filter((event) => !existingEventIds.includes(event.id))),
      )
      .catch((caught) => setError(apiErrorMessage(caught, 'Не удалось загрузить мероприятия')));
  }, [existingEventIds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!eventId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await api<{ projectMemberCount: number; participantsAdded: number }>(
        `/events/${eventId}/projects`,
        {
          method: 'POST',
          body: JSON.stringify({ projectId, ...(result.trim() ? { result: result.trim() } : {}) }),
        },
      );
      toast.success(
        `Проект добавлен. В мероприятие добавлено новых участников: ${response.participantsAdded} из ${response.projectMemberCount}.`,
      );
      await onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось добавить проект в мероприятие'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogDescription>Все участники проекта будут добавлены без дублей</DialogDescription>
          <DialogTitle>Добавить проект в мероприятие</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Мероприятие *</Label>
              <Select onValueChange={setEventId} value={eventId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите мероприятие" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                      {item.startsAt ? ` · ${formatDate(item.startsAt)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!events.length && !error && (
                <p className="text-muted-foreground text-xs">Нет доступных мероприятий.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-event-result">Результат проекта</Label>
              <Textarea
                id="project-event-result"
                maxLength={10_000}
                onChange={(event) => setResult(event.target.value)}
                placeholder="Можно заполнить сейчас или позднее"
                rows={3}
                value={result}
              />
            </div>
            {error && <p className="text-destructive text-[13px]">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving || !eventId} type="submit">
              {saving ? 'Добавляем…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
