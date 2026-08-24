'use client';

import {
  BotIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderKanbanIcon,
  GitMergeIcon,
  SearchIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { PersonDetail, PersonDuplicateSuggestion } from '@/lib/types';
import { cn } from '@/lib/utils';

export function PersonDuplicateSuggestionBanner({
  suggestions,
  onOpen,
}: {
  suggestions: PersonDuplicateSuggestion[];
  onOpen: (candidateId: string) => void;
}) {
  const first = suggestions[0];
  if (!first) return null;

  return (
    <Card className="border-warning/35 bg-warning/8">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="bg-warning/15 text-warning flex size-10 shrink-0 items-center justify-center rounded-lg">
          <GitMergeIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[14px] font-semibold">Найден возможный дубль</strong>
            {suggestions.length > 1 && (
              <Badge variant="soft-warning">вариантов: {suggestions.length}</Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            {first.canonicalFullName}
            {first.reasons.length > 0 ? ` · ${first.reasons.join(', ')}` : ''}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => onOpen(first.id)}>
          <GitMergeIcon /> Сравнить и объединить
        </Button>
      </CardContent>
    </Card>
  );
}

export function PersonDuplicateMergeDialog({
  current,
  suggestions,
  initialCandidateId,
  onOpenChange,
  onMerged,
}: {
  current: PersonDetail;
  suggestions: PersonDuplicateSuggestion[];
  initialCandidateId?: string | null;
  onOpenChange: (open: boolean) => void;
  onMerged: (masterPersonId: string) => void | Promise<void>;
}) {
  const initialCandidate =
    suggestions.find((item) => item.id === initialCandidateId) ?? suggestions[0] ?? null;
  const [candidate, setCandidate] = useState<PersonDuplicateSuggestion | null>(initialCandidate);
  const [masterPersonId, setMasterPersonId] = useState<string | null>(() =>
    initialCandidate ? recommendedMaster(current, initialCandidate) : null,
  );
  const [reason, setReason] = useState(() => defaultReason(current, initialCandidate));
  const [reasonEdited, setReasonEdited] = useState(false);
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [saving, setSaving] = useState(false);

  function chooseCandidate(next: PersonDuplicateSuggestion | null) {
    setCandidate(next);
    setMasterPersonId(next ? recommendedMaster(current, next) : null);
    if (!reasonEdited) setReason(defaultReason(current, next));
  }

  async function chooseFromSearch(person: PersonOption | null) {
    if (!person) {
      chooseCandidate(null);
      return;
    }
    if (person.id === current.id) {
      toast.error('Выберите другую карточку участника');
      return;
    }
    const known = suggestions.find((item) => item.id === person.id);
    if (known) {
      chooseCandidate(known);
      return;
    }
    setLoadingCandidate(true);
    try {
      const detail = await api<PersonDetail>(`/people/${person.id}`);
      chooseCandidate({
        id: detail.id,
        canonicalFullName: detail.canonicalFullName,
        primaryContact: detail.primaryContact ?? detail.contacts[0]?.rawValue ?? null,
        organization: detail.organization ?? null,
        faculty: detail.faculty ?? null,
        fromBot: detail.fromBot,
        profileNeedsReview: detail.profileNeedsReview,
        archived: false,
        artifactCount: detail.countableArtifactCount,
        eventCount: detail.events.length,
        projectCount: detail.projects.length,
        createdAt: null,
        openCandidateId: null,
        confidence: null,
        reasons: ['Карточка выбрана вручную'],
      });
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось открыть выбранную карточку'));
    } finally {
      setLoadingCandidate(false);
    }
  }

  async function merge() {
    if (!candidate || !masterPersonId || reason.trim().length < 3) return;
    setSaving(true);
    try {
      const candidateId =
        candidate.openCandidateId ??
        (
          await api<{ id: string }>('/duplicate-candidates', {
            method: 'POST',
            body: JSON.stringify({
              personAId: current.id,
              personBId: candidate.id,
              reason: reason.trim(),
            }),
          })
        ).id;

      await api(`/duplicate-candidates/${candidateId}/merge`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ masterPersonId, reason: reason.trim() }),
      });
      const masterName =
        masterPersonId === current.id ? current.canonicalFullName : candidate.canonicalFullName;
      toast.success(`Карточки объединены. Основная — «${masterName}»`);
      onOpenChange(false);
      await onMerged(masterPersonId);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось объединить карточки'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogDescription>Проверка дублей участника</DialogDescription>
          <DialogTitle>Сравните карточки перед объединением</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {suggestions.length > 1 && (
            <div className="space-y-2">
              <Label>Найденные совпадения</Label>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    size="xs"
                    variant={candidate?.id === item.id ? 'secondary' : 'outline'}
                    disabled={saving || loadingCandidate}
                    onClick={() => chooseCandidate(item)}
                  >
                    {item.canonicalFullName}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Вторая карточка</Label>
            <PersonPicker
              value={
                candidate
                  ? { id: candidate.id, canonicalFullName: candidate.canonicalFullName }
                  : null
              }
              onChange={(person) => void chooseFromSearch(person)}
              placeholder="ФИО, телефон или email…"
              disabled={saving || loadingCandidate}
            />
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <SearchIcon className="size-3.5" />
              Если подсказка неверна, удалите выбор и найдите карточку вручную.
            </p>
          </div>

          {candidate && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <ComparisonCard
                  person={toComparable(current)}
                  selected={masterPersonId === current.id}
                  onSelect={() => setMasterPersonId(current.id)}
                  disabled={saving}
                />
                <ComparisonCard
                  person={candidate}
                  selected={masterPersonId === candidate.id}
                  onSelect={() => setMasterPersonId(candidate.id)}
                  disabled={saving}
                />
              </div>

              <div className="bg-muted/50 rounded-lg border px-3 py-2.5 text-[13px]">
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2Icon className="text-success size-4" />
                  Связи обеих карточек сохранятся
                </p>
                <p className="text-muted-foreground mt-1">
                  Telegram ID, контакты, артефакты, мероприятия и проекты будут видны в выбранной
                  основной карточке. Слияние записывается в журнал и может быть отменено.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="person-merge-reason">Основание *</Label>
                <Textarea
                  id="person-merge-reason"
                  value={reason}
                  rows={3}
                  minLength={3}
                  maxLength={2000}
                  disabled={saving}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonEdited(true);
                  }}
                />
              </div>
            </>
          )}
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
            disabled={
              saving ||
              loadingCandidate ||
              !candidate ||
              !masterPersonId ||
              reason.trim().length < 3
            }
            onClick={() => void merge()}
          >
            <GitMergeIcon /> {saving ? 'Объединяем…' : 'Объединить карточки'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ComparablePerson {
  id: string;
  canonicalFullName: string;
  primaryContact: string | null;
  organization: string | null;
  faculty: string | null;
  fromBot: boolean;
  profileNeedsReview: boolean;
  artifactCount: number;
  eventCount: number;
  projectCount: number;
  createdAt: string | null;
  reasons: string[];
}

function ComparisonCard({
  person,
  selected,
  onSelect,
  disabled,
}: {
  person: ComparablePerson;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'bg-card relative rounded-xl border p-4 text-left transition-colors disabled:opacity-60',
        selected ? 'border-primary ring-primary/20 ring-2' : 'hover:border-primary/40',
      )}
    >
      {selected && (
        <Badge className="absolute top-3 right-3" variant="soft-success">
          Основная
        </Badge>
      )}
      <div className="pr-20">
        <p className="text-[15px] leading-snug font-semibold">{person.canonicalFullName}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant={person.fromBot ? 'soft-primary' : 'soft-muted'}>
            {person.fromBot ? <BotIcon /> : null}
            {person.fromBot ? 'Связана с ботом' : 'Только CRM'}
          </Badge>
          <Badge variant={person.profileNeedsReview ? 'soft-warning' : 'soft-success'}>
            {person.profileNeedsReview ? 'ФИО нужно уточнить' : 'ФИО полное'}
          </Badge>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
        <dt className="text-muted-foreground">Контакт</dt>
        <dd className="truncate font-medium">{person.primaryContact ?? '—'}</dd>
        <dt className="text-muted-foreground">Организация</dt>
        <dd className="font-medium">
          {person.organization ?? '—'}
          {person.faculty ? ` · ${person.faculty}` : ''}
        </dd>
        <dt className="text-muted-foreground">Создана</dt>
        <dd className="font-medium">{formatDate(person.createdAt)}</dd>
      </dl>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
        <Counter icon={FileTextIcon} label="Артефакты" value={person.artifactCount} />
        <Counter icon={CalendarDaysIcon} label="События" value={person.eventCount} />
        <Counter icon={FolderKanbanIcon} label="Проекты" value={person.projectCount} />
      </div>

      {person.reasons.length > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">{person.reasons.join(' · ')}</p>
      )}
    </button>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileTextIcon;
  label: string;
  value: number;
}) {
  return (
    <span>
      <strong className="flex items-center justify-center gap-1 text-sm font-semibold tabular">
        <Icon className="text-muted-foreground size-3.5" /> {value}
      </strong>
      <small className="text-muted-foreground text-[10px]">{label}</small>
    </span>
  );
}

function toComparable(person: PersonDetail): ComparablePerson {
  return {
    id: person.id,
    canonicalFullName: person.canonicalFullName,
    primaryContact: person.primaryContact ?? person.contacts[0]?.rawValue ?? null,
    organization: person.organization ?? null,
    faculty: person.faculty ?? null,
    fromBot: person.fromBot,
    profileNeedsReview: person.profileNeedsReview,
    artifactCount: person.countableArtifactCount,
    eventCount: person.events.length,
    projectCount: person.projects.length,
    createdAt: null,
    reasons: [],
  };
}

function recommendedMaster(current: PersonDetail, candidate: PersonDuplicateSuggestion): string {
  const currentScore = masterQuality(current);
  const candidateScore = masterQuality(candidate);
  return candidateScore > currentScore ? candidate.id : current.id;
}

function masterQuality(person: {
  canonicalFullName: string;
  profileNeedsReview: boolean;
  fromBot: boolean;
  organization?: string | null;
  primaryContact?: string | null;
}): number {
  return (
    (person.profileNeedsReview ? 0 : 100) +
    (person.fromBot ? 0 : 20) +
    Math.min(person.canonicalFullName.trim().split(/\s+/u).length, 3) * 5 +
    (person.organization ? 2 : 0) +
    (person.primaryContact ? 1 : 0)
  );
}

function defaultReason(current: PersonDetail, candidate: PersonDuplicateSuggestion | null): string {
  if (!candidate) return `Проверка дубля для «${current.canonicalFullName}»`;
  return `Один участник: «${current.canonicalFullName}» и «${candidate.canonicalFullName}»`;
}
