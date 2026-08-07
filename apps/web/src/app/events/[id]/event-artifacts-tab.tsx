'use client';

import {
  AlertTriangleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  UserPlusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataToolbar, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
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
import { api, apiErrorMessage, formatBytes, formatDate } from '@/lib/api';
import {
  ARTIFACT_VERSION_STATUS_LABELS,
  REVIEW_DECISION_LABELS,
  REVIEW_DECISION_VARIANTS,
  scoreVariant,
} from '@/lib/status-labels';
import type { EventArtifact, EventArtifactsResponse } from '@/lib/types';

async function openFile(fileId: string) {
  try {
    const result = await api<{ downloadUrl: string }>(`/files/${fileId}/download-url`);
    const opened = window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
  } catch (caught) {
    toast.error(apiErrorMessage(caught, 'Не удалось открыть файл'));
  }
}

export function EventArtifactsTab({
  data,
  loading,
  canWrite,
  onOpenReview,
  onChanged,
}: {
  data: EventArtifactsResponse | null;
  loading: boolean;
  canWrite: boolean;
  onOpenReview: (versionId: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [reassign, setReassign] = useState<EventArtifact | null>(null);

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((artifact) => {
      if (
        needle &&
        !artifact.title.toLowerCase().includes(needle) &&
        !artifact.authors.some((author) => author.name.toLowerCase().includes(needle))
      )
        return false;
      if (filter === 'UNLINKED' && !artifact.authorOutsideEvent) return false;
      if (filter === 'PENDING' && artifact.decision !== null) return false;
      if (filter === 'ACCEPTED' && artifact.decision !== 'ACCEPTED') return false;
      if (filter === 'REJECTED' && artifact.decision !== 'REJECTED') return false;
      return true;
    });
  }, [filter, items, search]);

  const unlinkedCount = items.filter((artifact) => artifact.authorOutsideEvent).length;

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="h-44 animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={FileCheck2Icon}
          title="Артефактов нет"
          text="К этому мероприятию пока не привязан ни один артефакт."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {unlinkedCount > 0 && (
        <div className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px]">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            У {unlinkedCount} артефактов автор не записан в участники мероприятия. Привяжите
            артефакт к нужному участнику — это чинит расхождение между выгрузкой бота и CRM.
          </span>
        </div>
      )}

      <DataToolbar>
        <ToolbarSearch
          value={search}
          onChange={setSearch}
          placeholder="Поиск по названию или автору…"
        />
        <ToolbarSelect
          label="Показывать"
          value={filter}
          onChange={setFilter}
          width="w-52"
          options={[
            { value: '', label: 'Все артефакты' },
            { value: 'UNLINKED', label: 'Автор вне мероприятия' },
            { value: 'PENDING', label: 'Без решения' },
            { value: 'ACCEPTED', label: 'Принятые' },
            { value: 'REJECTED', label: 'Не принятые' },
          ]}
        />
        <span className="text-muted-foreground ml-auto text-[13px] tabular">
          Показано {filtered.length} из {items.length}
        </span>
      </DataToolbar>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState title="Ничего не подошло" text="Измените условия отбора." />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((artifact) => (
            <Card key={artifact.id}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-left text-[15px] leading-snug font-semibold hover:underline disabled:cursor-default disabled:no-underline"
                      disabled={!artifact.latestVersionId}
                      onClick={() =>
                        artifact.latestVersionId && onOpenReview(artifact.latestVersionId)
                      }
                    >
                      {artifact.title}
                    </button>
                    <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span>{artifact.typeName}</span>
                      <span>·</span>
                      <span>Версия {artifact.latestVersionNumber ?? '—'}</span>
                      <span>·</span>
                      <span>
                        {ARTIFACT_VERSION_STATUS_LABELS[artifact.latestVersionStatus ?? ''] ??
                          artifact.latestVersionStatus ??
                          'Нет версии'}
                      </span>
                      <span>·</span>
                      <span>{formatDate(artifact.submittedAt)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {artifact.decision ? (
                      <Badge variant={REVIEW_DECISION_VARIANTS[artifact.decision] ?? 'soft-muted'}>
                        {REVIEW_DECISION_LABELS[artifact.decision] ?? artifact.decision}
                      </Badge>
                    ) : (
                      <Badge variant="soft-warning">На проверке</Badge>
                    )}
                    {artifact.score !== null && (
                      <Badge variant={scoreVariant(artifact.score)} className="tabular">
                        {artifact.score} / 10
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    Авторы
                  </p>
                  {artifact.authors.length === 0 ? (
                    <p className="text-muted-foreground text-[13px]">Автор не указан</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {artifact.authors.map((author) => (
                        <Badge
                          key={author.id}
                          variant={author.isParticipant ? 'soft-primary' : 'soft-warning'}
                          asChild
                        >
                          <Link href={`/participants/${author.id}`}>
                            {author.name}
                            {!author.isParticipant && ' · не участник'}
                          </Link>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {(artifact.files.length > 0 || artifact.externalUrls.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {artifact.files.map((file) => (
                      <Button
                        key={file.id}
                        variant="outline"
                        size="xs"
                        disabled={file.status !== 'AVAILABLE'}
                        onClick={() => void openFile(file.id)}
                      >
                        <DownloadIcon />
                        <span className="max-w-48 truncate">{file.fileName}</span>
                        <span className="text-muted-foreground tabular">
                          {formatBytes(file.sizeBytes)}
                        </span>
                      </Button>
                    ))}
                    {artifact.externalUrls.map((url) => (
                      <Button key={url} variant="outline" size="xs" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <ExternalLinkIcon />
                          Ссылка
                        </a>
                      </Button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Badge variant="soft-muted">
                    {artifact.source === 'LOCKER' ? 'Из бота' : 'Загружен в CRM'}
                  </Badge>
                  {canWrite && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="ml-auto"
                      onClick={() => setReassign(artifact)}
                    >
                      <UserPlusIcon />
                      Привязать к участнику
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reassign && (
        <ReassignAuthorDialog
          artifact={reassign}
          participants={data?.participants ?? []}
          onOpenChange={(open) => !open && setReassign(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

function ReassignAuthorDialog({
  artifact,
  participants,
  onOpenChange,
  onSaved,
}: {
  artifact: EventArtifact;
  participants: { id: string; canonicalFullName: string }[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!person) return;
    setSaving(true);
    try {
      await api(`/artifacts/${artifact.id}/reassign-author`, {
        method: 'POST',
        body: JSON.stringify({ personId: person.id, keepPreviousAsContributor: true }),
      });
      toast.success(`Артефакт привязан к «${person.canonicalFullName}»`);
      onOpenChange(false);
      await onSaved();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось привязать артефакт'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogDescription>Привязка артефакта</DialogDescription>
          <DialogTitle>{artifact.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-muted-foreground text-[13px]">
            Роль автора перейдёт выбранному участнику мероприятия. Прежние авторы останутся
            соавторами, история пересчитается автоматически.
          </p>
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Текущие авторы
            </p>
            <p className="text-[13px]">
              {artifact.authors.map((author) => author.name).join(', ') || 'Автор не указан'}
            </p>
          </div>
          <PersonPicker
            value={person}
            onChange={setPerson}
            options={participants}
            placeholder="Найти участника мероприятия…"
            disabled={saving}
          />
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
          <Button type="button" disabled={saving || !person} onClick={() => void submit()}>
            {saving ? 'Привязываем…' : 'Привязать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
