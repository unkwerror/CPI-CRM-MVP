'use client';

import { ArrowRightIcon, CopyCheckIcon, SendIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';
import type { EventDuplicateSuggestion } from '@/lib/types';

interface MergePair {
  duplicate: EventDuplicateSuggestion;
  master: EventDuplicateSuggestion['suggestions'][number];
}

export function EventDuplicatesTab({
  items,
  loading,
  canMerge,
  onChanged,
}: {
  items: EventDuplicateSuggestion[];
  loading: boolean;
  canMerge: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [pair, setPair] = useState<MergePair | null>(null);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index} className="h-40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CopyCheckIcon}
          title="Дублей не видно"
          text="Все авторы артефактов этого мероприятия заведены с полным ФИО."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-[13px]">
        Телеграм-бот заводит личность по имени из профиля, поэтому у неё нет полного ФИО, зато есть
        артефакты. Карточки без полного ФИО прячет гигиена участников — в реестре их не найти, а
        артефакты остаются в мероприятии. Ниже — такие карточки и зарегистрированные участники без
        артефактов, на которых их можно объединить. Слияние обратимо: карточка помечается как
        объединённая, а не удаляется.
      </p>

      {items.map((duplicate) => (
        <Card key={duplicate.id}>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/participants/${duplicate.id}`}
                  className="text-[15px] font-semibold hover:underline"
                >
                  {duplicate.canonicalFullName}
                </Link>
                <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <SendIcon className="size-3" />
                    {duplicate.telegram ?? 'Telegram не указан'}
                  </span>
                  <span>·</span>
                  <span className="tabular">артефактов: {duplicate.artifactCount}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="soft-warning">ФИО неполное</Badge>
                {duplicate.hidden && <Badge variant="soft-destructive">Скрыта в реестре</Badge>}
              </div>
            </div>

            {duplicate.suggestions.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">
                Подходящих участников без артефактов в мероприятии не нашлось — вероятно, это новый
                человек, которого не было в регистрации.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  Кандидаты на объединение
                </p>
                <div className="divide-y rounded-lg border">
                  {duplicate.suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2"
                    >
                      <Link
                        href={`/participants/${suggestion.id}`}
                        className="min-w-0 flex-1 truncate text-[13px] font-medium hover:underline"
                      >
                        {suggestion.canonicalFullName}
                      </Link>
                      {suggestion.nameOverlap && (
                        <Badge variant="soft-success">Совпадает имя</Badge>
                      )}
                      {suggestion.telegram && (
                        <span className="text-muted-foreground text-xs">{suggestion.telegram}</span>
                      )}
                      {canMerge && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setPair({ duplicate, master: suggestion })}
                        >
                          Объединить
                          <ArrowRightIcon />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {pair && (
        <MergeDialog
          pair={pair}
          onOpenChange={(open) => !open && setPair(null)}
          onMerged={onChanged}
        />
      )}
    </div>
  );
}

function MergeDialog({
  pair,
  onOpenChange,
  onMerged,
}: {
  pair: MergePair;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState(
    `Дубль из телеграм-бота: «${pair.duplicate.canonicalFullName}» — это «${pair.master.canonicalFullName}»`,
  );
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      // Существующий механизм слияния работает от пары в duplicate_candidates,
      // поэтому ручную пару сначала заводим, а потом сливаем ею же.
      const candidateId =
        pair.master.openCandidateId ??
        (
          await api<{ id: string }>('/duplicate-candidates', {
            method: 'POST',
            body: JSON.stringify({
              personAId: pair.duplicate.id,
              personBId: pair.master.id,
              reason: reason.trim(),
            }),
          })
        ).id;

      await api(`/duplicate-candidates/${candidateId}/merge`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ masterPersonId: pair.master.id, reason: reason.trim() }),
      });
      toast.success(`Карточки объединены в «${pair.master.canonicalFullName}»`);
      onOpenChange(false);
      await onMerged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось объединить карточки'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogDescription>Объединение карточек</DialogDescription>
          <DialogTitle>Одна личность вместо двух</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Дубль
              </p>
              <p className="text-[13px] font-medium">{pair.duplicate.canonicalFullName}</p>
              <p className="text-muted-foreground text-xs tabular">
                артефактов: {pair.duplicate.artifactCount}
              </p>
              {pair.duplicate.hidden && (
                <p className="text-muted-foreground mt-1 text-xs">скрыта гигиеной ФИО</p>
              )}
            </div>
            <ArrowRightIcon className="text-muted-foreground mx-auto size-4 rotate-90 sm:rotate-0" />
            <div className="border-primary/40 bg-primary/5 rounded-lg border p-3">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Основная карточка
              </p>
              <p className="text-[13px] font-medium">{pair.master.canonicalFullName}</p>
              <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <UsersIcon className="size-3" /> из регистрации
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="merge-reason">Основание *</Label>
            <Textarea
              id="merge-reason"
              maxLength={2000}
              minLength={3}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              value={reason}
            />
            <p className="text-muted-foreground text-xs">
              Основание попадёт в журнал действий и в операцию слияния — по нему её можно отменить.
            </p>
          </div>
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
          <Button type="button" disabled={saving || reason.trim().length < 3} onClick={() => void submit()}>
            {saving ? 'Объединяем…' : 'Объединить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
