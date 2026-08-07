'use client';

import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon, WalletIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataToolbar, ToolbarReset, ToolbarSelect, ToolbarSpacer } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { ExpenseDialog } from '@/components/expense-dialog';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate, formatMoney } from '@/lib/api';
import {
  EXPENSE_CATEGORY_HINTS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
} from '@/lib/fpf-labels';
import type { ExpenseSummary } from '@/lib/types';

/** Radix Select не допускает пустое значение пункта, поэтому «все категории» — отдельный ключ. */
const ALL_CATEGORIES = 'ALL';

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(key: string): { from: string; to: string } {
  const [year, month] = key.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year!, month! - 1, 1)).toISOString(),
    to: new Date(Date.UTC(year!, month!, 1)).toISOString(),
  };
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year!, month! - 1 + delta, 1)));
}

export default function ExpensesPage() {
  const defaultMonth = useMemo(() => monthKey(new Date()), []);
  const { can } = useCurrentUser();
  const [month, setMonth] = useState(defaultMonth);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [items, setItems] = useState<ExpenseSummary[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [archiving, setArchiving] = useState<ExpenseSummary | null>(null);
  const [archivePending, setArchivePending] = useState(false);

  const canWrite = can('expenses.write');
  const bounds = useMemo(() => monthBounds(month), [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: bounds.from, to: bounds.to });
    if (category !== ALL_CATEGORIES) params.set('category', category);
    try {
      const response = await api<{
        items: ExpenseSummary[];
        totalsByCategory: Record<string, number>;
      }>(`/expenses?${params}`);
      setItems(response.items);
      setTotals(response.totalsByCategory);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить расходы'));
    } finally {
      setLoading(false);
    }
  }, [bounds, category]);

  useEffect(() => {
    void load();
  }, [load]);

  async function archiveExpense(expense: ExpenseSummary) {
    setArchivePending(true);
    try {
      await api(`/expenses/${expense.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: expense.version, archive: true }),
      });
      setArchiving(null);
      toast.success('Расход удалён');
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось удалить расход'));
    } finally {
      setArchivePending(false);
    }
  }

  const totalAmount = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const filtersTouched = category !== ALL_CATEGORIES || month !== defaultMonth;
  const columnCount = canWrite ? 6 : 5;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Переменные, операционные, привлечение и активация"
        title="Расходы"
        description="Каждый расход привязан хотя бы к одному уровню: период, мероприятие, продукт, сделка или проект. На этих данных считаются поток, OpEx % и стоимости."
        actions={
          canWrite ? (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon /> Новый расход
            </Button>
          ) : undefined
        }
      />

      <DataToolbar>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
            Период
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              aria-label="Предыдущий месяц"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeftIcon />
            </Button>
            <Input
              aria-label="Период"
              className="h-8 w-40 tabular"
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              type="month"
              value={month}
            />
            <Button
              aria-label="Следующий месяц"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>

        <ToolbarSelect
          label="Категория"
          value={category}
          onChange={setCategory}
          options={[
            { value: ALL_CATEGORIES, label: 'Все категории' },
            ...EXPENSE_CATEGORY_ORDER.map((value) => ({
              value,
              label: EXPENSE_CATEGORY_LABELS[value],
            })),
          ]}
        />

        {filtersTouched && (
          <ToolbarReset
            onClick={() => {
              setCategory(ALL_CATEGORIES);
              setMonth(defaultMonth);
            }}
          />
        )}

        <ToolbarSpacer />
        <span className="text-muted-foreground pb-1.5 text-[13px]">
          Итого за период:{' '}
          <span className="text-foreground font-semibold tabular">{formatMoney(totalAmount)}</span>
        </span>
      </DataToolbar>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {EXPENSE_CATEGORY_ORDER.map((value) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <Card className="gap-1 px-4 py-3">
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {EXPENSE_CATEGORY_LABELS[value]}
                </span>
                {loading ? (
                  <Skeleton className="h-6 w-24" />
                ) : (
                  <strong className="text-lg leading-tight font-semibold tabular">
                    {formatMoney(totals[value] ?? 0)}
                  </strong>
                )}
              </Card>
            </TooltipTrigger>
            <TooltipContent>{EXPENSE_CATEGORY_HINTS[value]}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            icon={WalletIcon}
            title="Расходов за период нет"
            text="Добавьте расходы, чтобы панель метрик считала поток, OpEx % и стоимости."
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Категория</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead>Привязка</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  {canWrite && (
                    <TableHead>
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 5 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={columnCount}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap tabular">
                          {expense.occurredAt ? formatDate(expense.occurredAt) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="soft-muted">
                            {EXPENSE_CATEGORY_LABELS[expense.category]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                              <WalletIcon className="size-4" />
                            </span>
                            <span className="font-medium">{expense.description}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {[
                            expense.eventName,
                            expense.productName,
                            expense.dealTitle,
                            expense.projectName,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'период'}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular">
                          {formatMoney(expense.amount, expense.currency)}
                        </TableCell>
                        {canWrite && (
                          <TableCell className="text-right">
                            <Button
                              aria-label={`Удалить «${expense.description}»`}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setArchiving(expense)}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {showCreate && (
        <ExpenseDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      {archiving && (
        <Dialog open onOpenChange={(open) => !open && !archivePending && setArchiving(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Удалить расход?</DialogTitle>
            </DialogHeader>
            <DialogBody className="text-[13px]">
              «{archiving.description}» на сумму {formatMoney(archiving.amount, archiving.currency)}{' '}
              перестанет учитываться в метриках периода.
            </DialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                disabled={archivePending}
                onClick={() => setArchiving(null)}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                type="button"
                disabled={archivePending}
                onClick={() => void archiveExpense(archiving)}
              >
                {archivePending ? 'Удаляем…' : 'Удалить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageStack>
  );
}
