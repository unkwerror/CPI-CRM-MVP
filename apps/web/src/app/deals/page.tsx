'use client';

import { HandCoinsIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataToolbar, ToolbarSearch, ToolbarSelect, ToolbarReset } from '@/components/data-toolbar';
import { CreateDealDialog, MarkDealPaidDialog } from '@/components/deal-dialogs';
import { EmptyState } from '@/components/empty-state';
import { KanbanBoard, type KanbanColumn } from '@/components/kanban';
import { PageHeader, PageStack } from '@/components/page-header';
import { ViewSwitch, type RegistryView } from '@/components/view-switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate, formatMoney } from '@/lib/api';
import { DEAL_TYPE_LABELS } from '@/lib/fpf-labels';
import { DEAL_STATUS_LABELS, DEAL_STATUS_ORDER, DEAL_STATUS_VARIANTS } from '@/lib/status-labels';
import type { DealStatus, DealSummary } from '@/lib/types';

const COLUMN_ACCENTS: Record<DealStatus, string> = {
  LEAD: 'text-info',
  NEGOTIATION: 'text-warning',
  WON: 'text-success',
  LOST: 'text-destructive',
};

export default function DealsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <DealsContent />
    </Suspense>
  );
}

function DealsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useCurrentUser();
  const canWrite = can('deals.write');
  const [items, setItems] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<RegistryView>('board');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [payDeal, setPayDeal] = useState<DealSummary | null>(null);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const key of ['status', 'dealType'] as const) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    try {
      const response = await api<{ items: DealSummary[] }>(`/deals?${params}`);
      setItems(response.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить сделки'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/deals${params.size ? `?${params}` : ''}`);
  }

  async function changeStatus(dealId: string, status: string) {
    const deal = items.find((candidate) => candidate.id === dealId);
    if (!deal || deal.status === status) return;
    const previous = items;
    setItems((current) =>
      current.map((item) =>
        item.id === dealId ? { ...item, status: status as DealStatus } : item,
      ),
    );
    try {
      await api(`/deals/${dealId}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: deal.version, status }),
      });
      await loadDeals();
      if (status === 'WON' && !deal.paidAt) {
        toast.info('Сделка выиграна — не забудьте отметить оплату', {
          action: { label: 'Отметить', onClick: () => setPayDeal(deal) },
        });
      }
    } catch (caught) {
      setItems(previous);
      toast.error(apiErrorMessage(caught, 'Не удалось изменить статус'));
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (deal) =>
        deal.title.toLowerCase().includes(needle) ||
        (deal.partnerName ?? '').toLowerCase().includes(needle) ||
        (deal.personName ?? '').toLowerCase().includes(needle),
    );
  }, [items, search]);

  const hasFilters = ['status', 'dealType'].some((key) => searchParams.has(key));
  const paidAmount = filtered.reduce((sum, deal) => sum + (deal.paidAmount ?? 0), 0);
  const openAmount = filtered
    .filter((deal) => deal.status === 'LEAD' || deal.status === 'NEGOTIATION')
    .reduce((sum, deal) => sum + deal.amount, 0);

  const columns: KanbanColumn[] = DEAL_STATUS_ORDER.map((status) => {
    const sum = filtered
      .filter((deal) => deal.status === status)
      .reduce((total, deal) => total + (status === 'WON' ? (deal.paidAmount ?? deal.amount) : deal.amount), 0);
    return {
      id: status,
      title: DEAL_STATUS_LABELS[status],
      hint: formatMoney(sum),
      accentClassName: COLUMN_ACCENTS[status],
    };
  });

  function renderCard(deal: DealSummary) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] leading-snug font-medium">{deal.title}</p>
        <p className="text-sm font-semibold tabular">{formatMoney(deal.amount, deal.currency)}</p>
        <div className="text-muted-foreground space-y-0.5 text-xs">
          {deal.partnerId && deal.partnerName && (
            <Link href={`/partners/${deal.partnerId}`} className="block truncate hover:underline">
              {deal.partnerName}
            </Link>
          )}
          {deal.personId && deal.personName && (
            <Link
              href={`/participants/${deal.personId}`}
              className="block truncate hover:underline"
            >
              {deal.personName}
            </Link>
          )}
          {deal.productName && <p className="truncate">{deal.productName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="soft-muted">{DEAL_TYPE_LABELS[deal.dealType]}</Badge>
          {deal.paidAt ? (
            <Badge variant="soft-success">Оплачено {formatDate(deal.paidAt)}</Badge>
          ) : (
            canWrite &&
            deal.status === 'WON' && (
              <Button variant="outline" size="xs" onClick={() => setPayDeal(deal)}>
                Отметить оплату
              </Button>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <PageStack>
      <PageHeader
        eyebrow="Обеспечение выручки: гранты и коммерция"
        title="Продажи"
        description={`Оплачено ${formatMoney(paidAmount)} · в работе ${formatMoney(openAmount)} — выручка считается по факту оплаты`}
        actions={
          canWrite && (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon />
              Новая сделка
            </Button>
          )
        }
      />

      <DataToolbar>
        <ToolbarSearch
          value={search}
          onChange={setSearch}
          placeholder="Поиск по сделке, партнёру, участнику…"
        />
        <ToolbarSelect
          label="Статус"
          value={searchParams.get('status') ?? ''}
          onChange={(value) => updateParams({ status: value || null })}
          options={[
            { value: '', label: 'Любой статус' },
            ...DEAL_STATUS_ORDER.map((status) => ({
              value: status,
              label: DEAL_STATUS_LABELS[status],
            })),
          ]}
        />
        <ToolbarSelect
          label="Тип"
          value={searchParams.get('dealType') ?? ''}
          onChange={(value) => updateParams({ dealType: value || null })}
          options={[
            { value: '', label: 'Гранты и коммерция' },
            ...Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        {hasFilters && <ToolbarReset onClick={() => router.push('/deals')} />}
        <div className="ml-auto">
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </DataToolbar>

      {error ? (
        <Card>
          <EmptyState title="Ошибка загрузки" text={error} />
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={HandCoinsIcon}
            title="Сделок нет"
            text="Заведите первую сделку: продажу «голов», проекта или продукта."
            action={
              canWrite && (
                <Button onClick={() => setShowCreate(true)}>
                  <PlusIcon />
                  Новая сделка
                </Button>
              )
            }
          />
        </Card>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={columns}
          items={filtered}
          getId={(deal) => deal.id}
          getColumnId={(deal) => deal.status}
          renderCard={renderCard}
          {...(canWrite ? { onMove: changeStatus } : {})}
          emptyColumnText="Нет сделок"
        />
      ) : (
        <Card>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сделка</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Партнёр</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Оплата</TableHead>
                  {canWrite && (
                    <TableHead>
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                          <HandCoinsIcon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate font-medium">{deal.title}</strong>
                          {deal.productName && (
                            <small className="text-muted-foreground block truncate">
                              {deal.productName}
                            </small>
                          )}
                          {deal.personId && deal.personName && (
                            <Link
                              href={`/participants/${deal.personId}`}
                              className="text-primary block truncate text-xs hover:underline"
                            >
                              {deal.personName}
                            </Link>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>{DEAL_TYPE_LABELS[deal.dealType]}</TableCell>
                    <TableCell>
                      {deal.partnerId && deal.partnerName ? (
                        <Link
                          href={`/partners/${deal.partnerId}`}
                          className="text-primary hover:underline"
                        >
                          {deal.partnerName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(deal.amount, deal.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={DEAL_STATUS_VARIANTS[deal.status]}>
                        {DEAL_STATUS_LABELS[deal.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {deal.paidAt ? (
                        <span>
                          <strong className="tabular">
                            {formatMoney(deal.paidAmount ?? 0, deal.currency)}
                          </strong>
                          <small className="text-muted-foreground block">
                            {formatDate(deal.paidAt)}
                          </small>
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {!deal.paidAt && (
                            <Button variant="outline" size="xs" onClick={() => setPayDeal(deal)}>
                              Оплата
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </Card>
      )}

      {showCreate && (
        <CreateDealDialog onOpenChange={setShowCreate} onCreated={() => void loadDeals()} />
      )}
      {payDeal && (
        <MarkDealPaidDialog
          deal={payDeal}
          onOpenChange={(open) => !open && setPayDeal(null)}
          onSaved={() => void loadDeals()}
        />
      )}
    </PageStack>
  );
}
