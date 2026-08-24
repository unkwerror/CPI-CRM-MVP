'use client';

import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderKanbanIcon,
  LoaderCircleIcon,
  PencilIcon,
  XCircleIcon,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import {
  ARTIFACT_VERSION_STATUS_LABELS,
  REVIEW_DECISION_LABELS,
  REVIEW_DECISION_VARIANTS,
  scoreVariant,
} from '@/lib/status-labels';
import type { ArtifactVersionDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ArtifactReviewDialogProps {
  versionId: string;
  onClose: () => void;
  onReviewed: () => void | Promise<void>;
}

type Decision = 'ACCEPTED' | 'REJECTED';

const SCORE_HINTS: Record<number, string> = {
  1: 'Содержательного результата почти нет',
  3: 'Сырой и существенно неполный результат',
  5: 'Минимально завершённый результат',
  7: 'Добротный и практически применимый результат',
  9: 'Готов к внешнему использованию',
  10: 'Эталонный результат',
};

const NO_LINK = 'NONE';

interface ArtifactChoice {
  id: string;
  name: string;
}

interface ArtifactTypeChoice {
  code: string;
  name: string;
}

function scoreHint(score: number): string {
  const thresholds = [10, 9, 7, 5, 3, 1];
  const match = thresholds.find((threshold) => score >= threshold) ?? 1;
  return SCORE_HINTS[match] ?? '';
}

export function ArtifactReviewDialog({
  versionId,
  onClose,
  onReviewed,
}: ArtifactReviewDialogProps) {
  const [detail, setDetail] = useState<ArtifactVersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<Decision>('ACCEPTED');
  const [score, setScore] = useState(7);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [eventId, setEventId] = useState(NO_LINK);
  const [projectId, setProjectId] = useState(NO_LINK);
  const [artifactTypes, setArtifactTypes] = useState<ArtifactTypeChoice[]>([]);
  const [events, setEvents] = useState<ArtifactChoice[]>([]);
  const [projects, setProjects] = useState<ArtifactChoice[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api<ArtifactVersionDetail>(`/artifact-versions/${versionId}`)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setTitle(result.title);
        setDescription(result.description ?? '');
        setTypeCode(result.typeCode);
        setEventId(result.eventId ?? NO_LINK);
        setProjectId(result.projectId ?? NO_LINK);
        const review = result.currentReview;
        if (review) {
          setDecision(review.decision === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED');
          setScore(review.score);
          setComment(review.comment ?? '');
        }
      })
      .catch((caught) => {
        if (active) setError(apiErrorMessage(caught, 'Не удалось открыть версию'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [versionId]);

  async function startMetadataEdit() {
    if (!detail) return;
    setEditingMetadata(true);
    setLoadingMetadata(true);
    setError(null);
    try {
      const [typeResult, eventResult, projectResult] = await Promise.all([
        api<{ items: ArtifactTypeChoice[] }>('/artifact-types'),
        api<{ items: ArtifactChoice[] }>('/events?limit=200'),
        api<{ items: ArtifactChoice[] }>('/projects?limit=200'),
      ]);
      setArtifactTypes(typeResult.items);
      setEvents(withCurrentChoice(eventResult.items, detail.eventId, detail.eventName));
      setProjects(withCurrentChoice(projectResult.items, detail.projectId, detail.projectName));
    } catch (caught) {
      setEditingMetadata(false);
      setError(apiErrorMessage(caught, 'Не удалось загрузить мероприятия и проекты'));
    } finally {
      setLoadingMetadata(false);
    }
  }

  function cancelMetadataEdit() {
    if (!detail) return;
    setEditingMetadata(false);
    setTitle(detail.title);
    setDescription(detail.description ?? '');
    setTypeCode(detail.typeCode);
    setEventId(detail.eventId ?? NO_LINK);
    setProjectId(detail.projectId ?? NO_LINK);
    setError(null);
  }

  async function saveMetadata(event: FormEvent) {
    event.preventDefault();
    if (!detail || !title.trim() || !typeCode) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<{
        title: string;
        description?: string | null;
        typeCode: string;
        typeName: string;
        eventId?: string | null;
        eventName?: string | null;
        projectId?: string | null;
        projectName?: string | null;
      }>(`/artifacts/${detail.artifactId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          typeCode,
          description: description.trim() || null,
          eventId: eventId === NO_LINK ? null : eventId,
          projectId: projectId === NO_LINK ? null : projectId,
        }),
      });
      setDetail((current) =>
        current
          ? {
              ...current,
              title: updated.title,
              description: updated.description ?? null,
              typeCode: updated.typeCode,
              typeName: updated.typeName,
              eventId: updated.eventId ?? null,
              eventName: updated.eventName ?? null,
              projectId: updated.projectId ?? null,
              projectName: updated.projectName ?? null,
            }
          : current,
      );
      setEditingMetadata(false);
      toast.success('Данные артефакта обновлены');
      await onReviewed();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось обновить артефакт'));
    } finally {
      setSaving(false);
    }
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/artifact-versions/${versionId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          score,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      toast.success(decision === 'ACCEPTED' ? 'Артефакт принят' : 'Артефакт не принят');
      await onReviewed();
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить оценку'));
    } finally {
      setSaving(false);
    }
  }

  async function downloadFile(fileId: string) {
    try {
      const result = await api<{ downloadUrl: string }>(`/files/${fileId}/download-url`);
      const opened = window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      if (opened) opened.opener = null;
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось открыть файл'));
    }
  }

  const canReview = detail?.status === 'SUBMITTED' && detail.canReview;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Версия артефакта</DialogDescription>
          <DialogTitle>{detail?.title ?? 'Загрузка…'}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {loading ? (
            <p className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" /> Загружаем версию…
            </p>
          ) : !detail ? (
            <p className="text-destructive text-sm">{error ?? 'Версия недоступна'}</p>
          ) : (
            <>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <Badge variant="soft-muted">{detail.typeName}</Badge>
                <span>Версия {detail.versionNumber}</span>
                <span>·</span>
                <span>{ARTIFACT_VERSION_STATUS_LABELS[detail.status] ?? detail.status}</span>
                <span>·</span>
                <span>{formatDate(detail.submittedAt, true)}</span>
              </div>

              <p className="text-[13px]">
                <span className="text-muted-foreground">Авторы: </span>
                {detail.contributors
                  .filter((item) => item.role === 'AUTHOR')
                  .map((item) => item.name)
                  .join(', ') || '—'}
              </p>

              {editingMetadata ? (
                <form
                  id="artifact-metadata-form"
                  onSubmit={saveMetadata}
                  className="space-y-4 rounded-lg border p-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="artifact-edit-title">Название</Label>
                    <Input
                      id="artifact-edit-title"
                      maxLength={500}
                      required
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Тип</Label>
                      <Select
                        disabled={loadingMetadata}
                        value={typeCode}
                        onValueChange={setTypeCode}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите тип" />
                        </SelectTrigger>
                        <SelectContent>
                          {artifactTypes.map((item) => (
                            <SelectItem key={item.code} value={item.code}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Мероприятие</Label>
                      <Select disabled={loadingMetadata} value={eventId} onValueChange={setEventId}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_LINK}>Без мероприятия</SelectItem>
                          {events.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Проект</Label>
                      <Select
                        disabled={loadingMetadata}
                        value={projectId}
                        onValueChange={setProjectId}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_LINK}>Без проекта</SelectItem>
                          {projects.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="artifact-edit-description">Описание</Label>
                    <Textarea
                      id="artifact-edit-description"
                      maxLength={10000}
                      rows={3}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Кратко опишите результат"
                    />
                  </div>
                  {loadingMetadata && (
                    <p className="text-muted-foreground flex items-center gap-2 text-xs">
                      <LoaderCircleIcon className="size-3.5 animate-spin" /> Загружаем справочники…
                    </p>
                  )}
                </form>
              ) : (
                <section className="bg-muted/35 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 text-[13px]">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <CalendarDaysIcon className="size-3.5" />
                    {detail.eventName ?? 'Без мероприятия'}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <FolderKanbanIcon className="size-3.5" />
                    {detail.projectName ?? 'Без проекта'}
                  </span>
                  {detail.description && <p className="basis-full">{detail.description}</p>}
                  {detail.canEdit && (
                    <Button
                      className="ml-auto"
                      onClick={startMetadataEdit}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <PencilIcon /> Изменить данные
                    </Button>
                  )}
                </section>
              )}

              {detail.textContent && (
                <section className="space-y-1.5">
                  <Label>Текст</Label>
                  <pre className="bg-muted scrollbar-thin max-h-56 overflow-auto rounded-lg p-3 text-[13px] whitespace-pre-wrap">
                    {detail.textContent}
                  </pre>
                </section>
              )}

              {detail.externalUrls.length > 0 && (
                <section className="space-y-1.5">
                  <Label>Ссылки</Label>
                  <div className="flex flex-wrap gap-2">
                    {detail.externalUrls.map((url) => (
                      <Button key={url} variant="outline" size="sm" asChild>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          referrerPolicy="no-referrer"
                        >
                          <ExternalLinkIcon /> Открыть внешний ресурс
                        </a>
                      </Button>
                    ))}
                  </div>
                </section>
              )}

              {detail.files.length > 0 && (
                <section className="space-y-1.5">
                  <Label>Файлы</Label>
                  <div className="flex flex-wrap gap-2">
                    {detail.files.map((file) => (
                      <Button
                        key={file.id}
                        variant="outline"
                        size="sm"
                        disabled={file.status !== 'AVAILABLE'}
                        onClick={() => downloadFile(file.id)}
                      >
                        <DownloadIcon /> {file.fileName}
                        {file.status !== 'AVAILABLE' ? ` · ${file.status}` : ''}
                      </Button>
                    ))}
                  </div>
                </section>
              )}

              {!detail.textContent && !detail.externalUrls.length && !detail.files.length && (
                <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                  <FileTextIcon className="size-4" /> Содержимое версии не приложено.
                </p>
              )}

              {detail.currentReview && (
                <section className="bg-muted/50 flex items-start gap-3 rounded-lg border p-3">
                  <Badge
                    variant={scoreVariant(detail.currentReview.score)}
                    className="mt-0.5 min-w-9 justify-center text-sm tabular"
                  >
                    {detail.currentReview.score}
                  </Badge>
                  <div className="min-w-0 space-y-0.5 text-[13px]">
                    <p className="font-medium">
                      {REVIEW_DECISION_LABELS[detail.currentReview.decision] ??
                        detail.currentReview.decision}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {detail.currentReview.reviewerName ?? 'Рецензент'} ·{' '}
                      {formatDate(detail.currentReview.reviewedAt, true)}
                    </p>
                    {detail.currentReview.comment && <p>{detail.currentReview.comment}</p>}
                  </div>
                </section>
              )}

              {error && <p className="text-destructive text-[13px]">{error}</p>}

              {canReview && !editingMetadata && (
                <form id="artifact-review-form" onSubmit={submitReview} className="space-y-5">
                  <fieldset className="space-y-2">
                    <Label asChild>
                      <legend>Решение</legend>
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { value: 'ACCEPTED', Icon: CheckCircle2Icon },
                          { value: 'REJECTED', Icon: XCircleIcon },
                        ] as const
                      ).map(({ value, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={decision === value}
                          onClick={() => setDecision(value)}
                          className={cn(
                            'focus-visible:ring-ring/50 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none',
                            decision === value
                              ? value === 'ACCEPTED'
                                ? 'border-success bg-success/12 text-success'
                                : 'border-destructive bg-destructive/12 text-destructive'
                              : 'hover:bg-accent text-muted-foreground',
                          )}
                        >
                          <Icon className="size-4" />
                          {REVIEW_DECISION_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="artifact-score">Оценка</Label>
                      <span className="text-sm font-semibold tabular">{score} / 10</span>
                    </div>
                    <Slider
                      id="artifact-score"
                      min={1}
                      max={10}
                      step={1}
                      value={[score]}
                      onValueChange={([next]) => setScore(next ?? 1)}
                    />
                    <p className="text-muted-foreground text-xs">{scoreHint(score)}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="artifact-comment">Комментарий</Label>
                    <Textarea
                      id="artifact-comment"
                      rows={3}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Что автору стоит учесть в следующий раз"
                    />
                  </div>
                </form>
              )}

              {detail.status === 'SUBMITTED' && !detail.canReview && (
                <p className="text-muted-foreground text-[13px]">
                  У вас нет прав на приёмку этой версии.
                </p>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {editingMetadata ? (
            <>
              <Button
                variant="outline"
                type="button"
                onClick={cancelMetadataEdit}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button
                form="artifact-metadata-form"
                type="submit"
                disabled={saving || loadingMetadata || !title.trim() || !typeCode}
              >
                {saving ? 'Сохраняем…' : 'Сохранить данные'}
              </Button>
            </>
          ) : (
            <Button variant="outline" type="button" onClick={onClose}>
              {canReview ? 'Отмена' : 'Закрыть'}
            </Button>
          )}
          {canReview && !editingMetadata && (
            <Button form="artifact-review-form" type="submit" disabled={saving}>
              {saving
                ? 'Сохраняем…'
                : detail?.currentReview
                  ? 'Сохранить новую оценку'
                  : 'Сохранить оценку'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function withCurrentChoice(
  choices: ArtifactChoice[],
  currentId?: string | null,
  currentName?: string | null,
): ArtifactChoice[] {
  if (!currentId || !currentName || choices.some((item) => item.id === currentId)) return choices;
  return [{ id: currentId, name: currentName }, ...choices];
}
