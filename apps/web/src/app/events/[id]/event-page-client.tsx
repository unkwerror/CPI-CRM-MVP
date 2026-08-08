'use client';

import { CalendarDaysIcon, DownloadIcon, FileCheck2Icon, UsersIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ArtifactReviewDialog } from '@/components/artifact-review-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import { EVENT_STATUS_LABELS, EVENT_STATUS_VARIANTS } from '@/lib/status-labels';
import type {
  EventArtifactsResponse,
  EventDetail,
  EventDuplicateSuggestion,
} from '@/lib/types';

import { EventArtifactsTab } from './event-artifacts-tab';
import { EventDuplicatesTab } from './event-duplicates-tab';
import { EventExportsTab } from './event-exports-tab';
import { EventParticipantsTab } from './event-participants-tab';

export function EventPageClient({ id }: { id: string }) {
  const { can } = useCurrentUser();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [artifacts, setArtifacts] = useState<EventArtifactsResponse | null>(null);
  const [duplicates, setDuplicates] = useState<EventDuplicateSuggestion[]>([]);
  const [loadingSide, setLoadingSide] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null);

  const loadEvent = useCallback(async () => {
    try {
      setEvent(await api<EventDetail>(`/events/${id}`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Мероприятие недоступно'));
    }
  }, [id]);

  const loadSideData = useCallback(async () => {
    setLoadingSide(true);
    const [artifactsResult, duplicatesResult] = await Promise.allSettled([
      api<EventArtifactsResponse>(`/events/${id}/artifacts`),
      api<{ items: EventDuplicateSuggestion[] }>(`/events/${id}/duplicate-suggestions`),
    ]);
    if (artifactsResult.status === 'fulfilled') setArtifacts(artifactsResult.value);
    if (duplicatesResult.status === 'fulfilled') setDuplicates(duplicatesResult.value.items);
    setLoadingSide(false);
  }, [id]);

  useEffect(() => {
    void loadEvent();
    void loadSideData();
  }, [loadEvent, loadSideData]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadEvent(), loadSideData()]);
  }, [loadEvent, loadSideData]);

  if (error) {
    return (
      <Card>
        <EmptyState title="Не удалось открыть мероприятие" text={error} />
      </Card>
    );
  }

  if (!event) {
    return (
      <PageStack>
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </PageStack>
    );
  }

  const artifactCount = artifacts?.items.length ?? 0;
  const unlinkedCount = artifacts?.items.filter((item) => item.authorOutsideEvent).length ?? 0;

  return (
    <PageStack>
      <PageHeader
        backHref="/events"
        backLabel="К списку мероприятий"
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CalendarDaysIcon className="size-3.5" />
            Мероприятие
          </span>
        }
        title={event.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{formatEventPeriod(event.startsAt, event.endsAt)}</span>
            <Badge variant={EVENT_STATUS_VARIANTS[event.status] ?? 'soft-muted'}>
              {EVENT_STATUS_LABELS[event.status] ?? event.status}
            </Badge>
            <span className="inline-flex items-center gap-1 tabular">
              <UsersIcon className="size-3.5" /> {event.participants.length}
            </span>
            <span className="inline-flex items-center gap-1 tabular">
              <FileCheck2Icon className="size-3.5" /> {artifactCount}
            </span>
          </span>
        }
        actions={
          can('exports.bulk') && (
            <Button asChild>
              <a href={`/api/exports/events/${event.id}/package.zip`}>
                <DownloadIcon />
                Скачать ZIP
              </a>
            </Button>
          )
        }
      />

      <Tabs defaultValue="participants">
        <TabsList>
          <TabsTrigger value="participants">Участники</TabsTrigger>
          <TabsTrigger value="artifacts">
            Артефакты
            {artifactCount > 0 && (
              <span className="text-muted-foreground tabular">{artifactCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="duplicates">
            Возможные дубли
            {duplicates.length > 0 && (
              <Badge variant="soft-warning" className="tabular">
                {duplicates.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="exports">Выгрузки</TabsTrigger>
        </TabsList>

        <TabsContent value="participants">
          <EventParticipantsTab
            canWrite={can('people.write')}
            eventId={event.id}
            onChanged={reloadAll}
            onOpenArtifact={setReviewVersionId}
            participants={event.participants}
          />
        </TabsContent>

        <TabsContent value="artifacts">
          <EventArtifactsTab
            data={artifacts}
            loading={loadingSide && artifacts === null}
            canWrite={can('artifacts.write')}
            onOpenReview={setReviewVersionId}
            onChanged={reloadAll}
          />
        </TabsContent>

        <TabsContent value="duplicates">
          <EventDuplicatesTab
            items={duplicates}
            loading={loadingSide && duplicates.length === 0}
            canMerge={can('duplicates.resolve')}
            onChanged={reloadAll}
          />
        </TabsContent>

        <TabsContent value="exports">
          <EventExportsTab
            eventId={event.id}
            canExport={can('exports.bulk')}
            canImport={can('people.write')}
            onImported={reloadAll}
          />
        </TabsContent>
      </Tabs>

      {unlinkedCount > 0 && (
        <p className="sr-only" aria-live="polite">
          {unlinkedCount} артефактов без участника мероприятия
        </p>
      )}

      {reviewVersionId && (
        <ArtifactReviewDialog
          versionId={reviewVersionId}
          onClose={() => setReviewVersionId(null)}
          onReviewed={reloadAll}
        />
      )}
    </PageStack>
  );
}

function formatEventPeriod(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt && !endsAt) return 'Дата не указана';
  if (startsAt && endsAt) return `${formatDate(startsAt, true)} — ${formatDate(endsAt, true)}`;
  return formatDate(startsAt ?? endsAt, true);
}
