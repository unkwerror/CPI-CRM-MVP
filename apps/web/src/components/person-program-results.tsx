'use client';

import { AwardIcon, Building2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { PersonProgramResult, ProgramResultCode, ProgramResultStatus } from '@/lib/types';

const PROGRAMS = {
  SVYA: {
    name: 'СВЯ',
    description: 'Выступление участника и итог выступления',
    Icon: AwardIcon,
    statuses: ['PLANNED', 'PARTICIPATED', 'FINALIST', 'WINNER', 'NOT_SELECTED', 'WITHDRAWN'],
  },
  BI_ACADEMPARK: {
    name: 'Резиденты БИ Академпарка',
    description: 'Подача заявки и результат отбора',
    Icon: Building2Icon,
    statuses: ['PLANNED', 'APPLIED', 'INTERVIEW', 'RESIDENT', 'REJECTED', 'WITHDRAWN'],
  },
} as const;

const STATUS_LABELS: Record<ProgramResultStatus, string> = {
  PLANNED: 'Планирует участие',
  APPLIED: 'Заявка подана',
  INTERVIEW: 'Проходит отбор',
  PARTICIPATED: 'Выступил(а)',
  FINALIST: 'Финалист',
  WINNER: 'Победитель',
  RESIDENT: 'Получил(а) резидентство',
  NOT_SELECTED: 'Не прошёл(а) дальше',
  REJECTED: 'Заявка отклонена',
  WITHDRAWN: 'Отказался(ась)',
};

function badgeVariant(status: ProgramResultStatus) {
  if (status === 'WINNER' || status === 'RESIDENT') return 'soft-success' as const;
  if (status === 'REJECTED' || status === 'NOT_SELECTED') return 'soft-destructive' as const;
  if (status === 'FINALIST' || status === 'INTERVIEW') return 'soft-warning' as const;
  return 'soft-primary' as const;
}

export function PersonProgramResults({
  personId,
  canEdit,
}: {
  personId: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<PersonProgramResult[]>([]);
  const [editing, setEditing] = useState<ProgramResultCode | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api<{ items: PersonProgramResult[] }>(
        `/people/${personId}/program-results`,
      );
      setItems(response.items);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось загрузить результаты программ'));
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCode = useMemo(() => new Map(items.map((item) => [item.programCode, item])), [items]);

  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Измеримые результаты
            </p>
            <CardTitle className="mt-1">Программы и отборы</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(Object.keys(PROGRAMS) as ProgramResultCode[]).map((code) => {
            const program = PROGRAMS[code];
            const item = byCode.get(code);
            const Icon = program.Icon;
            return (
              <section className="flex min-h-28 items-start gap-3 rounded-lg border p-3" key={code}>
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <strong className="block text-[13px] font-semibold">{program.name}</strong>
                      <span className="text-muted-foreground block text-xs">
                        {program.description}
                      </span>
                    </div>
                    {canEdit && (
                      <Button onClick={() => setEditing(code)} size="icon-sm" variant="ghost">
                        {item ? <PencilIcon /> : <PlusIcon />}
                        <span className="sr-only">Изменить {program.name}</span>
                      </Button>
                    )}
                  </div>
                  {item ? (
                    <div className="space-y-1">
                      <Badge variant={badgeVariant(item.status)}>
                        {STATUS_LABELS[item.status]}
                      </Badge>
                      {item.result && <p className="text-[13px]">{item.result}</p>}
                      <small className="text-muted-foreground block text-xs">
                        {item.occurredAt
                          ? formatDate(item.occurredAt)
                          : `Обновлено ${formatDate(item.updatedAt)}`}
                      </small>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-[13px]">Данные ещё не внесены.</p>
                  )}
                </div>
              </section>
            );
          })}
        </CardContent>
      </Card>

      {editing && (
        <ProgramResultDialog
          personId={personId}
          programCode={editing}
          current={byCode.get(editing) ?? null}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

function ProgramResultDialog({
  personId,
  programCode,
  current,
  onClose,
  onSaved,
}: {
  personId: string;
  programCode: ProgramResultCode;
  current: PersonProgramResult | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const program = PROGRAMS[programCode];
  const [status, setStatus] = useState<ProgramResultStatus>(
    current?.status ?? (programCode === 'SVYA' ? 'PLANNED' : 'APPLIED'),
  );
  const [result, setResult] = useState(current?.result ?? '');
  const [occurredAt, setOccurredAt] = useState(current?.occurredAt?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/people/${personId}/program-results/${programCode}`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          result: result.trim() || null,
          occurredAt: occurredAt ? new Date(`${occurredAt}T12:00:00`).toISOString() : null,
        }),
      });
      toast.success('Результат сохранён');
      await onSaved();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить результат'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api(`/people/${personId}/program-results/${programCode}`, { method: 'DELETE' });
      toast.success('Отметка убрана');
      await onSaved();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось убрать отметку'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{program.name}</DialogTitle>
          <DialogDescription>{program.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Текущий результат *</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as ProgramResultStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {program.statuses.map((value) => (
                    <SelectItem key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-result-date">Дата события</Label>
              <Input
                id="program-result-date"
                type="date"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-result-comment">Комментарий / точный результат</Label>
              <Textarea
                id="program-result-comment"
                rows={3}
                maxLength={10_000}
                value={result}
                onChange={(event) => setResult(event.target.value)}
                placeholder="Например: 2 место, приглашён на следующий этап"
              />
            </div>
          </DialogBody>
          <DialogFooter className="justify-between">
            {current ? (
              <Button type="button" variant="ghost" disabled={saving} onClick={() => void remove()}>
                <Trash2Icon /> Убрать отметку
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
