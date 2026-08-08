'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PersonPicker, type PersonOption } from '@/components/person-picker';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';
import type { LockerPendingSubmission } from '@/lib/types';

type Action = 'attach' | 'create' | 'reject';

const RUSSIAN_FIO = /^[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*(?: [А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*){2}$/u;

/** Подставляем то, что человек написал в боте: часто не хватает только отчества. */
function suggestFullName(reported: string): string {
  return reported.trim().replace(/\s+/gu, ' ');
}

export function PendingResolveDialog({
  item,
  onOpenChange,
  onResolved,
}: {
  item: LockerPendingSubmission | null;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const [action, setAction] = useState<Action>('attach');
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [fullName, setFullName] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAction('attach');
    setPerson(null);
    setFullName(suggestFullName(item.reportedFullName));
    setReason('');
  }, [item]);

  const nameValid = RUSSIAN_FIO.test(fullName.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      toast.error('Опишите решение — это попадёт в журнал действий');
      return;
    }
    if (action === 'attach' && !person) {
      toast.error('Выберите участника');
      return;
    }
    if (action === 'create' && !nameValid) {
      toast.error('Нужны фамилия, имя и отчество русскими буквами');
      return;
    }

    setSaving(true);
    try {
      if (action === 'attach') {
        await api(`/locker/pending/${item.id}/attach`, {
          method: 'POST',
          body: JSON.stringify({ personId: person!.id, reason: trimmedReason }),
        });
        toast.success('Отправка привязана к участнику');
      } else if (action === 'create') {
        await api(`/locker/pending/${item.id}/create-person`, {
          method: 'POST',
          body: JSON.stringify({ fullName: fullName.trim(), reason: trimmedReason }),
        });
        toast.success('Участник заведён, отправка принята');
      } else {
        await api(`/locker/pending/${item.id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason: trimmedReason }),
        });
        toast.success('Заявка отклонена');
      }
      onResolved();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось обработать заявку'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Разбор заявки из бота</DialogTitle>
            <DialogDescription>
              {item
                ? `${item.reportedFullName} · ${item.telegram} · ${item.eventTitle}`
                : null}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Tabs value={action} onValueChange={(value) => setAction(value as Action)}>
              <TabsList className="w-full">
                <TabsTrigger value="attach" className="flex-1">
                  К участнику
                </TabsTrigger>
                <TabsTrigger value="create" className="flex-1">
                  Новая карточка
                </TabsTrigger>
                <TabsTrigger value="reject" className="flex-1">
                  Отклонить
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {action === 'attach' && (
              <div className="space-y-1.5">
                <Label>Участник</Label>
                <PersonPicker value={person} onChange={setPerson} disabled={saving} />
                <p className="text-muted-foreground text-xs">
                  Отправка и её файлы будут привязаны к этой карточке, а Telegram участника
                  запомнится для следующих отправок.
                </p>
              </div>
            )}

            {action === 'create' && (
              <div className="space-y-1.5">
                <Label htmlFor="pending-full-name">Фамилия Имя Отчество</Label>
                <Input
                  id="pending-full-name"
                  value={fullName}
                  disabled={saving}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Иванов Иван Иванович"
                />
                {!nameValid && fullName.trim().length > 0 && (
                  <p className="text-destructive text-xs">
                    Нужны три части русскими буквами — в боте участник указал «
                    {item?.reportedFullName}».
                  </p>
                )}
              </div>
            )}

            {action === 'reject' && (
              <p className="text-muted-foreground text-[13px]">
                Заявка уйдёт из очереди, участник и артефакт в CRM не появятся. Файлы останутся в
                боте.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pending-reason">Основание</Label>
              <Textarea
                id="pending-reason"
                rows={2}
                value={reason}
                disabled={saving}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Например: тот же человек, отчество уточнили в чате"
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant={action === 'reject' ? 'destructive' : 'default'}
              disabled={saving}
            >
              {action === 'reject' ? 'Отклонить' : 'Принять'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
