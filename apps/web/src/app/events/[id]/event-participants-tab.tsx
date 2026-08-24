'use client';

import {
  FileCheck2Icon,
  FilePlus2Icon,
  MessageSquareIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataToolbar, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { ArtifactSubmitDialog } from '@/components/artifact-submit-dialog';
import { EmptyState } from '@/components/empty-state';
import { PersonPicker, type PersonOption } from '@/components/person-picker';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { api, apiErrorMessage, initials } from '@/lib/api';
import { ATTENDANCE_LABELS, PARTICIPATION_DECISION_LABELS } from '@/lib/status-labels';
import type { EventParticipantSummary } from '@/lib/types';

export function EventParticipantsTab({
  eventId,
  eventName,
  participants,
  canWrite,
  canAddArtifact,
  onOpenArtifact,
  onChanged,
}: {
  eventId: string;
  eventName: string;
  participants: EventParticipantSummary[];
  canWrite: boolean;
  canAddArtifact: boolean;
  onOpenArtifact: (versionId: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [artifactFilter, setArtifactFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resultPerson, setResultPerson] = useState<EventParticipantSummary | null>(null);
  const [resultDraft, setResultDraft] = useState('');
  const [savingResult, setSavingResult] = useState(false);
  const [artifactPerson, setArtifactPerson] = useState<EventParticipantSummary | null>(null);

  async function saveResult() {
    if (!resultPerson) return;
    setSavingResult(true);
    try {
      await api(`/events/${eventId}/participants/${resultPerson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ result: resultDraft.trim() || null }),
      });
      toast.success('Результат участия сохранён');
      setResultPerson(null);
      await onChanged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить результат'));
    } finally {
      setSavingResult(false);
    }
  }

  async function removeParticipant(person: EventParticipantSummary) {
    setRemovingId(person.id);
    try {
      await api(`/events/${eventId}/participants/${person.id}`, { method: 'DELETE' });
      toast.success(`${person.canonicalFullName} снят с мероприятия`);
      await onChanged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось снять участника'));
    } finally {
      setRemovingId(null);
    }
  }

  const addButton = canWrite ? (
    <Button onClick={() => setAdding(true)} size="sm">
      <UserPlusIcon />
      Добавить участника
    </Button>
  ) : null;

  const addDialog = adding ? (
    <AddParticipantDialog
      eventId={eventId}
      existingIds={new Set(participants.map((person) => person.id))}
      onAdded={onChanged}
      onClose={() => setAdding(false)}
    />
  ) : null;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return participants.filter((person) => {
      if (needle && !person.canonicalFullName.toLowerCase().includes(needle)) return false;
      if (artifactFilter === 'WITH' && person.artifacts.length === 0) return false;
      if (artifactFilter === 'WITHOUT' && person.artifacts.length > 0) return false;
      return true;
    });
  }, [artifactFilter, participants, search]);

  if (participants.length === 0) {
    return (
      <>
        <Card>
          <EmptyState
            icon={UsersIcon}
            title="Участников пока нет"
            text="В источниках не найдено записей участия. Добавьте участника вручную или загрузите таблицу посещений на вкладке «Выгрузки»."
            action={addButton}
          />
        </Card>
        {addDialog}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <DataToolbar>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Поиск по ФИО…" />
        <ToolbarSelect
          label="Артефакты"
          value={artifactFilter}
          onChange={setArtifactFilter}
          options={[
            { value: '', label: 'Все участники' },
            { value: 'WITH', label: 'С артефактами' },
            { value: 'WITHOUT', label: 'Без артефактов' },
          ]}
        />
        <span className="text-muted-foreground ml-auto text-[13px] tabular">
          Показано {filtered.length} из {participants.length}
        </span>
        {addButton}
      </DataToolbar>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="Никто не подошёл под фильтры" text="Измените условия отбора." />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Участник</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Участие</TableHead>
                  <TableHead>Результат</TableHead>
                  <TableHead>Артефакты</TableHead>
                  <TableHead>Комментарии</TableHead>
                  {canWrite || canAddArtifact ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <Link
                        href={`/participants/${person.id}`}
                        className="flex items-center gap-2.5"
                      >
                        <Avatar className="size-8">
                          <AvatarFallback>{initials(person.canonicalFullName)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <strong className="block truncate font-medium hover:underline">
                            {person.canonicalFullName}
                          </strong>
                          <small className="text-muted-foreground block text-xs">
                            {person.participationCount > 1
                              ? `${person.participationCount} записей участия`
                              : '1 запись участия'}
                          </small>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {person.primaryContact ?? '—'}
                    </TableCell>
                    <TableCell>
                      <span className="block text-[13px] font-medium">
                        {person.decisions
                          .map((value) => PARTICIPATION_DECISION_LABELS[value] ?? value)
                          .join(', ') || 'Не указано'}
                      </span>
                      <small className="text-muted-foreground block text-xs">
                        {person.attendances
                          .map((value) => ATTENDANCE_LABELS[value] ?? value)
                          .join(', ') || 'Посещение не указано'}
                      </small>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <p className="line-clamp-3 text-[13px] whitespace-pre-wrap">
                        {person.result ?? (
                          <span className="text-muted-foreground">Не заполнен</span>
                        )}
                      </p>
                      {canWrite && (
                        <Button
                          className="mt-1"
                          onClick={() => {
                            setResultPerson(person);
                            setResultDraft(person.result ?? '');
                          }}
                          size="xs"
                          variant="ghost"
                        >
                          <PencilIcon /> Изменить
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      {person.artifacts.length === 0 ? (
                        <span className="text-muted-foreground">Нет</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          {person.artifacts.map((artifact) => (
                            <Button
                              key={artifact.id}
                              variant="ghost"
                              size="xs"
                              className="max-w-56"
                              disabled={!artifact.latestVersionId}
                              onClick={() =>
                                artifact.latestVersionId && onOpenArtifact(artifact.latestVersionId)
                              }
                            >
                              <FileCheck2Icon />
                              <span className="truncate">{artifact.title}</span>
                            </Button>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {person.comments.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="text-muted-foreground space-y-1 text-xs">
                          {person.comments.map((comment) => (
                            <p key={comment} className="flex items-start gap-1.5">
                              <MessageSquareIcon className="mt-0.5 size-3 shrink-0" />
                              <span>{comment}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    {canWrite || canAddArtifact ? (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {canAddArtifact && (
                            <Button
                              aria-label={`Добавить артефакт для ${person.canonicalFullName}`}
                              onClick={() => setArtifactPerson(person)}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <FilePlus2Icon />
                            </Button>
                          )}
                          {canWrite && (
                            <Button
                              aria-label={`Снять ${person.canonicalFullName} с мероприятия`}
                              disabled={removingId === person.id}
                              onClick={() => void removeParticipant(person)}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <UserMinusIcon />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>
      {addDialog}
      {resultPerson && (
        <Dialog open onOpenChange={(open) => !open && !savingResult && setResultPerson(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Результат участия</DialogTitle>
              <DialogDescription>
                {resultPerson.canonicalFullName} · {eventName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="event-participant-result">Результат</Label>
              <Textarea
                autoFocus
                id="event-participant-result"
                onChange={(event) => setResultDraft(event.target.value)}
                placeholder="Например: выступил, занял 2 место; заявка одобрена"
                rows={5}
                value={resultDraft}
              />
            </div>
            <DialogFooter>
              <Button
                disabled={savingResult}
                onClick={() => setResultPerson(null)}
                variant="outline"
              >
                Отмена
              </Button>
              <Button disabled={savingResult} onClick={() => void saveResult()}>
                {savingResult ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {artifactPerson && (
        <ArtifactSubmitDialog
          defaultEventId={eventId}
          events={[
            {
              id: eventId,
              name: eventName,
              status: 'ACTIVE',
              participations: [],
              artifacts: artifactPerson.artifacts,
            },
          ]}
          onClose={() => setArtifactPerson(null)}
          onCreated={async () => {
            setArtifactPerson(null);
            await onChanged();
          }}
          personId={artifactPerson.id}
        />
      )}
    </div>
  );
}

/**
 * Добавление участника вручную.
 *
 * Решение и посещение предзаполнены «принят» и «посетил»: руками участника
 * добавляют почти всегда именно потому, что он пришёл, а список этого не
 * зафиксировал.
 */
function AddParticipantDialog({
  eventId,
  existingIds,
  onAdded,
  onClose,
}: {
  eventId: string;
  existingIds: Set<string>;
  onAdded: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [decision, setDecision] = useState('ACCEPTED');
  const [attendance, setAttendance] = useState('ATTENDED');
  const [result, setResult] = useState('');
  const [saving, setSaving] = useState(false);

  const alreadyHere = person !== null && existingIds.has(person.id);

  async function submit() {
    if (!person || alreadyHere) return;
    setSaving(true);
    try {
      await api(`/events/${eventId}/participants`, {
        method: 'POST',
        body: JSON.stringify({
          personId: person.id,
          decision,
          attendance,
          result: result.trim() || undefined,
        }),
      });
      toast.success(`${person.canonicalFullName} добавлен в мероприятие`);
      await onAdded();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось добавить участника'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить участника</DialogTitle>
          <DialogDescription>
            Ищем по всей базе: карточка участника должна существовать. Если человека в базе нет,
            сначала создайте карточку в реестре участников.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Участник</Label>
            <PersonPicker onChange={setPerson} value={person} />
            {alreadyHere ? (
              <p className="text-[13px] text-amber-600">Этот участник уже есть в мероприятии.</p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="participant-decision">Решение</Label>
              <Select onValueChange={setDecision} value={decision}>
                <SelectTrigger id="participant-decision">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PARTICIPATION_DECISION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="participant-attendance">Посещение</Label>
              <Select onValueChange={setAttendance} value={attendance}>
                <SelectTrigger id="participant-attendance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ATTENDANCE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="participant-result">Результат (необязательно)</Label>
            <Textarea
              id="participant-result"
              onChange={(event) => setResult(event.target.value)}
              placeholder="Например: заявка принята; выступил, занял 2 место"
              rows={3}
              value={result}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button disabled={!person || alreadyHere || saving} onClick={() => void submit()}>
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
