'use client';

import { type FormEvent, useState } from 'react';
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
import { api, apiErrorMessage } from '@/lib/api';

export function ProjectMemberDialog({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [role, setRole] = useState('Участник');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!person) {
      setError('Выберите участника.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ addedToEvents: number }>(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ personId: person.id, role: role.trim() }),
      });
      toast.success(
        result.addedToEvents > 0
          ? `Участник добавлен в проект и в ${result.addedToEvents} мероприятий`
          : 'Участник добавлен в проект',
      );
      await onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось добавить участника'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogDescription>Состав проекта</DialogDescription>
          <DialogTitle>Добавить участника</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Участник *</Label>
              <PersonPicker disabled={saving} onChange={setPerson} value={person} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-member-role">Роль в проекте *</Label>
              <Input
                id="project-member-role"
                maxLength={500}
                onChange={(event) => setRole(event.target.value)}
                placeholder="Например: основатель, дизайнер, разработчик"
                required
                value={role}
              />
              <p className="text-muted-foreground text-xs">Свободный текст без справочника.</p>
            </div>
            {error && <p className="text-destructive text-[13px]">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving || !person} type="submit">
              {saving ? 'Добавляем…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
