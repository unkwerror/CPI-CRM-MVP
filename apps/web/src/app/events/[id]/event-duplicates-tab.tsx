'use client';

import { ArrowRightIcon, CopyCheckIcon, SearchIcon, SendIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { PersonPicker, type PersonOption } from '@/components/person-picker';
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

/**
 * Кандидат на роль основной карточки. Подсказки со стороны мероприятия дают
 * `openCandidateId` — уже заведённую пару, — а найденный поиском по базе
 * человек приходит без неё, и пару придётся создать при слиянии.
 */
interface MasterCandidate {
  id: string;
  canonicalFullName: string;
  openCandidateId?: string | null;
  fromRegistration: boolean;
}

interface MergePair {
  duplicate: EventDuplicateSuggestion;
  master: MasterCandidate | null;
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
                Среди участников этого мероприятия подходящих карточек нет. Если человек есть в
                базе по другому мероприятию — найдите его поиском.
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
                          onClick={() =>
                            setPair({
                              duplicate,
                              master: {
                                id: suggestion.id,
                                canonicalFullName: suggestion.canonicalFullName,
                                openCandidateId: suggestion.openCandidateId,
                                fromRegistration: true,
                              },
                            })
                          }
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

            {canMerge && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPair({ duplicate, master: null })}
              >
                <SearchIcon />
                Найти карточку в базе
              </Button>
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
  const [master, setMaster] = useState<MasterCandidate | null>(pair.master);
  const [reason, setReason] = useState(defaultReason(pair.duplicate, pair.master));
  const [reasonEdited, setReasonEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  function pickMaster(person: PersonOption | null) {
    const next: MasterCandidate | null = person
      ? { id: person.id, canonicalFullName: person.canonicalFullName, fromRegistration: false }
      : null;
    setMaster(next);
    if (!reasonEdited) setReason(defaultReason(pair.duplicate, next));
  }

  async function submit() {
    if (!master) return;
    setSaving(true);
    try {
      // Существующий механизм слияния работает от пары в duplicate_candidates,
      // поэтому ручную пару сначала заводим, а потом сливаем ею же.
      const candidateId =
        master.openCandidateId ??
        (
          await api<{ id: string }>('/duplicate-candidates', {
            method: 'POST',
            body: JSON.stringify({
              personAId: pair.duplicate.id,
              personBId: master.id,
              reason: reason.trim(),
            }),
          })
        ).id;

      await api(`/duplicate-candidates/${candidateId}/merge`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ masterPersonId: master.id, reason: reason.trim() }),
      });
      toast.success(`Карточки объединены в «${master.canonicalFullName}»`);
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
              {master ? (
                <>
                  <p className="text-[13px] font-medium">{master.canonicalFullName}</p>
                  <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <UsersIcon className="size-3" />
                    {master.fromRegistration ? 'из регистрации' : 'найдена в базе'}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-[13px]">не выбрана</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Основная карточка *</Label>
            <PersonPicker
              value={master ? { id: master.id, canonicalFullName: master.canonicalFullName } : null}
              onChange={pickMaster}
              placeholder="Найдите участника по ФИО, телефону или email…"
              disabled={saving}
            />
            <p className="text-muted-foreground text-xs">
              Поиск идёт по всей базе, а не только по участникам этого мероприятия: человек мог
              регистрироваться на другое событие или попасть в базу импортом.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="merge-reason">Основание *</Label>
            <Textarea
              id="merge-reason"
              maxLength={2000}
              minLength={3}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonEdited(true);
              }}
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
          <Button
            type="button"
            disabled={saving || !master || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {saving ? 'Объединяем…' : 'Объединить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultReason(
  duplicate: EventDuplicateSuggestion,
  master: MasterCandidate | null,
): string {
  if (!master) return `Дубль из телеграм-бота: «${duplicate.canonicalFullName}»`;
  return `Дубль из телеграм-бота: «${duplicate.canonicalFullName}» — это «${master.canonicalFullName}»`;
}
