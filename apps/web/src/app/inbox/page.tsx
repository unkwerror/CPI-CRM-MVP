'use client';

import { CheckIcon, InboxIcon, LinkIcon, PaperclipIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { PendingResolveDialog } from '@/components/locker-pending-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { LockerPendingResponse, LockerPendingSubmission } from '@/lib/types';

type QueueStatus = 'PENDING' | 'RESOLVED' | 'REJECTED';

const STATUS_TABS: { value: QueueStatus; label: string }[] = [
  { value: 'PENDING', label: 'На разборе' },
  { value: 'RESOLVED', label: 'Принятые' },
  { value: 'REJECTED', label: 'Отклонённые' },
];

const REASON_HINTS: Record<LockerPendingSubmission['reasonCode'], string> = {
  FIO_REQUIRED:
    'Участник указал в боте неполное имя. Найдите его среди участников или заведите карточку с полным ФИО.',
  PERSON_AMBIGUOUS:
    'Под это имя или Telegram подходит несколько карточек. Выберите ту, к которой относится отправка.',
  IDENTITY_CONFLICT:
    'Идентификаторы Locker уже связаны с другим участником. Проверьте, не смешались ли два человека.',
  DELETED_IDENTITY:
    'Карточку этого человека удалили из базы безвозвратно. Заводить её заново стоит только осознанно — иначе отклоните заявку.',
};

export default function InboxPage() {
  const { can } = useCurrentUser();
  const canResolve = can('duplicates.resolve');
  const [status, setStatus] = useState<QueueStatus>('PENDING');
  const [items, setItems] = useState<LockerPendingSubmission[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<LockerPendingSubmission | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<LockerPendingResponse>(`/locker/pending?status=${status}`);
      setItems(response.items);
      setPendingCount(response.pendingCount);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить заявки из бота'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageStack>
      <PageHeader
        eyebrow="Интеграция с ботом"
        title="Заявки из бота"
        description="Отправки, которые CRM не смогла привязать к участнику автоматически. Материалы уже сохранены в Locker — здесь остаётся указать, чьи они."
        actions={
          pendingCount > 0 ? (
            <Badge variant="soft-warning">На разборе: {pendingCount}</Badge>
          ) : undefined
        }
      />

      <Tabs value={status} onValueChange={(value) => setStatus(value as QueueStatus)}>
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <Card className="border-destructive/40 text-destructive p-4 text-[13px]">{error}</Card>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          {status === 'PENDING' ? (
            <EmptyState
              icon={InboxIcon}
              title="Разбирать нечего"
              text="Все отправки из бота привязаны к участникам автоматически."
            />
          ) : (
            <EmptyState icon={InboxIcon} title="Пусто" />
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[15px] font-semibold">{item.reportedFullName}</strong>
                    <Badge variant="outline">{item.telegram}</Badge>
                    {status === 'PENDING' && (
                      <Badge variant="soft-warning">{item.reasonLabel}</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-[13px]">
                    {item.eventTitle} · {formatDate(item.submittedAt)}
                    {item.fileCount > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1">
                        <PaperclipIcon className="size-3.5" />
                        {item.fileCount}
                      </span>
                    )}
                  </p>
                  {(item.reportedPhone || item.reportedOrganization) && (
                    <p className="text-muted-foreground text-xs">
                      {[item.reportedPhone, item.reportedOrganization].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>

                {status === 'PENDING' && canResolve && (
                  <Button size="sm" onClick={() => setActive(item)}>
                    <LinkIcon />
                    Разобрать
                  </Button>
                )}

                {item.status === 'RESOLVED' && item.resolvedPersonName && (
                  <span className="text-success inline-flex items-center gap-1.5 text-[13px]">
                    <CheckIcon className="size-4" />
                    {item.resolvedPersonName}
                  </span>
                )}
              </div>

              {status === 'PENDING' && (
                <p className="text-muted-foreground bg-muted/50 rounded-md px-3 py-2 text-xs">
                  {REASON_HINTS[item.reasonCode]}
                  {item.reasonDetail && <span className="block mt-1">{item.reasonDetail}</span>}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <PendingResolveDialog
        item={active}
        onOpenChange={(open) => !open && setActive(null)}
        onResolved={() => {
          setActive(null);
          void load();
        }}
      />
    </PageStack>
  );
}
