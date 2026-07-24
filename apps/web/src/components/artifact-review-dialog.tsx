'use client';

import { Download, ExternalLink, FileText, LoaderCircle, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

import { ApiError, api, formatDate } from '@/lib/api';
import type { ArtifactVersionDetail } from '@/lib/types';

interface ArtifactReviewDialogProps {
  versionId: string;
  onClose: () => void;
  onReviewed: () => void | Promise<void>;
}

/** Рубрикатор качества ЦПИ: пять критериев по 0–2, Q_artifact = сумма. */
const REVIEW_CRITERIA = [
  {
    code: 'relevance',
    label: 'Релевантность',
    blocking: true,
    hint: 'Отвечает задаче мероприятия, проекта, продукта или запроса',
  },
  {
    code: 'completeness',
    label: 'Полнота',
    blocking: false,
    hint: 'Можно понять и использовать без устных пояснений автора',
  },
  {
    code: 'verifiability',
    label: 'Проверяемость',
    blocking: true,
    hint: 'Есть доказательство: ссылка, файл, код, расчёт, демо',
  },
  {
    code: 'applicability',
    label: 'Потенциал применения',
    blocking: false,
    hint: 'Можно использовать дальше: в проекте, продукте, продаже',
  },
  {
    code: 'timeliness',
    label: 'Срок и формат',
    blocking: false,
    hint: 'Сдан в срок и в переиспользуемом формате',
  },
] as const;

type CriterionCode = (typeof REVIEW_CRITERIA)[number]['code'];
type CriteriaState = Record<CriterionCode, 0 | 1 | 2>;

const DEFAULT_CRITERIA: CriteriaState = {
  relevance: 2,
  completeness: 2,
  verifiability: 2,
  applicability: 2,
  timeliness: 2,
};

export function ArtifactReviewDialog({
  versionId,
  onClose,
  onReviewed,
}: ArtifactReviewDialogProps) {
  const [detail, setDetail] = useState<ArtifactVersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [criteria, setCriteria] = useState<CriteriaState>(DEFAULT_CRITERIA);
  const [decision, setDecision] = useState<'NEEDS_REVISION' | 'ACCEPTED' | 'REJECTED'>('ACCEPTED');
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
        if (result.currentReview) {
          setDecision(result.currentReview.decision);
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

  const totalScore = REVIEW_CRITERIA.reduce((sum, item) => sum + criteria[item.code], 0);
  const blockedByZero = REVIEW_CRITERIA.some(
    (item) => item.blocking && criteria[item.code] === 0,
  );
  const isQuality = totalScore >= 7 && !blockedByZero;

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (decision === 'ACCEPTED' && blockedByZero) {
      setError('Нельзя принять артефакт с нулём по релевантности или проверяемости.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/artifact-versions/${versionId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          criteria,
          decision,
          comment: comment.trim() || undefined,
        }),
      });
      await onReviewed();
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить оценку'));
    } finally {
      setSaving(false);
    }
  }

  async function downloadFile(fileId: string) {
    setError(null);
    try {
      const result = await api<{ downloadUrl: string }>(`/files/${fileId}/download-url`);
      const opened = window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      if (opened) opened.opener = null;
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось открыть файл'));
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog artifact-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-review-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Версия артефакта</p>
            <h2 id="artifact-review-title">{detail?.title ?? 'Загрузка…'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {loading ? (
          <div className="artifact-version-loading">
            <LoaderCircle size={20} /> Загружаем версию…
          </div>
        ) : detail ? (
          <>
            <div className="artifact-version-summary">
              <span>{detail.typeName}</span>
              <span>Версия {detail.versionNumber}</span>
              <span>{detail.status}</span>
              <span>{formatDate(detail.submittedAt, true)}</span>
            </div>
            <div className="artifact-version-authors">
              <strong>Авторы:</strong>{' '}
              {detail.contributors
                .filter((item) => item.role === 'AUTHOR')
                .map((item) => item.name)
                .join(', ') || '—'}
            </div>

            {detail.textContent && (
              <section className="artifact-version-content">
                <h3>Текст</h3>
                <pre>{detail.textContent}</pre>
              </section>
            )}

            {detail.externalUrls.length > 0 && (
              <section className="artifact-version-content">
                <h3>Ссылки</h3>
                <div className="artifact-version-assets">
                  {detail.externalUrls.map((url) => (
                    <a
                      className="button button--secondary"
                      href={url}
                      key={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      <ExternalLink size={15} /> Открыть внешний ресурс
                    </a>
                  ))}
                </div>
              </section>
            )}

            {detail.files.length > 0 && (
              <section className="artifact-version-content">
                <h3>Файлы</h3>
                <div className="artifact-version-assets">
                  {detail.files.map((file) => (
                    <button
                      className="button button--secondary"
                      type="button"
                      key={file.id}
                      disabled={file.status !== 'AVAILABLE'}
                      onClick={() => downloadFile(file.id)}
                    >
                      <Download size={15} /> {file.fileName}
                      {file.status !== 'AVAILABLE' ? ` · ${file.status}` : ''}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {!detail.textContent && !detail.externalUrls.length && !detail.files.length && (
              <div className="artifact-version-empty">
                <FileText size={18} /> Содержимое версии не приложено.
              </div>
            )}

            {detail.currentReview && (
              <section className="artifact-current-review">
                <span className="score-chip">{detail.currentReview.score}</span>
                <span>
                  <strong>{reviewDecisionLabel(detail.currentReview.decision)}</strong>
                  <small>
                    {detail.currentReview.reviewerName ?? 'Рецензент'} ·{' '}
                    {formatDate(detail.currentReview.reviewedAt, true)}
                  </small>
                  {detail.currentReview.comment && <p>{detail.currentReview.comment}</p>}
                </span>
              </section>
            )}

            {error && <p className="form-error">{error}</p>}

            {detail.status === 'SUBMITTED' && detail.canReview && (
              <form onSubmit={submitReview}>
                <div className="form-grid artifact-review-form">
                  {REVIEW_CRITERIA.map((item) => (
                    <label className="form-field" key={item.code} title={item.hint}>
                      <span>
                        {item.label}
                        {item.blocking ? ' (0 блокирует приёмку)' : ''} *
                      </span>
                      <select
                        value={criteria[item.code]}
                        onChange={(event) =>
                          setCriteria((prev) => ({
                            ...prev,
                            [item.code]: Number(event.target.value) as 0 | 1 | 2,
                          }))
                        }
                      >
                        <option value={0}>0 — не выполнено</option>
                        <option value={1}>1 — частично</option>
                        <option value={2}>2 — полностью</option>
                      </select>
                    </label>
                  ))}
                  <label className="form-field">
                    <span>Решение *</span>
                    <select
                      value={decision}
                      onChange={(event) => setDecision(event.target.value as typeof decision)}
                    >
                      <option value="ACCEPTED">Принят</option>
                      <option value="NEEDS_REVISION">Нужна доработка</option>
                      <option value="REJECTED">Отклонён</option>
                    </select>
                  </label>
                  <div className="form-field">
                    <span>Q_artifact</span>
                    <p style={{ margin: 0 }}>
                      <strong>{totalScore} / 10</strong>{' '}
                      {isQuality ? (
                        <span style={{ color: 'var(--color-success, #15803d)' }}>
                          качественный
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-danger, #b91c1c)' }}>
                          {blockedByZero
                            ? 'приёмка заблокирована нулём'
                            : 'ниже порога 7/10'}
                        </span>
                      )}
                    </p>
                  </div>
                  <label className="form-field form-field--full">
                    <span>Комментарий</span>
                    <textarea
                      rows={3}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </label>
                </div>
                <footer className="dialog__footer">
                  <button className="button button--secondary" type="button" onClick={onClose}>
                    Отмена
                  </button>
                  <button className="button button--primary" disabled={saving}>
                    {saving
                      ? 'Сохраняем…'
                      : detail.currentReview
                        ? 'Сохранить новую оценку'
                        : 'Сохранить оценку'}
                  </button>
                </footer>
              </form>
            )}
          </>
        ) : (
          <p className="form-error">{error ?? 'Версия недоступна'}</p>
        )}
      </section>
    </div>
  );
}

function apiErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError)
    return caught.detail ? `${caught.message}: ${caught.detail}` : caught.message;
  return caught instanceof Error ? caught.message : fallback;
}

function reviewDecisionLabel(decision: 'NEEDS_REVISION' | 'ACCEPTED' | 'REJECTED'): string {
  if (decision === 'ACCEPTED') return 'Принят';
  if (decision === 'NEEDS_REVISION') return 'Нужна доработка';
  return 'Отклонён';
}
