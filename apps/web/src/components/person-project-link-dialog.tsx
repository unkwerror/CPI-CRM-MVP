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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, apiErrorMessage } from '@/lib/api';
import type { ProjectSummary } from '@/lib/types';

export function PersonProjectLinkDialog({
  personId,
  existingProjectIds,
  onClose,
  onLinked,
}: {
  personId: string;
  existingProjectIds: readonly string[];
  onClose: () => void;
  onLinked: () => Promise<void> | void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState('Участник');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<{ items: ProjectSummary[] }>('/projects?limit=200')
      .then((response) => setProjects(response.items))
      .catch((caught) => toast.error(apiErrorMessage(caught, 'Не удалось загрузить проекты')))
      .finally(() => setLoading(false));
  }, []);

  const available = useMemo(() => {
    const existing = new Set(existingProjectIds);
    return projects.filter((project) => !existing.has(project.id));
  }, [projects, existingProjectIds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !role.trim()) return;
    setSaving(true);
    try {
      const result = await api<{ addedToEvents: number }>(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ personId, role: role.trim() }),
      });
      toast.success(
        result.addedToEvents > 0
          ? `Участник добавлен в проект и в ${result.addedToEvents} мероприятий`
          : 'Участник добавлен в проект',
      );
      await onLinked();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось добавить участника в проект'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить в проект</DialogTitle>
          <DialogDescription>
            Если проект уже связан с мероприятиями, участник будет добавлен и в них без дублей.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={submit}>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Проект *</Label>
              <Select disabled={loading || saving} onValueChange={setProjectId} value={projectId}>
                <SelectTrigger aria-label="Проект">
                  <SelectValue placeholder={loading ? 'Загружаем…' : 'Выберите проект'} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && available.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Участник уже добавлен во все доступные проекты.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="person-project-role">Роль в проекте *</Label>
              <Input
                disabled={saving}
                id="person-project-role"
                maxLength={500}
                onChange={(event) => setRole(event.target.value)}
                placeholder="Например: основатель, дизайнер, разработчик"
                required
                value={role}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving || !projectId || !role.trim()} type="submit">
              {saving ? 'Добавляем…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
