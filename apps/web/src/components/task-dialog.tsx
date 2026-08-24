'use client';

import { DownloadIcon, PaperclipIcon, TrashIcon } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PersonPicker, type PersonOption } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from '@/lib/status-labels';
import type { TaskAssignee, TaskStatus, TaskSummary } from '@/lib/types';
import { UPLOAD_ACCEPT, uploadFile } from '@/lib/upload';

const DEFAULT_ASSIGNEE = 'CURRENT_USER';

function toDateInput(value?: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

/**
 * Единый диалог создания и редактирования задачи. Раньше задача заводилась через
 * `window.prompt`, без срока, описания и признака следующего шага.
 */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  person,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Передан — режим редактирования, иначе создание. */
  task?: TaskSummary | null;
  /** Предзаполненный участник; в режиме создания без него выбор обязателен. */
  person?: PersonOption | null;
  onSaved: () => void;
}) {
  const editing = Boolean(task);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<TaskStatus>('OPEN');
  const [isNextStep, setIsNextStep] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonOption | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assigneeUserId, setAssigneeUserId] = useState(DEFAULT_ASSIGNEE);
  const [files, setFiles] = useState<NonNullable<TaskSummary['attachments']>>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setDueDate(toDateInput(task?.dueAt));
    setStatus(task?.status ?? 'OPEN');
    setIsNextStep(task?.isNextStep ?? false);
    setSelectedPerson(
      person ??
        (task?.personId && task.personName
          ? { id: task.personId, canonicalFullName: task.personName }
          : null),
    );
    setAssigneeUserId(task?.assigneeUserId ?? DEFAULT_ASSIGNEE);
    setFiles(task?.attachments ?? []);
    void api<{ currentUserId: string; items: TaskAssignee[] }>('/task-assignees')
      .then((response) => {
        setCurrentUserId(response.currentUserId);
        setAssignees(response.items);
      })
      .catch(() => setAssignees([]));
  }, [open, person, task]);

  async function attachFiles(selected: FileList | null) {
    const chosen = Array.from(selected ?? []);
    if (!chosen.length) return;
    setUploading(true);
    try {
      for (const file of chosen) {
        const id = await uploadFile(file);
        setFiles((current) => [
          ...current,
          { id, fileName: file.name, sizeBytes: file.size, status: 'AVAILABLE' },
        ]);
      }
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось приложить файл'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function downloadFile(fileId: string) {
    try {
      const response = await api<{ downloadUrl: string }>(`/files/${fileId}/download-url`);
      window.open(response.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось скачать файл'));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    // Полдень выбранного дня: дата без времени в UTC уезжала на предыдущие сутки.
    const dueAt = dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null;
    try {
      if (task) {
        await api(`/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            version: task.version ?? 1,
            title: title.trim(),
            description: description.trim() || null,
            dueAt,
            status,
            isNextStep,
            assigneeUserId:
              assigneeUserId === DEFAULT_ASSIGNEE
                ? (currentUserId ?? task.assigneeUserId)
                : assigneeUserId,
            fileObjectIds: files.map((file) => file.id),
          }),
        });
        toast.success('Задача обновлена');
      } else {
        if (!selectedPerson) {
          toast.error('Выберите участника');
          setSaving(false);
          return;
        }
        await api('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            personId: selectedPerson.id,
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(dueAt ? { dueAt } : {}),
            isNextStep,
            ...(assigneeUserId === DEFAULT_ASSIGNEE ? {} : { assigneeUserId }),
            fileObjectIds: files.map((file) => file.id),
          }),
        });
        toast.success('Задача создана');
      }
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить задачу'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Задача' : 'Новая задача'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Измените срок, статус или содержание задачи.'
              : 'Задача попадёт в вашу очередь и в карточку участника.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="space-y-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label>Участник *</Label>
                <PersonPicker
                  value={selectedPerson}
                  onChange={setSelectedPerson}
                  disabled={Boolean(person) || saving}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="task-title">Что нужно сделать *</Label>
              <Input
                id="task-title"
                autoFocus
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например, согласовать состав команды"
                required
                value={title}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Срок</Label>
                <Input
                  id="task-due"
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                  value={dueDate}
                />
              </div>
              {editing && (
                <div className="space-y-1.5">
                  <Label>Статус</Label>
                  <Select value={status} onValueChange={(next) => setStatus(next as TaskStatus)}>
                    <SelectTrigger aria-label="Статус задачи">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_STATUS_ORDER.map((value) => (
                        <SelectItem key={value} value={value}>
                          {TASK_STATUS_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editing && <div />}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Исполнитель</Label>
                <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
                  <SelectTrigger aria-label="Исполнитель задачи">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_ASSIGNEE}>Я (по умолчанию)</SelectItem>
                    {assignees
                      .filter((assignee) => assignee.id !== currentUserId)
                      .map((assignee) => (
                        <SelectItem key={assignee.id} value={assignee.id}>
                          {assignee.displayName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-description">Комментарий</Label>
              <Textarea
                id="task-description"
                maxLength={10_000}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                placeholder="Необязательно"
                value={description}
              />
            </div>

            <div className="space-y-2">
              <Label>Вложение</Label>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept={UPLOAD_ACCEPT}
                multiple
                disabled={saving || uploading || files.length >= 10}
                onChange={(event) => void attachFiles(event.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={saving || uploading || files.length >= 10}
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon /> {uploading ? 'Загружаем…' : 'Прикрепить файл'}
              </Button>
              {files.length > 0 && (
                <ul className="space-y-1.5">
                  {files.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-[13px]"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left hover:underline"
                        onClick={() => void downloadFile(file.id)}
                      >
                        <DownloadIcon className="mr-1.5 inline size-3.5" />
                        {file.fileName}
                        <span className="text-muted-foreground">
                          {' '}
                          · {formatBytes(file.sizeBytes)}
                        </span>
                      </button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Убрать ${file.fileName}`}
                        onClick={() =>
                          setFiles((current) => current.filter((item) => item.id !== file.id))
                        }
                      >
                        <TrashIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={isNextStep}
                onCheckedChange={(checked) => setIsNextStep(checked === true)}
              />
              <span className="text-[13px] leading-snug">
                Следующий шаг по участнику
                <span className="text-muted-foreground block text-xs">
                  У участника может быть только один активный следующий шаг — прежний признак
                  снимется автоматически.
                </span>
              </span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={saving || uploading || title.trim().length === 0}>
              {saving ? 'Сохраняем…' : editing ? 'Сохранить' : 'Создать задачу'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
