'use client';

import {
  CalendarDaysIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FileIcon,
  FilePlus2Icon,
  FolderKanbanIcon,
  GitMergeIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  TagIcon,
  UserMinusIcon,
  BotIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';

import { ArtifactReviewDialog } from '@/components/artifact-review-dialog';
import { ArtifactSubmitDialog } from '@/components/artifact-submit-dialog';
import {
  DataToolbar,
  ToolbarSearch,
  ToolbarSelect,
  ToolbarSpacer,
} from '@/components/data-toolbar';
import { EditPersonDialog } from '@/components/edit-person-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { PersonContactDialog } from '@/components/person-contact-dialog';
import {
  PersonDuplicateMergeDialog,
  PersonDuplicateSuggestionBanner,
} from '@/components/person-duplicate-merge-dialog';
import { PersonInteractionDialog } from '@/components/person-interaction-dialog';
import { PersonInteractionsTab } from '@/components/person-interactions-tab';
import { PersonEventLinkDialog } from '@/components/person-event-link-dialog';
import { PersonProjectLinkDialog } from '@/components/person-project-link-dialog';
import { PersonRemovalDialog } from '@/components/person-removal-dialog';
import { TaskDialog } from '@/components/task-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate, initials } from '@/lib/api';
import {
  ARTIFACT_VERSION_STATUS_LABELS,
  ATTENDANCE_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_VARIANTS,
  PARTICIPATION_DECISION_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
  scoreVariant,
} from '@/lib/status-labels';
import type {
  ArtifactSummary,
  EventParticipationSummary,
  PersonDetail,
  PersonDuplicateSuggestion,
} from '@/lib/types';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];
type Tab = 'overview' | 'interactions' | 'events' | 'projects' | 'artifacts';
type ArtifactFilterStatus = 'ALL' | 'DRAFT' | 'SUBMITTED' | 'PENDING_REVIEW' | 'REVIEWED';

const ARTIFACT_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Все статусы' },
  { value: 'SUBMITTED', label: 'Отправленные' },
  { value: 'PENDING_REVIEW', label: 'Ожидают оценки' },
  { value: 'REVIEWED', label: 'Оценённые' },
  { value: 'DRAFT', label: 'Черновики' },
];

export function PersonPageClient({ id, returnTo }: { id: string; returnTo: string }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showArtifact, setShowArtifact] = useState(false);
  const [artifactEventId, setArtifactEventId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showInteraction, setShowInteraction] = useState(false);
  const [showEventLink, setShowEventLink] = useState(false);
  const [showProjectLink, setShowProjectLink] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showRemoval, setShowRemoval] = useState(false);
  const [showDuplicateMerge, setShowDuplicateMerge] = useState(false);
  const [mergeCandidateId, setMergeCandidateId] = useState<string | null>(null);
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<PersonDuplicateSuggestion[]>([]);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const router = useRouter();
  const { can } = useCurrentUser();
  const canEditPerson = can('people.write');
  const canDeletePerson = can('people.delete');
  const canEditContacts = can('contacts.write');
  const canManageTasks = can('tasks.manage');
  const canAddArtifact = can('artifacts.write');
  const canMergeDuplicates = can('duplicates.resolve');

  const reload = useCallback(async () => {
    try {
      setPerson(await api<PersonDetail>(`/people/${id}`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Карточка недоступна'));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reloadDuplicateSuggestions = useCallback(async () => {
    if (!canMergeDuplicates) {
      setDuplicateSuggestions([]);
      return;
    }
    try {
      const result = await api<{ items: PersonDuplicateSuggestion[] }>(
        `/people/${id}/duplicate-suggestions`,
      );
      setDuplicateSuggestions(result.items);
    } catch {
      // Карточка остаётся доступной даже при временной ошибке подсказок:
      // оператор всё равно может найти дубль вручную кнопкой в шапке.
      setDuplicateSuggestions([]);
    }
  }, [canMergeDuplicates, id]);

  useEffect(() => {
    void reloadDuplicateSuggestions();
  }, [reloadDuplicateSuggestions]);

  async function saveNotes() {
    if (!person || notesDraft === null) return;
    setSavingNotes(true);
    try {
      await api(`/people/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: person.version, notes: notesDraft.trim() || null }),
      });
      setNotesDraft(null);
      toast.success('Заметки сохранены');
      await reload();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить заметки'));
    } finally {
      setSavingNotes(false);
    }
  }

  async function completeTask(taskId: string) {
    try {
      await api(`/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Задача завершена');
      await reload();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось завершить задачу'));
    }
  }

  if (error) return <EmptyState title="Не удалось открыть карточку" text={error} />;
  if (!person) return <PersonSkeleton />;

  return (
    <PageStack>
      <PageHeader
        backHref={returnTo}
        backLabel="К списку участников"
        eyebrow="Карточка участника"
        title={
          <span className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="text-sm">
                {initials(person.canonicalFullName)}
              </AvatarFallback>
            </Avatar>
            {person.canonicalFullName}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>
              {person.organization ?? 'Организация не указана'}
              {person.faculty ? ` · ${person.faculty}` : ''}
            </span>
            {person.fromBot && (
              <Badge variant="soft-primary">
                <BotIcon /> Из Telegram-бота
              </Badge>
            )}
            {person.profileNeedsReview && <Badge variant="soft-warning">Нужно уточнить ФИО</Badge>}
            {person.tags?.map((tag) => (
              <Badge key={tag} variant="soft-muted">
                <TagIcon /> {tag}
              </Badge>
            ))}
          </span>
        }
        actions={
          <>
            {canEditPerson && (
              <Button onClick={() => setShowEdit(true)} variant="outline">
                <PencilIcon /> Редактировать
              </Button>
            )}
            {canManageTasks && (
              <Button onClick={() => setShowInteraction(true)} variant="outline">
                <MessageCircleIcon /> Взаимодействие
              </Button>
            )}
            {canEditPerson && (
              <Button onClick={() => setShowEventLink(true)} variant="outline">
                <CalendarDaysIcon /> В мероприятие
              </Button>
            )}
            {canEditPerson && (
              <Button onClick={() => setShowProjectLink(true)} variant="outline">
                <FolderKanbanIcon /> В проект
              </Button>
            )}
            {canMergeDuplicates && (
              <Button
                onClick={() => {
                  setMergeCandidateId(duplicateSuggestions[0]?.id ?? null);
                  setShowDuplicateMerge(true);
                }}
                variant="outline"
              >
                <GitMergeIcon /> Объединить дубль
              </Button>
            )}
            {canAddArtifact && (
              <Button
                onClick={() => {
                  setArtifactEventId(null);
                  setShowArtifact(true);
                }}
              >
                <FilePlus2Icon /> Добавить артефакт
              </Button>
            )}
            {canEditPerson && (
              <Button
                aria-label="Убрать участника"
                onClick={() => setShowRemoval(true)}
                variant="outline"
              >
                <UserMinusIcon />
              </Button>
            )}
          </>
        }
      />

      {canMergeDuplicates && (
        <PersonDuplicateSuggestionBanner
          suggestions={duplicateSuggestions}
          onOpen={(candidateId) => {
            setMergeCandidateId(candidateId);
            setShowDuplicateMerge(true);
          }}
        />
      )}

      {canEditPerson && (
        <PersonRemovalDialog
          canDelete={canDeletePerson}
          onOpenChange={setShowRemoval}
          onRemoved={() => router.push(returnTo)}
          open={showRemoval}
          personId={person.id}
          personName={person.canonicalFullName}
          version={person.version}
        />
      )}

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Отправлял артефакты">
            <Badge variant={person.countableArtifactCount > 0 ? 'soft-success' : 'soft-muted'}>
              {person.countableArtifactCount > 0 ? 'Да' : 'Нет'}
            </Badge>
          </Fact>
          <Fact label="Артефактов" hint="отправленные результаты участника">
            <strong className="text-[15px] font-semibold">{person.countableArtifactCount}</strong>
          </Fact>
          <Fact label="Последний артефакт">
            <strong className="text-[15px] font-semibold">
              {formatDate(person.lastArtifactAt)}
            </strong>
          </Fact>
          <Fact label="Ответственный" hint="комьюнити-менеджер">
            <strong className="text-[15px] font-semibold">
              {person.ownerName ?? 'Не назначен'}
            </strong>
          </Fact>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="interactions">Взаимодействия</TabsTrigger>
          <TabsTrigger value="events">Мероприятия · {person.events.length}</TabsTrigger>
          <TabsTrigger value="projects">Проекты · {person.projects.length}</TabsTrigger>
          <TabsTrigger value="artifacts">Артефакты · {person.artifacts.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Контакты</CardTitle>
                {canEditPerson ? (
                  <CardAction>
                    <Button onClick={() => setShowEdit(true)} size="xs" variant="ghost">
                      <PencilIcon /> Изменить
                    </Button>
                  </CardAction>
                ) : canEditContacts ? (
                  <CardAction>
                    <Button onClick={() => setShowContact(true)} size="xs" variant="ghost">
                      <PlusIcon /> Добавить
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {person.contacts.map((contact) => (
                  <div className="flex items-start gap-2.5" key={contact.id}>
                    <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                      {contact.type === 'EMAIL' ? (
                        <MailIcon className="size-4" />
                      ) : contact.type === 'PHONE' ? (
                        <PhoneIcon className="size-4" />
                      ) : (
                        <MessageCircleIcon className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 leading-snug">
                      <small className="text-muted-foreground block text-xs">
                        {contact.type}
                        {contact.isIdentity
                          ? ' · главный идентификатор'
                          : contact.isPrimary
                            ? ' · основной'
                            : ''}
                      </small>
                      <strong className="block text-[13px] font-medium break-words">
                        {contact.rawValue}
                      </strong>
                      {contact.isIdentity && contact.telegramUserId && (
                        <em className="text-muted-foreground block text-xs not-italic">
                          Telegram ID: {contact.telegramUserId}
                        </em>
                      )}
                    </span>
                  </div>
                ))}
                {person.contacts.length === 0 && (
                  <p className="text-muted-foreground text-[13px]">Контакты ещё не указаны.</p>
                )}
                <MarketingConsent
                  canEdit={canEditPerson}
                  consent={person.marketingConsent}
                  onChanged={reload}
                  personId={person.id}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Принадлежность</CardTitle>
                {canEditPerson && (
                  <CardAction>
                    <Button onClick={() => setShowEdit(true)} size="xs" variant="ghost">
                      <PencilIcon /> Изменить
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {person.affiliations.map((item) => (
                  <div className="flex items-start gap-2.5" key={item.id}>
                    <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                      <MapPinIcon className="size-4" />
                    </span>
                    <span className="min-w-0 leading-snug">
                      <small className="text-muted-foreground block text-xs">
                        {item.role ?? 'Участник'}
                      </small>
                      <strong className="block text-[13px] font-medium">{item.organization}</strong>
                      {item.faculty && (
                        <em className="text-muted-foreground block text-xs not-italic">
                          {item.faculty}
                        </em>
                      )}
                    </span>
                  </div>
                ))}
                {person.affiliations.length === 0 && (
                  <p className="text-muted-foreground text-[13px]">Организация не связана.</p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Данные из источников и ручные записи
                  </p>
                  <CardTitle className="mt-1.5">Заметки</CardTitle>
                </div>
                {canEditPerson && notesDraft === null && (
                  <CardAction>
                    <Button
                      onClick={() => setNotesDraft(person.notes ?? '')}
                      size="xs"
                      variant="ghost"
                    >
                      <PencilIcon /> Редактировать
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent>
                {notesDraft !== null ? (
                  <div className="space-y-2">
                    <Textarea
                      aria-label="Заметки по участнику"
                      className="resize-y"
                      disabled={savingNotes}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      rows={14}
                      value={notesDraft}
                    />
                    <div className="flex gap-2">
                      <Button disabled={savingNotes} onClick={() => void saveNotes()} size="sm">
                        {savingNotes ? 'Сохраняем…' : 'Сохранить'}
                      </Button>
                      <Button
                        disabled={savingNotes}
                        onClick={() => setNotesDraft(null)}
                        size="sm"
                        variant="outline"
                      >
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : person.notes ? (
                  <pre className="font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                    {person.notes}
                  </pre>
                ) : (
                  <p className="text-muted-foreground text-[13px]">Заметок пока нет.</p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Следующий шаг
                  </p>
                  <CardTitle className="mt-1.5">Задачи</CardTitle>
                </div>
                {canManageTasks && (
                  <CardAction>
                    <Button onClick={() => setShowTask(true)} size="xs" variant="ghost">
                      <PlusIcon /> Создать задачу
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className={person.tasks.length ? 'space-y-2' : 'p-0'}>
                {person.tasks.length ? (
                  person.tasks.map((task) => {
                    const open = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
                    return (
                      <div
                        className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                        key={task.id}
                      >
                        <Checkbox
                          aria-label={`Завершить задачу «${task.title}»`}
                          checked={task.status === 'DONE'}
                          disabled={!open || !canManageTasks}
                          onCheckedChange={() => void completeTask(task.id)}
                        />
                        <span className="min-w-0 flex-1 leading-snug">
                          <strong className="block text-[13px] font-medium">{task.title}</strong>
                          <small className="text-muted-foreground flex items-center gap-1 text-xs">
                            <CalendarDaysIcon className="size-3.5" /> {formatDate(task.dueAt)}
                          </small>
                        </span>
                        <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
                          {TASK_STATUS_LABELS[task.status]}
                        </Badge>
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    title="Нет открытых задач"
                    text="Добавьте следующий шаг для участника."
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Артефакты</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <strong className="tabular block text-2xl font-semibold">
                    {person.countableArtifactCount}
                  </strong>
                  <span className="text-muted-foreground text-xs">уникальных учитываемых</span>
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
                  <Clock3Icon className="size-4" />
                  <span>Последний</span>
                  <strong className="text-foreground font-medium">
                    {formatDate(person.lastArtifactAt)}
                  </strong>
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
                  <Badge
                    className="tabular min-w-8 justify-center"
                    variant={scoreVariant(person.latestArtifactScore)}
                  >
                    {person.latestArtifactScore ?? '—'}
                  </Badge>
                  <span>Последняя оценка</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="interactions">
          <PersonInteractionsTab
            canAdd={canManageTasks}
            onAdd={() => setShowInteraction(true)}
            personId={person.id}
            refreshKey={timelineRefreshKey}
          />
        </TabsContent>

        <TabsContent value="events">
          <EventsTab
            canLink={canEditPerson}
            onLink={() => setShowEventLink(true)}
            person={person}
            onOpenArtifact={setSelectedVersionId}
            canAddArtifact={canAddArtifact}
            onAddArtifact={(eventId) => {
              setArtifactEventId(eventId);
              setShowArtifact(true);
            }}
            onChanged={reload}
          />
        </TabsContent>

        <TabsContent value="artifacts">
          <ArtifactsTab
            canAdd={canAddArtifact}
            onAdd={() => setShowArtifact(true)}
            onOpen={setSelectedVersionId}
            person={person}
          />
        </TabsContent>

        <TabsContent value="projects">
          <ProjectsTab person={person} />
        </TabsContent>
      </Tabs>

      {showArtifact && (
        <ArtifactSubmitDialog
          events={person.events}
          projects={person.projects}
          defaultEventId={artifactEventId}
          onClose={() => setShowArtifact(false)}
          onCreated={async () => {
            setShowArtifact(false);
            await reload();
            setTab('artifacts');
          }}
          personId={person.id}
        />
      )}
      {showEdit && (
        <EditPersonDialog
          canEditContacts={canEditContacts}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            await reload();
          }}
          person={person}
        />
      )}
      {showContact && (
        <PersonContactDialog
          onClose={() => setShowContact(false)}
          onSaved={reload}
          personId={person.id}
        />
      )}
      {showInteraction && (
        <PersonInteractionDialog
          onClose={() => setShowInteraction(false)}
          onSaved={async () => {
            setTimelineRefreshKey((value) => value + 1);
            setTab('interactions');
            await reload();
          }}
          personId={person.id}
        />
      )}
      {showEventLink && (
        <PersonEventLinkDialog
          existingEventIds={person.events.map((event) => event.id)}
          onClose={() => setShowEventLink(false)}
          onLinked={async () => {
            await reload();
            setTab('events');
          }}
          personId={person.id}
        />
      )}
      {showProjectLink && (
        <PersonProjectLinkDialog
          existingProjectIds={person.projects.map((project) => project.id)}
          onClose={() => setShowProjectLink(false)}
          onLinked={async () => {
            await reload();
            setTab('projects');
          }}
          personId={person.id}
        />
      )}
      {showDuplicateMerge && (
        <PersonDuplicateMergeDialog
          current={person}
          suggestions={duplicateSuggestions}
          initialCandidateId={mergeCandidateId}
          onOpenChange={(open) => {
            setShowDuplicateMerge(open);
            if (!open) setMergeCandidateId(null);
          }}
          onMerged={async (masterPersonId) => {
            if (masterPersonId !== person.id) {
              router.replace(
                `/participants/${masterPersonId}?returnTo=${encodeURIComponent(returnTo)}`,
              );
              return;
            }
            await Promise.all([reload(), reloadDuplicateSuggestions()]);
          }}
        />
      )}
      <TaskDialog
        onOpenChange={setShowTask}
        onSaved={() => void reload()}
        open={showTask}
        person={{ id: person.id, canonicalFullName: person.canonicalFullName }}
      />
      {selectedVersionId && (
        <ArtifactReviewDialog
          onClose={() => setSelectedVersionId(null)}
          onReviewed={reload}
          versionId={selectedVersionId}
        />
      )}
    </PageStack>
  );
}

const CONSENT_CHANNELS = [
  { key: 'telegram', purpose: 'MARKETING_TELEGRAM', label: 'Telegram' },
  { key: 'email', purpose: 'MARKETING_EMAIL', label: 'Email' },
] as const;

/**
 * Отписка от рассылок — отдельное от архива состояние: человек остаётся
 * участником со всей историей, но выпадает из аудиторий кампаний.
 */
function MarketingConsent({
  personId,
  consent,
  canEdit,
  onChanged,
}: {
  personId: string;
  consent: PersonDetail['marketingConsent'];
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  if (!consent) return null;

  async function record(purpose: string, status: 'GRANTED' | 'WITHDRAWN') {
    setSaving(purpose);
    try {
      await api(`/people/${personId}/consent`, {
        method: 'POST',
        body: JSON.stringify({ purpose, status }),
      });
      toast.success(status === 'WITHDRAWN' ? 'Отписка записана' : 'Согласие записано');
      await onChanged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось записать согласие'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="border-t pt-3">
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        Рассылки
      </p>
      <div className="mt-2 space-y-2">
        {CONSENT_CHANNELS.map((channel) => {
          const status = consent[channel.key];
          const optedOut = status === 'WITHDRAWN' || status === 'DENIED';
          return (
            <div className="flex items-center justify-between gap-2" key={channel.key}>
              <span className="text-[13px]">
                {channel.label}
                <Badge className="ml-2" variant={optedOut ? 'soft-warning' : 'soft-success'}>
                  {optedOut
                    ? 'не писать'
                    : status === 'GRANTED'
                      ? 'согласие есть'
                      : 'не спрашивали'}
                </Badge>
              </span>
              {canEdit && (
                <Button
                  disabled={saving === channel.purpose}
                  onClick={() => record(channel.purpose, optedOut ? 'GRANTED' : 'WITHDRAWN')}
                  size="xs"
                  variant="ghost"
                >
                  {optedOut ? 'Вернуть' : 'Отписать'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </p>
      {children}
      {hint && <p className="text-muted-foreground text-xs leading-snug">{hint}</p>}
    </div>
  );
}

function PersonSkeleton() {
  return (
    <PageStack>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-9 w-80" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    </PageStack>
  );
}

function formatEventPeriod(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt && !endsAt) return 'Дата не указана';
  if (startsAt && endsAt) return `${formatDate(startsAt, true)} — ${formatDate(endsAt, true)}`;
  return formatDate(startsAt ?? endsAt, true);
}

function EventsTab({
  person,
  onOpenArtifact,
  canLink,
  onLink,
  canAddArtifact,
  onAddArtifact,
  onChanged,
}: {
  person: PersonDetail;
  onOpenArtifact: (versionId: string) => void;
  canLink: boolean;
  onLink: () => void;
  canAddArtifact: boolean;
  onAddArtifact: (eventId: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [editingParticipationId, setEditingParticipationId] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] =
    useState<EventParticipationSummary['decision']>('UNKNOWN');
  const [attendanceDraft, setAttendanceDraft] =
    useState<EventParticipationSummary['attendance']>('UNKNOWN');
  const [resultDraft, setResultDraft] = useState('');
  const [savingParticipation, setSavingParticipation] = useState(false);

  function editParticipation(participation: EventParticipationSummary) {
    setEditingParticipationId(participation.id);
    setDecisionDraft(participation.decision);
    setAttendanceDraft(participation.attendance);
    setResultDraft(participation.result ?? '');
  }

  async function saveParticipation(eventId: string) {
    setSavingParticipation(true);
    try {
      await api(`/events/${eventId}/participants/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: decisionDraft,
          attendance: attendanceDraft,
          result: resultDraft.trim() || null,
        }),
      });
      toast.success('Участие в мероприятии сохранено');
      setEditingParticipationId(null);
      await onChanged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить участие'));
    } finally {
      setSavingParticipation(false);
    }
  }

  if (!person.events.length) {
    return (
      <Card>
        <EmptyState
          icon={CalendarDaysIcon}
          title="Мероприятия не найдены"
          text="В импортных и текущих данных пока нет подтверждённых записей участия."
          action={
            canLink ? (
              <Button onClick={onLink} size="sm">
                <PlusIcon /> Добавить в мероприятие
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {canLink && (
        <div className="flex justify-end">
          <Button onClick={onLink} size="sm" variant="outline">
            <PlusIcon /> Добавить в мероприятие
          </Button>
        </div>
      )}
      {person.events.map((event) => (
        <Card key={event.id}>
          <CardHeader>
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Мероприятие
              </p>
              <CardTitle className="mt-1.5">{event.name}</CardTitle>
              <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-[13px]">
                <CalendarDaysIcon className="size-3.5" />
                {formatEventPeriod(event.startsAt, event.endsAt)}
              </p>
            </div>
            <CardAction>
              <Badge variant={EVENT_STATUS_VARIANTS[event.status] ?? 'soft-muted'}>
                {EVENT_STATUS_LABELS[event.status] ?? event.status}
              </Badge>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-4">
            {event.participations.map((participation, index) => (
              <section
                className="bg-muted/40 space-y-3 rounded-lg border p-3"
                key={participation.id}
              >
                {event.participations.length > 1 && (
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    Запись участия {index + 1}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Fact label="Решение">
                    {editingParticipationId === participation.id ? (
                      <Select
                        disabled={savingParticipation}
                        onValueChange={(value) =>
                          setDecisionDraft(value as EventParticipationSummary['decision'])
                        }
                        value={decisionDraft}
                      >
                        <SelectTrigger aria-label="Решение по участию" className="mt-1">
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
                    ) : (
                      <strong className="block text-[13px] font-medium">
                        {PARTICIPATION_DECISION_LABELS[participation.decision] ??
                          participation.decision}
                      </strong>
                    )}
                  </Fact>
                  <Fact label="Участие">
                    {editingParticipationId === participation.id ? (
                      <Select
                        disabled={savingParticipation}
                        onValueChange={(value) =>
                          setAttendanceDraft(value as EventParticipationSummary['attendance'])
                        }
                        value={attendanceDraft}
                      >
                        <SelectTrigger aria-label="Посещение мероприятия" className="mt-1">
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
                    ) : (
                      <strong className="block text-[13px] font-medium">
                        {ATTENDANCE_LABELS[participation.attendance] ?? participation.attendance}
                      </strong>
                    )}
                  </Fact>
                  <Fact label="Источник данных">
                    <strong className="block text-[13px] font-medium">
                      {participation.dataOrigin === 'LEGACY_IMPORT' ? 'Импорт из таблицы' : 'CRM'}
                    </strong>
                  </Fact>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium">Результат участия</p>
                    {canLink && editingParticipationId !== participation.id && (
                      <Button
                        onClick={() => editParticipation(participation)}
                        size="xs"
                        variant="ghost"
                      >
                        <PencilIcon /> Изменить
                      </Button>
                    )}
                  </div>
                  {editingParticipationId === participation.id ? (
                    <div className="space-y-2">
                      <Textarea
                        disabled={savingParticipation}
                        onChange={(event) => setResultDraft(event.target.value)}
                        placeholder="Например: выступил, занял 2 место; заявка одобрена"
                        rows={3}
                        value={resultDraft}
                      />
                      <div className="flex gap-2">
                        <Button
                          disabled={savingParticipation}
                          onClick={() => void saveParticipation(event.id)}
                          size="sm"
                        >
                          {savingParticipation ? 'Сохраняем…' : 'Сохранить'}
                        </Button>
                        <Button
                          disabled={savingParticipation}
                          onClick={() => setEditingParticipationId(null)}
                          size="sm"
                          variant="outline"
                        >
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-[13px] whitespace-pre-wrap">
                      {participation.result ?? 'Результат пока не заполнен.'}
                    </p>
                  )}
                </div>

                {(participation.registeredAt || participation.attendedAt) && (
                  <p className="text-muted-foreground text-xs">
                    {participation.registeredAt &&
                      `Регистрация: ${formatDate(participation.registeredAt, true)}`}
                    {participation.registeredAt && participation.attendedAt && ' · '}
                    {participation.attendedAt &&
                      `Участие: ${formatDate(participation.attendedAt, true)}`}
                  </p>
                )}

                {participation.comments.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[13px] font-medium">Комментарии из таблицы</p>
                    {participation.comments.map((comment) => (
                      <p className="text-muted-foreground text-[13px]" key={comment}>
                        {comment}
                      </p>
                    ))}
                  </div>
                )}

                {participation.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {participation.sources.map((source) => (
                      <Badge key={source.id} variant="soft-muted">
                        {source.sheetName} · строка {source.rowNumber} · {source.fileName}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>
            ))}

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium">Артефакты участника с мероприятия</h3>
                {canAddArtifact && (
                  <Button onClick={() => onAddArtifact(event.id)} size="xs" variant="outline">
                    <FilePlus2Icon /> Добавить артефакт
                  </Button>
                )}
              </div>
              {event.artifacts.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {event.artifacts.map((artifact) => (
                    <button
                      className="hover:bg-accent/50 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-60"
                      disabled={!artifact.latestVersionId}
                      key={artifact.id}
                      onClick={() =>
                        artifact.latestVersionId && onOpenArtifact(artifact.latestVersionId)
                      }
                      type="button"
                    >
                      <FileIcon className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0 flex-1 leading-snug">
                        <strong className="block truncate text-[13px] font-medium">
                          {artifact.title}
                        </strong>
                        <small className="text-muted-foreground block text-xs">
                          {artifact.typeName} · {formatDate(artifact.submittedAt)}
                        </small>
                      </span>
                      <ExternalLinkIcon className="text-muted-foreground size-4 shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-[13px]">Связанных артефактов пока нет.</p>
              )}
            </section>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProjectsTab({ person }: { person: PersonDetail }) {
  if (!person.projects.length) {
    return (
      <Card>
        <EmptyState
          icon={FolderKanbanIcon}
          title="Проектов пока нет"
          text="Нажмите «В проект» в верхней части карточки или откройте реестр проектов."
          action={
            <Button asChild variant="outline">
              <a href="/projects">Открыть проекты</a>
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {person.projects.map((project) => (
        <Card key={project.id}>
          <CardHeader>
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                {project.role}
              </p>
              <CardTitle className="mt-1.5">
                <a className="hover:underline" href={`/projects/${project.id}`}>
                  {project.name}
                </a>
              </CardTitle>
            </div>
            <CardAction>
              <Badge variant={project.status === 'ACTIVE' ? 'soft-success' : 'soft-muted'}>
                {project.status}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.description && (
              <p className="text-muted-foreground line-clamp-3 text-[13px]">
                {project.description}
              </p>
            )}
            <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>{project.memberCount} участников</span>
              <span>{project.artifactCount} артефактов</span>
              <span>{project.eventCount} мероприятий</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

/** Статус последней версии артефакта: черновик, ожидание приёмки или готовое решение. */
function artifactStatusBadge(artifact: ArtifactSummary): { label: string; variant: BadgeVariant } {
  if (!artifact.latestVersionStatus) return { label: 'Нет версии', variant: 'soft-muted' };
  if (artifact.latestVersionStatus === 'SUBMITTED') {
    return artifact.score == null
      ? { label: 'Ожидает оценки', variant: 'soft-warning' }
      : { label: 'Оценён', variant: 'soft-success' };
  }
  return {
    label:
      ARTIFACT_VERSION_STATUS_LABELS[artifact.latestVersionStatus] ?? artifact.latestVersionStatus,
    variant: 'soft-muted',
  };
}

function ArtifactsTab({
  person,
  canAdd,
  onAdd,
  onOpen,
}: {
  person: PersonDetail;
  canAdd: boolean;
  onAdd: () => void;
  onOpen: (versionId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [eventFilter, setEventFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<ArtifactFilterStatus>('ALL');

  const eventNames = useMemo(
    () => new Map(person.events.map((event) => [event.id, event.name])),
    [person.events],
  );
  const typeOptions = useMemo(
    () =>
      [...new Set(person.artifacts.map((artifact) => artifact.typeName))].sort((left, right) =>
        left.localeCompare(right, 'ru'),
      ),
    [person.artifacts],
  );
  const eventOptions = useMemo(() => {
    const artifactEventIds = new Set(
      person.artifacts
        .map((artifact) => artifact.eventId)
        .filter((eventId): eventId is string => Boolean(eventId)),
    );
    return person.events
      .filter((event) => artifactEventIds.has(event.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [person.artifacts, person.events]);
  const filteredArtifacts = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);
    return person.artifacts.filter((artifact) => {
      const eventName = artifact.eventId ? eventNames.get(artifact.eventId) : undefined;
      const matchesQuery =
        !normalizedQuery ||
        normalizeSearchValue(
          [
            artifact.title,
            artifact.typeName,
            eventName,
            ...(artifact.authors?.map((author) => author.name) ?? []),
          ].join(' '),
        ).includes(normalizedQuery);
      const matchesType = typeFilter === 'ALL' || artifact.typeName === typeFilter;
      const matchesEvent =
        eventFilter === 'ALL' ||
        (eventFilter === 'NONE' ? !artifact.eventId : artifact.eventId === eventFilter);
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'DRAFT' && artifact.latestVersionStatus === 'DRAFT') ||
        (statusFilter === 'SUBMITTED' && artifact.latestVersionStatus === 'SUBMITTED') ||
        (statusFilter === 'PENDING_REVIEW' &&
          artifact.latestVersionStatus === 'SUBMITTED' &&
          artifact.score == null) ||
        (statusFilter === 'REVIEWED' && artifact.score != null);
      return matchesQuery && matchesType && matchesEvent && matchesStatus;
    });
  }, [eventFilter, eventNames, person.artifacts, query, statusFilter, typeFilter]);
  const hasFilters =
    Boolean(query.trim()) ||
    typeFilter !== 'ALL' ||
    eventFilter !== 'ALL' ||
    statusFilter !== 'ALL';

  function resetFilters() {
    setQuery('');
    setTypeFilter('ALL');
    setEventFilter('ALL');
    setStatusFilter('ALL');
  }

  if (!person.artifacts.length) {
    return (
      <Card>
        <EmptyState
          icon={FilePlus2Icon}
          title="Артефактов пока нет"
          text="Добавьте первый отправленный результат участника."
          {...(canAdd
            ? {
                action: (
                  <Button onClick={onAdd} type="button">
                    <PlusIcon /> Добавить артефакт
                  </Button>
                ),
              }
            : {})}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <DataToolbar>
        <ToolbarSearch
          label="Поиск артефактов"
          onChange={setQuery}
          placeholder="Название, тип, автор или мероприятие"
          value={query}
        />
        <ToolbarSelect
          label="Тип"
          onChange={setTypeFilter}
          options={[
            { value: 'ALL', label: 'Все типы' },
            ...typeOptions.map((typeName) => ({ value: typeName, label: typeName })),
          ]}
          value={typeFilter}
        />
        <ToolbarSelect
          label="Мероприятие"
          onChange={setEventFilter}
          options={[
            { value: 'ALL', label: 'Все мероприятия' },
            { value: 'NONE', label: 'Без мероприятия' },
            ...eventOptions.map((event) => ({ value: event.id, label: event.name })),
          ]}
          value={eventFilter}
          width="w-56"
        />
        <ToolbarSelect
          label="Статус"
          onChange={(value) => setStatusFilter(value as ArtifactFilterStatus)}
          options={ARTIFACT_STATUS_OPTIONS}
          value={statusFilter}
        />
        <ToolbarSpacer />
        {hasFilters && (
          <Button onClick={resetFilters} size="sm" type="button" variant="ghost">
            Сбросить
          </Button>
        )}
        {canAdd && (
          <Button onClick={onAdd} size="sm" type="button">
            <PlusIcon /> Добавить
          </Button>
        )}
      </DataToolbar>

      <p className="text-muted-foreground text-[13px]">
        Показано {filteredArtifacts.length} из {person.artifacts.length}
      </p>

      {filteredArtifacts.length ? (
        <div className="space-y-2">
          {filteredArtifacts.map((artifact) => {
            const eventName = artifact.eventId ? eventNames.get(artifact.eventId) : undefined;
            const status = artifactStatusBadge(artifact);
            return (
              <Card className="flex-row items-center gap-3 px-4 py-3" key={artifact.id}>
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <FileIcon className="size-4" />
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <small className="text-muted-foreground block text-xs">
                    {artifact.typeName} · версия {artifact.latestVersionNumber ?? '—'}
                  </small>
                  <h3 className="truncate text-[14px] font-medium">{artifact.title}</h3>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span>{formatDate(artifact.submittedAt, true)}</span>
                    {eventName && (
                      <span className="flex items-center gap-1">
                        <CalendarDaysIcon className="size-3" /> {eventName}
                      </span>
                    )}
                    {artifact.projectName && (
                      <span className="flex items-center gap-1">
                        <FolderKanbanIcon className="size-3" /> {artifact.projectName}
                      </span>
                    )}
                    {artifact.authors?.length ? (
                      <span className="truncate">
                        {artifact.authors.map((author) => author.name).join(', ')}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <small className="text-muted-foreground block text-xs">Оценка</small>
                  {artifact.score == null ? (
                    <span className="text-muted-foreground text-[13px]">Не оценён</span>
                  ) : (
                    <Badge
                      className="tabular mt-0.5 min-w-11 justify-center text-sm"
                      variant={scoreVariant(artifact.score)}
                    >
                      {artifact.score}/10
                    </Badge>
                  )}
                </div>

                <Button
                  aria-label={`Открыть последнюю версию «${artifact.title}»`}
                  disabled={!artifact.latestVersionId}
                  onClick={() => artifact.latestVersionId && onOpen(artifact.latestVersionId)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <ExternalLinkIcon />
                </Button>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="По этим условиям ничего не найдено"
            text="Измените строку поиска или один из фильтров."
            action={
              <Button onClick={resetFilters} type="button" variant="outline">
                Сбросить фильтры
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
