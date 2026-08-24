'use client';

import {
  CalendarDaysIcon,
  DownloadIcon,
  FileCheck2Icon,
  FilePlus2Icon,
  FolderKanbanIcon,
  PencilIcon,
  PlusIcon,
  UserMinusIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ArtifactReviewDialog } from '@/components/artifact-review-dialog';
import { ArtifactSubmitDialog } from '@/components/artifact-submit-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { ProjectDialog, PROJECT_STATUS_LABELS } from '@/components/project-dialog';
import { ProjectEventDialog } from '@/components/project-event-dialog';
import { ProjectMemberDialog } from '@/components/project-member-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import { EVENT_STATUS_LABELS, EVENT_STATUS_VARIANTS, scoreVariant } from '@/lib/status-labels';
import type {
  ArtifactSummary,
  PersonDetail,
  ProjectDetail,
  ProjectMemberSummary,
} from '@/lib/types';

export function ProjectPageClient({ id }: { id: string }) {
  const { can } = useCurrentUser();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showMember, setShowMember] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [showAuthor, setShowAuthor] = useState(false);
  const [artifactPerson, setArtifactPerson] = useState<PersonDetail | null>(null);
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<ProjectMemberSummary | null>(null);
  const [roleDraft, setRoleDraft] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [resultDraft, setResultDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const [detail, artifactData] = await Promise.all([
        api<ProjectDetail>(`/projects/${id}`),
        api<{ items: ArtifactSummary[] }>(`/artifacts?projectId=${id}&archive=all&limit=500`),
      ]);
      setProject(detail);
      setArtifacts(artifactData.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Проект недоступен'));
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  async function saveRole() {
    if (!project || !editingMember) return;
    try {
      await api(`/projects/${project.id}/members/${editingMember.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: roleDraft.trim() }),
      });
      toast.success('Роль обновлена');
      setEditingMember(null);
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось изменить роль'));
    }
  }

  async function removeMember(member: ProjectMemberSummary) {
    if (!project) return;
    try {
      await api(`/projects/${project.id}/members/${member.id}`, { method: 'DELETE' });
      toast.success('Участник убран из проекта');
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось убрать участника'));
    }
  }

  async function saveEventResult(eventId: string) {
    if (!project) return;
    try {
      await api(`/events/${eventId}/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ result: resultDraft.trim() || null }),
      });
      toast.success('Результат проекта сохранён');
      setEditingEventId(null);
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить результат'));
    }
  }

  async function chooseArtifactAuthor(personId: string) {
    setShowAuthor(false);
    try {
      setArtifactPerson(await api<PersonDetail>(`/people/${personId}`));
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось открыть участника'));
    }
  }

  if (error)
    return (
      <Card>
        <EmptyState title="Не удалось открыть проект" text={error} />
      </Card>
    );
  if (!project)
    return (
      <PageStack>
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </PageStack>
    );
  const canWrite = can('people.write');
  const canWriteEvents = can('events.write');
  const canAddArtifact = can('artifacts.write');

  return (
    <PageStack>
      <PageHeader
        backHref="/projects"
        backLabel="К списку проектов"
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <FolderKanbanIcon className="size-3.5" /> Проект
          </span>
        }
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={project.status === 'ACTIVE' ? 'soft-success' : 'soft-muted'}>
              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
            </Badge>
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3.5" />
              {project.members.length}
            </span>
            <span className="inline-flex items-center gap-1">
              <FileCheck2Icon className="size-3.5" />
              {artifacts.length}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDaysIcon className="size-3.5" />
              {project.events.length}
            </span>
          </span>
        }
        actions={
          <>
            {can('exports.bulk') && (
              <Button asChild>
                <a href={`/api/exports/projects/${project.id}/package.zip`}>
                  <DownloadIcon /> Скачать ZIP
                </a>
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setShowEdit(true)} variant="outline">
                <PencilIcon /> Редактировать
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="members">Участники · {project.members.length}</TabsTrigger>
          <TabsTrigger value="artifacts">Артефакты · {artifacts.length}</TabsTrigger>
          <TabsTrigger value="events">Мероприятия · {project.events.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Описание</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[13px] whitespace-pre-wrap">
                  {project.description || 'Описание пока не заполнено.'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Параметры</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Fact label="Период">
                  {project.startsAt ? formatDate(project.startsAt, true) : 'Не указан'}
                  {project.endsAt ? ` — ${formatDate(project.endsAt, true)}` : ''}
                </Fact>
                <Fact label="Ответственный">{project.ownerName ?? 'Не назначен'}</Fact>
                <Fact label="Участники">{project.members.length}</Fact>
                <Fact label="Артефакты">{artifacts.length}</Fact>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="members">
          <div className="space-y-3">
            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={() => setShowMember(true)} size="sm">
                  <PlusIcon /> Добавить участника
                </Button>
              </div>
            )}
            {!project.members.length ? (
              <Card>
                <EmptyState
                  icon={UsersIcon}
                  title="Команда не сформирована"
                  text="Добавьте участников и укажите их роли свободным текстом."
                />
              </Card>
            ) : (
              project.members.map((member) => (
                <Card className="flex-row items-center gap-3 px-4 py-3" key={member.membershipId}>
                  <div className="min-w-0 flex-1">
                    <Link
                      className="font-medium hover:underline"
                      href={`/participants/${member.id}`}
                    >
                      {member.canonicalFullName}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {member.role} · {member.artifactCount} артефактов проекта
                    </p>
                  </div>
                  {canWrite && (
                    <>
                      <Button
                        onClick={() => {
                          setEditingMember(member);
                          setRoleDraft(member.role);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        <PencilIcon /> Роль
                      </Button>
                      <Button
                        aria-label={`Убрать ${member.canonicalFullName}`}
                        onClick={() => void removeMember(member)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <UserMinusIcon />
                      </Button>
                    </>
                  )}
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="artifacts">
          <div className="space-y-3">
            {canAddArtifact && project.members.length > 0 && (
              <div className="flex justify-end">
                <Button onClick={() => setShowAuthor(true)} size="sm">
                  <FilePlus2Icon /> Добавить артефакт
                </Button>
              </div>
            )}
            {!artifacts.length ? (
              <Card>
                <EmptyState
                  icon={FileCheck2Icon}
                  title="Артефактов пока нет"
                  text={
                    project.members.length
                      ? 'Добавьте первый результат проекта.'
                      : 'Сначала добавьте хотя бы одного участника проекта.'
                  }
                />
              </Card>
            ) : (
              artifacts.map((artifact) => (
                <Card className="flex-row items-center gap-3 px-4 py-3" key={artifact.id}>
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-xs">
                      {artifact.typeName} · {formatDate(artifact.submittedAt, true)}
                    </p>
                    <strong className="block truncate text-[14px] font-medium">
                      {artifact.title}
                    </strong>
                    <p className="text-muted-foreground truncate text-xs">
                      {artifact.authors?.map((author) => author.name).join(', ') ||
                        'Автор не указан'}
                      {artifact.eventName ? ` · ${artifact.eventName}` : ''}
                    </p>
                  </div>
                  <Badge variant={scoreVariant(artifact.score)}>
                    {artifact.score == null ? 'Не оценён' : `${artifact.score}/10`}
                  </Badge>
                  <Button
                    disabled={!artifact.latestVersionId}
                    onClick={() =>
                      artifact.latestVersionId && setReviewVersionId(artifact.latestVersionId)
                    }
                    size="sm"
                    variant="outline"
                  >
                    Открыть
                  </Button>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="events">
          <div className="space-y-3">
            {canWriteEvents && (
              <div className="flex justify-end">
                <Button onClick={() => setShowEvent(true)} size="sm">
                  <PlusIcon /> Добавить в мероприятие
                </Button>
              </div>
            )}
            {!project.events.length ? (
              <Card>
                <EmptyState
                  icon={CalendarDaysIcon}
                  title="Мероприятий пока нет"
                  text="Свяжите проект с мероприятием — вся команда добавится в него автоматически."
                />
              </Card>
            ) : (
              project.events.map((event) => (
                <Card key={event.participationId}>
                  <CardHeader>
                    <div>
                      <CardTitle>
                        <Link className="hover:underline" href={`/events/${event.id}`}>
                          {event.name}
                        </Link>
                      </CardTitle>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {event.startsAt ? formatDate(event.startsAt, true) : 'Дата не указана'}
                      </p>
                    </div>
                    <CardAction>
                      <Badge variant={EVENT_STATUS_VARIANTS[event.status] ?? 'soft-muted'}>
                        {EVENT_STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium">Результат проекта</p>
                      {canWriteEvents && editingEventId !== event.id && (
                        <Button
                          onClick={() => {
                            setEditingEventId(event.id);
                            setResultDraft(event.result ?? '');
                          }}
                          size="xs"
                          variant="ghost"
                        >
                          <PencilIcon /> Изменить
                        </Button>
                      )}
                    </div>
                    {editingEventId === event.id ? (
                      <div className="space-y-2">
                        <Textarea
                          onChange={(change) => setResultDraft(change.target.value)}
                          rows={3}
                          value={resultDraft}
                        />
                        <div className="flex gap-2">
                          <Button onClick={() => void saveEventResult(event.id)} size="sm">
                            Сохранить
                          </Button>
                          <Button
                            onClick={() => setEditingEventId(null)}
                            size="sm"
                            variant="outline"
                          >
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-[13px] whitespace-pre-wrap">
                        {event.result ?? 'Результат пока не заполнен.'}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {showEdit && (
        <ProjectDialog
          project={project}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            await load();
          }}
        />
      )}
      {showMember && (
        <ProjectMemberDialog
          projectId={project.id}
          onClose={() => setShowMember(false)}
          onSaved={async () => {
            setShowMember(false);
            await load();
          }}
        />
      )}
      {showEvent && (
        <ProjectEventDialog
          projectId={project.id}
          existingEventIds={project.events.map((event) => event.id)}
          onClose={() => setShowEvent(false)}
          onSaved={async () => {
            setShowEvent(false);
            await load();
          }}
        />
      )}
      {showAuthor && (
        <ArtifactAuthorDialog
          members={project.members}
          onClose={() => setShowAuthor(false)}
          onSelect={(personId) => void chooseArtifactAuthor(personId)}
        />
      )}
      {artifactPerson && (
        <ArtifactSubmitDialog
          personId={artifactPerson.id}
          events={artifactPerson.events}
          projects={artifactPerson.projects}
          defaultProjectId={project.id}
          onClose={() => setArtifactPerson(null)}
          onCreated={async () => {
            setArtifactPerson(null);
            await load();
          }}
        />
      )}
      {reviewVersionId && (
        <ArtifactReviewDialog
          versionId={reviewVersionId}
          onClose={() => setReviewVersionId(null)}
          onReviewed={load}
        />
      )}
      {editingMember && (
        <RoleDialog
          member={editingMember}
          role={roleDraft}
          onRoleChange={setRoleDraft}
          onClose={() => setEditingMember(null)}
          onSave={() => void saveRole()}
        />
      )}
    </PageStack>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </p>
      <strong className="mt-1 block text-[13px] font-medium">{children}</strong>
    </div>
  );
}

function ArtifactAuthorDialog({
  members,
  onClose,
  onSelect,
}: {
  members: ProjectMemberSummary[];
  onClose: () => void;
  onSelect: (personId: string) => void;
}) {
  const [personId, setPersonId] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogDescription>Автор должен состоять в проекте</DialogDescription>
          <DialogTitle>Кто отправил артефакт?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1.5">
            <Label>Участник *</Label>
            <Select onValueChange={setPersonId} value={personId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите участника" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.canonicalFullName} · {member.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button disabled={!personId} onClick={() => onSelect(personId)}>
            Продолжить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({
  member,
  role,
  onRoleChange,
  onClose,
  onSave,
}: {
  member: ProjectMemberSummary;
  role: string;
  onRoleChange: (role: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogDescription>{member.canonicalFullName}</DialogDescription>
          <DialogTitle>Роль в проекте</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="edit-project-role">Роль *</Label>
            <Input
              autoFocus
              id="edit-project-role"
              maxLength={500}
              onChange={(event) => onRoleChange(event.target.value)}
              value={role}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button disabled={!role.trim()} onClick={onSave}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
