'use client';

import { MailIcon, PlusIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { CampaignCreateDialog } from '@/components/campaign-create-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { Campaign, CampaignStatus } from '@/lib/types';

const STATUS_LABELS: Record<CampaignStatus, { label: string; variant: string }> = {
  DRAFT: { label: 'Черновик', variant: 'soft-muted' },
  APPROVED: { label: 'Утверждена', variant: 'soft-primary' },
  SENDING: { label: 'Отправляется', variant: 'soft-warning' },
  PAUSED: { label: 'Остановлена', variant: 'soft-warning' },
  SENT: { label: 'Отправлена', variant: 'soft-success' },
  CANCELLED: { label: 'Отменена', variant: 'soft-muted' },
};

export default function CampaignsPage() {
  const { can } = useCurrentUser();
  const canWrite = can('campaigns.write');
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api<{ items: Campaign[] }>('/campaigns');
      setItems(response.items);
      setError(null);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить рассылки'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageStack>
      <PageHeader
        eyebrow="Аудитория"
        title="Рассылки"
        description="Активация базы волнами: черновик, проба на себе, утверждение и отправка. Отписка исключает человека из будущих аудиторий, но оставляет в базе."
        actions={
          canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> Новая рассылка
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Рассылок пока нет"
          text="Начните с небольшой волны по самым активным участникам: так вы проверите текст, не сжигая всю базу."
        />
      ) : (
        <div className="space-y-3">
          {items.map((campaign) => {
            const status = STATUS_LABELS[campaign.status];
            return (
              <Card key={campaign.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {campaign.channel === 'TELEGRAM' ? (
                        <SendIcon aria-hidden className="size-4 text-muted-foreground" />
                      ) : (
                        <MailIcon aria-hidden className="size-4 text-muted-foreground" />
                      )}
                      <Link
                        className="font-medium hover:underline"
                        href={`/campaigns/${campaign.id}`}
                      >
                        {campaign.name}
                      </Link>
                      <Badge variant={status.variant as never}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {campaign.goal ?? 'Цель не указана'} · создана{' '}
                      {formatDate(campaign.createdAt)}
                    </p>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p className="font-medium">Отправлено: {campaign.sentCount}</p>
                    {campaign.failedCount > 0 ? (
                      <p className="text-muted-foreground">Ошибок: {campaign.failedCount}</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CampaignCreateDialog onCreated={load} onOpenChange={setCreating} open={creating} />
    </PageStack>
  );
}
