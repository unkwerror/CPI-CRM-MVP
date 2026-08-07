'use client';

import { type FormEvent, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';

const CHANNELS = [
  { value: 'PHONE', label: 'Телефон' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'MAX', label: 'MAX' },
  { value: 'IN_PERSON', label: 'Личная встреча' },
  { value: 'OTHER', label: 'Другое' },
] as const;

type Channel = (typeof CHANNELS)[number]['value'];

/** Раньше взаимодействие фиксировалось цепочкой `window.prompt` с проверкой канала по строке. */
export function PersonInteractionDialog({
  personId,
  onClose,
  onSaved,
}: {
  personId: string;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const [channel, setChannel] = useState<Channel>('PHONE');
  const [outcome, setOutcome] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/interactions', {
        method: 'POST',
        body: JSON.stringify({
          personId,
          channel,
          direction: 'OUTBOUND',
          occurredAt: new Date().toISOString(),
          outcome: outcome.trim() || undefined,
          comment: comment.trim() || undefined,
        }),
      });
      toast.success('Взаимодействие сохранено');
      await onSaved?.();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить взаимодействие'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogDescription>Исходящее взаимодействие</DialogDescription>
          <DialogTitle>Зафиксировать контакт</DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Канал</Label>
              <Select onValueChange={(next) => setChannel(next as Channel)} value={channel}>
                <SelectTrigger aria-label="Канал взаимодействия">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="person-interaction-outcome">Результат</Label>
              <Input
                autoFocus
                id="person-interaction-outcome"
                onChange={(event) => setOutcome(event.target.value)}
                placeholder="Например: договорились о встрече"
                value={outcome}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="person-interaction-comment">Комментарий</Label>
              <Textarea
                id="person-interaction-comment"
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                value={comment}
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
