'use client';

import {
  CalendarDaysIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FileIcon,
  FilePlus2Icon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  TagIcon,
  UserMinusIcon,
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
import { PersonInteractionDialog } from '@/components/person-interaction-dialog';
import { PersonRemovalDialog } from '@/components/person-removal-dialog';
import { StatusBadge } from '@/components/status-badge';
import { TaskDialog } from '@/components/task-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { ArtifactSummary, PersonDetail } from '@/lib/types';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];
type Tab = 'overview' | 'events' | 'artifacts' | 'history';
type ArtifactFilterStatus = 'ALL' | 'DRAFT' | 'SUBMITTED' | 'PENDING_REVIEW' | 'REVIEWED';

const ARTIFACT_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Все статусы' },
  { value: 'SUBMITTED', label: 'Отправленные' },
  { value: 'PENDING_REVIEW', label: 'Ожидают оценки' },
  { value: 'REVIEWED', label: 'Оценённые' },
  { value: 'DRAFT', label: 'Черновики' },
];

export function PersonPageClient({ id }: { id: string }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showArtifact, setShowArtifact] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showInteraction, setShowInteraction] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showRemoval, setShowRemoval] = useState(false);
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

  const statusExplanation =
    person.activationState === 'UNKNOWN_LEGACY'
      ? 'Исторические данные неполны — отсутствие артефактов не трактуется как неактивность.'
      : person.activationState === 'NOT_ACTIVATED'
        ? 'После baseline ещё не зафиксировано ни одного отправленного артефакта.'
        : person.activityStatus === 'ACTIVE'
          ? `Последний учитываемый артефакт: ${formatDate(person.lastArtifactAt, true)}.`
          : `Статус рассчитан по последнему артефакту от ${formatDate(person.lastArtifactAt, true)}.`;

  return (
    <PageStack>
      <PageHeader
        backHref="/participants"
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
            {canAddArtifact && (
              <Button onClick={() => setShowArtifact(true)}>
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

      {canEditPerson && (
        <PersonRemovalDialog
          canDelete={canDeletePerson}
          onOpenChange={setShowRemoval}
          onRemoved={() => router.push('/participants')}
          open={showRemoval}
          personId={person.id}
          personName={person.canonicalFullName}
          version={person.version}
        />
      )}

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Fact
            label="Активация"
            hint={
              person.activatedAt ? `с ${formatDate(person.activatedAt)}` : 'нет подтверждённой даты'
            }
          >
            <strong className="text-[15px] font-semibold">
              {person.activationState === 'ACTIVATED'
                ? 'Активирован'
                : person.activationState === 'NOT_ACTIVATED'
                  ? 'Не активирован'
                  : 'Неизвестно'}
            </strong>
          </Fact>
          <Fact label="Текущая активность" hint={statusExplanation}>
            <StatusBadge activity={person.activityStatus} activation={person.activationState} />
          </Fact>
          <Fact label="Следующая граница" hint="252 / 504 часа по версии правил">
            <strong className="text-[15px] font-semibold">
              {formatDate(person.nextStatusTransitionAt, true)}
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
          <TabsTrigger value="events">Мероприятия · {person.events.length}</TabsTrigger>
          <TabsTrigger value="artifacts">Артефакты · {person.artifacts.length}</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            {person.headQuality && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div>
                    <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      Индекс качества головы (0–100)
                    </p>
                    <CardTitle className="mt-1.5">
                      Q_head: {person.headQuality.score} — {person.headQuality.bandLabel}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {(
                    [
                      [
                        person.headQuality.components.artifactQuality,
                        'качество артефактов за 90 дней (вес 35 %)',
                      ],
                      [
                        person.headQuality.components.regularity,
                        'регулярность качественных артефактов (вес 25 %)',
                      ],
                      [
                        person.headQuality.components.projectInvolvement,
                        'проектная включённость (вес 20 %)',
                      ],
                      [
                        person.headQuality.components.commercialApplicability,
                        'коммерческая применимость (вес 20 %)',
                      ],
                    ] as const
                  ).map(([value, caption]) => (
                    <div key={caption} className="space-y-1">
                      <strong className="tabular block text-xl font-semibold">{value}</strong>
                      <span className="text-muted-foreground block text-xs leading-snug">
                        {caption}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

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

        <TabsContent value="events">
          <EventsTab person={person} onOpenArtifact={setSelectedVersionId} />
        </TabsContent>

        <TabsContent value="artifacts">
          <ArtifactsTab
            canAdd={canAddArtifact}
            onAdd={() => setShowArtifact(true)}
            onOpen={setSelectedVersionId}
            person={person}
          />
        </TabsContent>

        <TabsContent value="history">
          <TimelineTab person={person} />
        </TabsContent>
      </Tabs>

      {showArtifact && (
        <ArtifactSubmitDialog
          events={person.events}
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
        <PersonInteractionDialog onClose={() => setShowInteraction(false)} personId={person.id} />
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
                  {optedOut ? 'не писать' : status === 'GRANTED' ? 'согласие есть' : 'не спрашивали'}
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
}: {
  person: PersonDetail;
  onOpenArtifact: (versionId: string) => void;
}) {
  if (!person.events.length) {
    return (
      <Card>
        <EmptyState
          icon={CalendarDaysIcon}
          title="Мероприятия не найдены"
          text="В импортных и текущих данных пока нет подтверждённых записей участия."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
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
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Fact label="Роль">
                    <strong className="block text-[13px] font-medium">
                      {participation.role ?? 'Не указана в источнике'}
                    </strong>
                  </Fact>
                  <Fact label="Решение">
                    <strong className="block text-[13px] font-medium">
                      {PARTICIPATION_DECISION_LABELS[participation.decision] ??
                        participation.decision}
                    </strong>
                  </Fact>
                  <Fact label="Участие">
                    <strong className="block text-[13px] font-medium">
                      {ATTENDANCE_LABELS[participation.attendance] ?? participation.attendance}
                    </strong>
                  </Fact>
                  <Fact label="Источник данных">
                    <strong className="block text-[13px] font-medium">
                      {participation.dataOrigin === 'LEGACY_IMPORT' ? 'Импорт из таблицы' : 'CRM'}
                    </strong>
                  </Fact>
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
              <h3 className="text-[13px] font-medium">Артефакты участника с мероприятия</h3>
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
          text="Первый отправленный результат активирует участника."
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

function TimelineTab({ person }: { person: PersonDetail }) {
  return (
    <Card>
      <CardContent>
        <ol className="space-y-5 border-l pl-6">
          <li className="relative">
            <span className="bg-success ring-card absolute top-1.5 -left-7 size-2 rounded-full ring-4" />
            <small className="text-muted-foreground block text-xs">
              {formatDate(person.activatedAt, true)}
            </small>
            <strong className="block text-[13px] font-medium">
              {person.activationState === 'ACTIVATED'
                ? 'Участник активирован'
                : 'Карточка участника создана'}
            </strong>
            <p className="text-muted-foreground text-[13px]">
              Событие рассчитано из первичных данных и сохранено в истории статусов.
            </p>
          </li>
          {person.artifacts.map((artifact) => (
            <li className="relative" key={artifact.id}>
              <span className="bg-primary ring-card absolute top-1.5 -left-7 size-2 rounded-full ring-4" />
              <small className="text-muted-foreground block text-xs">
                {formatDate(artifact.submittedAt, true)}
              </small>
              <strong className="block text-[13px] font-medium">Артефакт: {artifact.title}</strong>
              <p className="text-muted-foreground text-[13px]">
                {artifact.typeName} ·{' '}
                {artifact.score == null ? 'не оценён' : `оценка ${artifact.score}/10`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
