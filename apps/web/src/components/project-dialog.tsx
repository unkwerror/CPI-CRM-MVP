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
import type { ProjectDetail, ProjectSummary } from '@/lib/types';

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  IDEA: 'Идея',
  ACTIVE: 'В работе',
  PAUSED: 'На паузе',
  COMPLETED: 'Завершён',
  ARCHIVED: 'Архив',
};

export const PROJECT_STATUS_ORDER = ['IDEA', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'];

function localDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project?: ProjectDetail | ProjectSummary | null;
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState(project?.status ?? 'ACTIVE');
  const [startsAt, setStartsAt] = useState(localDateTime(project?.startsAt));
  const [endsAt, setEndsAt] = useState(localDateTime(project?.endsAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!startsAt && endsAt) {
      setError('Укажите дату начала перед датой окончания.');
      return;
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError('Дата окончания должна быть позже даты начала.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(project ? { version: project.version } : {}),
        name: name.trim(),
        ...(description.trim()
          ? { description: description.trim() }
          : project
            ? { description: null }
            : {}),
        status,
        ...(startsAt
          ? { startsAt: new Date(startsAt).toISOString() }
          : project
            ? { startsAt: null }
            : {}),
        ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : project ? { endsAt: null } : {}),
      };
      const saved = await api<{ id: string }>(project ? `/projects/${project.id}` : '/projects', {
        method: project ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(project ? 'Проект обновлён' : 'Проект создан');
      await onSaved(saved.id);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить проект'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogDescription>{project ? 'Карточка проекта' : 'Новый проект'}</DialogDescription>
          <DialogTitle>{project ? 'Редактировать проект' : 'Создать проект'}</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Название *</Label>
              <Input
                autoFocus
                id="project-name"
                maxLength={500}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Описание</Label>
              <Textarea
                id="project-description"
                maxLength={10_000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Что делает проект, его цели и текущий этап"
                rows={5}
                value={description}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select onValueChange={setStatus} value={status}>
                  <SelectTrigger aria-label="Статус проекта">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUS_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PROJECT_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-start">Начало</Label>
                <Input
                  id="project-start"
                  onChange={(event) => {
                    setStartsAt(event.target.value);
                    if (!event.target.value) setEndsAt('');
                  }}
                  type="datetime-local"
                  value={startsAt}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-end">Окончание</Label>
                <Input
                  disabled={!startsAt}
                  id="project-end"
                  min={startsAt || undefined}
                  onChange={(event) => setEndsAt(event.target.value)}
                  type="datetime-local"
                  value={endsAt}
                />
              </div>
            </div>
            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
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
