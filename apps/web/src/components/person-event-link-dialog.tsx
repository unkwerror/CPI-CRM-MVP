'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
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
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import { EVENT_STATUS_LABELS } from '@/lib/status-labels';
import type { EventSummary } from '@/lib/types';

export function PersonEventLinkDialog({
  personId,
  existingEventIds,
  onClose,
  onLinked,
}: {
  personId: string;
  existingEventIds: readonly string[];
  onClose: () => void;
  onLinked: () => Promise<void> | void;
}) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<{ items: EventSummary[] }>('/events?limit=200')
      .then((response) => setEvents(response.items))
      .catch((caught) => toast.error(apiErrorMessage(caught, 'Не удалось загрузить мероприятия')))
      .finally(() => setLoading(false));
  }, []);

  const available = useMemo(() => {
    const existing = new Set(existingEventIds);
    return events.filter((event) => !existing.has(event.id));
  }, [events, existingEventIds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!eventId) return;
    setSaving(true);
    try {
      await api(`/events/${eventId}/participants`, {
        method: 'POST',
        body: JSON.stringify({ personId }),
      });
      toast.success('Участник добавлен в мероприятие');
      await onLinked();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось добавить участника'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить в мероприятие</DialogTitle>
          <DialogDescription>
            Связь сразу появится в карточках участника и мероприятия.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={submit}>
          <DialogBody>
            <div className="space-y-1.5">
              <Label>Мероприятие *</Label>
              <Select disabled={loading || saving} onValueChange={setEventId} value={eventId}>
                <SelectTrigger aria-label="Мероприятие">
                  <SelectValue placeholder={loading ? 'Загружаем…' : 'Выберите мероприятие'} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                      {item.startsAt ? ` · ${formatDate(item.startsAt)}` : ''}
                      {item.status ? ` · ${EVENT_STATUS_LABELS[item.status] ?? item.status}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && available.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Участник уже связан со всеми доступными мероприятиями.
                </p>
              )}
            </div>
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
