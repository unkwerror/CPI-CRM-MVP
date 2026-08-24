'use client';

import { CheckIcon, ClipboardListIcon, UserPlusIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { ProjectApplicationSummary } from '@/lib/types';

export function ProjectApplicationsPanel({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [items, setItems] = useState<ProjectApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ProjectApplicationSummary | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api<{ items: ProjectApplicationSummary[] }>(
        '/project-applications?status=PENDING&limit=200',
      );
      setItems(response.items);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось загрузить заявки на проекты'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  function openDecision(item: ProjectApplicationSummary, next: 'APPROVED' | 'REJECTED') {
    setSelected(item);
    setDecision(next);
    setComment('');
  }

  async function submit() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/project-applications/${selected.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
      toast.success(
        decision === 'APPROVED'
          ? selected.type === 'CREATE'
            ? 'Проект создан, заявитель назначен инициатором'
            : 'Участник добавлен в проект'
          : 'Заявка отклонена',
      );
      setSelected(null);
      await Promise.all([load(), onChanged()]);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось обработать заявку'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardListIcon className="size-4" /> Заявки из Telegram-бота
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Создание проектов подтверждает администратор; вступление — ответственный или
              администратор.
            </p>
          </div>
          <Badge variant={items.length ? 'soft-warning' : 'soft-muted'}>
            {items.length} ожидают
          </Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">Новых заявок нет.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <article
                  className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center"
                  key={item.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.type === 'CREATE' ? 'soft-primary' : 'soft-muted'}>
                        {item.type === 'CREATE' ? 'Новый проект' : 'Вступление'}
                      </Badge>
                      <strong className="text-[13px]">
                        {item.type === 'CREATE' ? item.proposedName : item.projectName}
                      </strong>
                    </div>
                    <p className="mt-1 text-[13px]">
                      {item.applicantName}
                      {item.type === 'JOIN' ? ` · роль: ${item.requestedRole}` : ' · инициатор'}
                    </p>
                    {(item.proposedDescription || item.message) && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {item.proposedDescription || item.message}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">
                      Подано {formatDate(item.createdAt, true)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button onClick={() => openDecision(item, 'APPROVED')} size="sm">
                      <CheckIcon /> Одобрить
                    </Button>
                    <Button
                      onClick={() => openDecision(item, 'REJECTED')}
                      size="sm"
                      variant="outline"
                    >
                      <XIcon /> Отклонить
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Dialog open onOpenChange={(open) => !open && !saving && setSelected(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {decision === 'APPROVED' ? 'Одобрить заявку' : 'Отклонить заявку'}
              </DialogTitle>
              <DialogDescription>
                {selected.applicantName} ·{' '}
                {selected.type === 'CREATE' ? selected.proposedName : selected.projectName}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-2">
              <Label htmlFor="project-application-comment">Комментарий (необязательно)</Label>
              <Textarea
                autoFocus={decision === 'REJECTED'}
                id="project-application-comment"
                maxLength={5_000}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Комментарий будет виден пользователю в боте"
                rows={4}
                value={comment}
              />
            </DialogBody>
            <DialogFooter>
              <Button disabled={saving} onClick={() => setSelected(null)} variant="outline">
                Отмена
              </Button>
              <Button
                disabled={saving}
                onClick={() => void submit()}
                variant={decision === 'REJECTED' ? 'destructive' : 'default'}
              >
                {decision === 'APPROVED' ? <UserPlusIcon /> : <XIcon />}
                {saving ? 'Сохраняем…' : decision === 'APPROVED' ? 'Одобрить' : 'Отклонить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
