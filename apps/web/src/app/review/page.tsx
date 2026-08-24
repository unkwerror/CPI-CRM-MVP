'use client';

import { FileCheck2Icon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ArtifactReviewDialog } from '@/components/artifact-review-dialog';
import { DataToolbar, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { KanbanBoard, type KanbanColumn } from '@/components/kanban';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import { REVIEW_DECISION_LABELS, scoreVariant } from '@/lib/status-labels';
import type { ArtifactSummary } from '@/lib/types';

type ReviewColumnId = 'PENDING' | 'ACCEPTED' | 'REJECTED';

const COLUMNS: KanbanColumn[] = [
  { id: 'PENDING', title: 'На проверке', accentClassName: 'text-warning' },
  { id: 'ACCEPTED', title: REVIEW_DECISION_LABELS.ACCEPTED!, accentClassName: 'text-success' },
  { id: 'REJECTED', title: REVIEW_DECISION_LABELS.REJECTED!, accentClassName: 'text-destructive' },
];

function columnOf(artifact: ArtifactSummary): ReviewColumnId {
  if (artifact.decision === 'ACCEPTED') return 'ACCEPTED';
  if (artifact.decision === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

export default function ReviewPage() {
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [archive, setArchive] = useState<'active' | 'archived'>('active');
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '300' });
    if (scope !== 'all') params.set('review', scope);
    params.set('archive', archive);
    try {
      const response = await api<{ items: ArtifactSummary[] }>(`/artifacts?${params}`);
      setItems(response.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить артефакты'));
    } finally {
      setLoading(false);
    }
  }, [archive, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (artifact) =>
        artifact.title.toLowerCase().includes(needle) ||
        (artifact.authors ?? []).some((author) => author.name.toLowerCase().includes(needle)),
    );
  }, [items, search]);

  const pendingCount = filtered.filter((artifact) => columnOf(artifact) === 'PENDING').length;

  function renderCard(artifact: ArtifactSummary) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left text-[13px] leading-snug font-medium hover:underline disabled:cursor-default disabled:no-underline"
            disabled={!artifact.latestVersionId}
            onClick={() => artifact.latestVersionId && setReviewVersionId(artifact.latestVersionId)}
          >
            {artifact.title}
          </button>
          {artifact.score !== null && artifact.score !== undefined && (
            <Badge variant={scoreVariant(artifact.score)} className="tabular">
              {artifact.score}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {(artifact.authors ?? []).map((author) => author.name).join(', ') || 'Автор не указан'}
        </p>
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="soft-muted">{artifact.typeName}</Badge>
          {artifact.eventId && artifact.eventName && (
            <Link href={`/events/${artifact.eventId}`} className="truncate hover:underline">
              {artifact.eventName}
            </Link>
          )}
          {artifact.submittedAt && (
            <span className="ml-auto tabular">{formatDate(artifact.submittedAt)}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <PageStack>
      <PageHeader
        eyebrow="Качество артефактов"
        title="Приёмка"
        description={
          pendingCount > 0
            ? `${pendingCount} артефактов ждут решения и субъективной оценки 1–10`
            : 'Очередь приёмки пуста'
        }
      />

      <DataToolbar>
        <ToolbarSearch
          value={search}
          onChange={setSearch}
          placeholder="Поиск по названию или автору…"
        />
        <ToolbarSelect
          label="Показывать"
          value={scope}
          onChange={setScope}
          width="w-52"
          options={[
            { value: 'all', label: 'Все артефакты' },
            { value: 'pending', label: 'Только на проверке' },
            { value: 'reviewed', label: 'Только с решением' },
          ]}
        />
        <ToolbarSelect
          label="Раздел"
          value={archive}
          onChange={(value) => setArchive(value as 'active' | 'archived')}
          width="w-48"
          options={[
            { value: 'active', label: 'Текущие' },
            { value: 'archived', label: 'Архив (старше 12 недель)' },
          ]}
        />
      </DataToolbar>

      {error ? (
        <Card>
          <EmptyState title="Ошибка загрузки" text={error} />
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileCheck2Icon}
            title="Артефактов нет"
            text="Как только участники отправят работы, они появятся в колонке «На проверке»."
          />
        </Card>
      ) : (
        <KanbanBoard
          columns={COLUMNS}
          items={filtered}
          getId={(artifact) => artifact.id}
          getColumnId={columnOf}
          renderCard={renderCard}
          onMove={(artifactId) => {
            // Решение нельзя проставить перетаскиванием: нужны оценка и комментарий.
            const artifact = filtered.find((candidate) => candidate.id === artifactId);
            if (artifact?.latestVersionId) setReviewVersionId(artifact.latestVersionId);
          }}
          emptyColumnText="Пусто"
        />
      )}

      {reviewVersionId && (
        <ArtifactReviewDialog
          versionId={reviewVersionId}
          onClose={() => setReviewVersionId(null)}
          onReviewed={load}
        />
      )}
    </PageStack>
  );
}
