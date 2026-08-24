'use client';

import {
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LoaderCircleIcon,
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api<ArtifactVersionDetail>(`/artifact-versions/${versionId}`)
      .then((result) => {
        if (!active) return;
        setDetail(result);
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

              {canReview && (
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
          <Button variant="outline" type="button" onClick={onClose}>
            {canReview ? 'Отмена' : 'Закрыть'}
          </Button>
          {canReview && (
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
