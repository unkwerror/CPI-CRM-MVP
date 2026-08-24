'use client';

import { PaperclipIcon, TrashIcon } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
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
import { api, apiErrorMessage, formatBytes } from '@/lib/api';
import type { TaskAssignee } from '@/lib/types';
import { UPLOAD_ACCEPT, uploadFile } from '@/lib/upload';

const CHANNELS = [
  { value: 'PHONE', label: 'Телефон' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'MAX', label: 'MAX' },
  { value: 'IN_PERSON', label: 'Личная встреча' },
  { value: 'NOTE', label: 'Заметка' },
  { value: 'OTHER', label: 'Другое' },
] as const;

type Channel = (typeof CHANNELS)[number]['value'];
type Direction = 'OUTBOUND' | 'INBOUND' | 'INTERNAL';

const DEFAULT_ASSIGNEE = 'CURRENT_USER';

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  const [direction, setDirection] = useState<Direction>('OUTBOUND');
  const [occurredAt, setOccurredAt] = useState(toLocalDateTimeValue(new Date()));
  const [outcome, setOutcome] = useState('');
  const [comment, setComment] = useState('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [assigneeUserId, setAssigneeUserId] = useState(DEFAULT_ASSIGNEE);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ id: string; fileName: string; sizeBytes: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<{ currentUserId: string; items: TaskAssignee[] }>('/task-assignees')
      .then((response) => {
        setCurrentUserId(response.currentUserId);
        setAssignees(response.items);
      })
      .catch(() => setAssignees([]));
  }, []);

  async function attachFiles(selected: FileList | null) {
    const chosen = Array.from(selected ?? []);
    if (!chosen.length) return;
    setUploading(true);
    try {
      for (const file of chosen) {
        const id = await uploadFile(file);
        setFiles((current) => [...current, { id, fileName: file.name, sizeBytes: file.size }]);
      }
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось приложить файл'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/interactions', {
        method: 'POST',
        body: JSON.stringify({
          personId,
          channel,
          direction,
          occurredAt: new Date(occurredAt).toISOString(),
          outcome: outcome.trim() || undefined,
          comment: comment.trim() || undefined,
          responsibleUserId:
            assigneeUserId === DEFAULT_ASSIGNEE ? (currentUserId ?? undefined) : assigneeUserId,
          nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null,
          fileObjectIds: files.map((file) => file.id),
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Контакт, встреча или внутренняя заметка</DialogDescription>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Направление</Label>
                <Select
                  onValueChange={(value) => setDirection(value as Direction)}
                  value={direction}
                >
                  <SelectTrigger aria-label="Направление взаимодействия">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OUTBOUND">Исходящее</SelectItem>
                    <SelectItem value="INBOUND">Входящее</SelectItem>
                    <SelectItem value="INTERNAL">Внутренняя запись</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-interaction-date">Дата и время</Label>
                <Input
                  id="person-interaction-date"
                  onChange={(event) => setOccurredAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={occurredAt}
                />
              </div>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Ответственный</Label>
                <Select onValueChange={setAssigneeUserId} value={assigneeUserId}>
                  <SelectTrigger aria-label="Ответственный за взаимодействие">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_ASSIGNEE}>Я</SelectItem>
                    {assignees
                      .filter((item) => item.id !== currentUserId)
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.displayName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-interaction-next">Следующий контакт</Label>
                <Input
                  id="person-interaction-next"
                  onChange={(event) => setNextContactAt(event.target.value)}
                  type="datetime-local"
                  value={nextContactAt}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Файл</Label>
              <input
                accept={UPLOAD_ACCEPT}
                className="hidden"
                multiple
                onChange={(event) => void attachFiles(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={uploading || files.length >= 10}
                onClick={() => fileInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <PaperclipIcon /> {uploading ? 'Загружаем…' : 'Приложить файл'}
              </Button>
              {files.map((file) => (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2" key={file.id}>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{file.fileName}</span>
                  <small className="text-muted-foreground">{formatBytes(file.sizeBytes)}</small>
                  <Button
                    aria-label={`Убрать файл ${file.fileName}`}
                    onClick={() => setFiles((items) => items.filter((item) => item.id !== file.id))}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              ))}
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
            <Button disabled={saving || uploading} type="submit">
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
