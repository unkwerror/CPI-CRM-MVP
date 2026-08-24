'use client';

import { FolderKanbanIcon, PencilIcon, PlusIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { PROJECT_STATUS_LABELS } from '@/components/project-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';
import type { EventProjectSummary, ProjectSummary } from '@/lib/types';

export function EventProjectsTab({
  eventId,
  canWrite,
  onChanged,
}: {
  eventId: string;
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<EventProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<EventProjectSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<{ items: EventProjectSummary[] }>(`/events/${eventId}/projects`);
      setItems(response.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить проекты мероприятия'));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => void load(), [load]);

  if (loading) return <Skeleton className="h-64 rounded-xl" />;
  if (error)
    return (
      <Card>
        <EmptyState title="Ошибка загрузки" text={error} />
      </Card>
    );
  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => setShowAdd(true)} size="sm">
            <PlusIcon /> Добавить проект
          </Button>
        </div>
      )}
      {!items.length ? (
        <Card>
          <EmptyState
            icon={FolderKanbanIcon}
            title="Проектов пока нет"
            text="Добавьте проект — все его участники автоматически попадут в мероприятие без дублей."
          />
        </Card>
      ) : (
        items.map((project) => (
          <Card key={project.participationId}>
            <CardHeader>
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Проект
                </p>
                <CardTitle className="mt-1.5">
                  <Link className="hover:underline" href={`/projects/${project.id}`}>
                    {project.name}
                  </Link>
                </CardTitle>
                <p className="text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-xs">
                  <UsersIcon className="size-3.5" />
                  {project.memberCount} участников · {project.artifactCount} артефактов
                </p>
              </div>
              <CardAction>
                <Badge variant={project.status === 'ACTIVE' ? 'soft-success' : 'soft-muted'}>
                  {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.description && (
                <p className="text-muted-foreground text-[13px]">{project.description}</p>
              )}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-medium">Результат проекта</p>
                  <p className="text-muted-foreground mt-1 text-[13px] whitespace-pre-wrap">
                    {project.result ?? 'Пока не заполнен.'}
                  </p>
                </div>
                {canWrite && (
                  <Button onClick={() => setEditing(project)} size="xs" variant="ghost">
                    <PencilIcon /> Изменить
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
      {showAdd && (
        <AddProjectDialog
          eventId={eventId}
          existingIds={items.map((item) => item.id)}
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false);
            await Promise.all([load(), onChanged()]);
          }}
        />
      )}
      {editing && (
        <EditProjectResultDialog
          eventId={eventId}
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddProjectDialog({
  eventId,
  existingIds,
  onClose,
  onSaved,
}: {
  eventId: string;
  existingIds: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [result, setResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: ProjectSummary[] }>('/projects?limit=200')
      .then((response) =>
        setProjects(response.items.filter((project) => !existingIds.includes(project.id))),
      )
      .catch((caught) => setError(apiErrorMessage(caught, 'Не удалось загрузить проекты')));
  }, [existingIds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!projectId) return;
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
        `Проект добавлен. Новых участников: ${response.participantsAdded} из ${response.projectMemberCount}.`,
      );
      await onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось добавить проект'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogDescription>Уже присутствующие участники будут пропущены</DialogDescription>
          <DialogTitle>Добавить проект в мероприятие</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Проект *</Label>
              <Select onValueChange={setProjectId} value={projectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите проект" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name} · {project.memberCount} участников
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!projects.length && !error && (
                <p className="text-muted-foreground text-xs">Нет доступных проектов.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-project-result">Результат проекта</Label>
              <Textarea
                id="event-project-result"
                maxLength={10_000}
                onChange={(event) => setResult(event.target.value)}
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
            <Button disabled={saving || !projectId} type="submit">
              {saving ? 'Добавляем…' : 'Добавить проект'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectResultDialog({
  eventId,
  project,
  onClose,
  onSaved,
}: {
  eventId: string;
  project: EventProjectSummary;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [result, setResult] = useState(project.result ?? '');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/events/${eventId}/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ result: result.trim() || null }),
      });
      toast.success('Результат сохранён');
      await onSaved();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить результат'));
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogDescription>{project.name}</DialogDescription>
          <DialogTitle>Результат проекта</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogBody>
            <Textarea
              autoFocus
              maxLength={10_000}
              onChange={(event) => setResult(event.target.value)}
              rows={5}
              value={result}
            />
          </DialogBody>
          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving} type="submit">
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
