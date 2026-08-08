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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';

type Mode = 'archive' | 'delete';

export function PersonRemovalDialog({
  personId,
  personName,
  version,
  canDelete,
  open,
  onOpenChange,
  onRemoved,
}: {
  personId: string;
  personName: string;
  version: number;
  canDelete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: (mode: Mode) => void;
}) {
  const [mode, setMode] = useState<Mode>('archive');
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('archive');
    setReason('');
    setConfirmName('');
  }, [open]);

  const nameMatches = confirmName.trim().toLowerCase() === personName.trim().toLowerCase();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      toast.error('Опишите причину — она попадёт в журнал действий');
      return;
    }
    if (mode === 'delete' && !nameMatches) {
      toast.error('ФИО подтверждения не совпадает');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'archive') {
        await api(`/people/${personId}/archive`, {
          method: 'POST',
          body: JSON.stringify({ version, reason: trimmedReason }),
        });
        toast.success('Участник убран из активной базы');
      } else {
        await api(`/people/${personId}`, {
          method: 'DELETE',
          body: JSON.stringify({ reason: trimmedReason, confirmFullName: confirmName.trim() }),
        });
        toast.success('Участник удалён безвозвратно');
      }
      onOpenChange(false);
      onRemoved(mode);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось выполнить операцию'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Убрать участника</DialogTitle>
            <DialogDescription>{personName}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {canDelete ? (
              <Tabs onValueChange={(value) => setMode(value as Mode)} value={mode}>
                <TabsList>
                  <TabsTrigger value="archive">В архив</TabsTrigger>
                  <TabsTrigger value="delete">Удалить навсегда</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}

            <p className="text-sm text-muted-foreground">
              {mode === 'archive'
                ? 'Карточка, контакты и участия перестанут попадать в списки, выгрузки и аудитории рассылок. История и артефакты сохранятся, участника можно будет вернуть.'
                : 'Карточка, контакты, участия и связи будут стёрты. Артефакты мероприятий останутся, но потеряют авторство. Останется только запись в журнале и отпечатки контактов, чтобы повторный импорт не завёл человека заново.'}
            </p>

            <div className="space-y-2">
              <Label htmlFor="removal-reason">Причина</Label>
              <Textarea
                id="removal-reason"
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  mode === 'archive'
                    ? 'Например: не отвечает больше года, данных для связи нет'
                    : 'Например: требование участника об удалении персональных данных от 08.08.2026'
                }
                rows={3}
                value={reason}
              />
            </div>

            {mode === 'delete' ? (
              <div className="space-y-2">
                <Label htmlFor="removal-confirm">Введите ФИО участника для подтверждения</Label>
                <Input
                  autoComplete="off"
                  id="removal-confirm"
                  onChange={(event) => setConfirmName(event.target.value)}
                  placeholder={personName}
                  value={confirmName}
                />
                {confirmName.trim() && !nameMatches ? (
                  <p className="text-sm text-destructive">ФИО не совпадает</p>
                ) : null}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Отмена
            </Button>
            <Button
              disabled={saving || (mode === 'delete' && !nameMatches)}
              type="submit"
              variant={mode === 'delete' ? 'destructive' : 'default'}
            >
              {mode === 'delete' ? 'Удалить навсегда' : 'В архив'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
