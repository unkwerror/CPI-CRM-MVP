'use client';

import {
  CheckCircle2Icon,
  DatabaseIcon,
  FileSpreadsheetIcon,
  LoaderCircleIcon,
  PlayIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { ImportRunSummary } from '@/lib/types';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const RUN_MODE_LABELS: Record<ImportRunSummary['mode'], string> = {
  DRY_RUN: 'Dry-run',
  COMMIT: 'Импорт',
  REVERT: 'Откат',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: 'В очереди',
  RUNNING: 'Выполняется',
  COMPLETED: 'Завершён',
  FAILED: 'Ошибка',
  REVERTED: 'Откачен',
};

const RUN_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  PENDING: 'soft-muted',
  RUNNING: 'soft-info',
  COMPLETED: 'soft-success',
  FAILED: 'soft-destructive',
  REVERTED: 'soft-warning',
};

const GUARANTEES = [
  'Формулы не исполняются',
  'Повторный запуск идемпотентен',
  'Каждое импортированное значение связано с листом и строкой',
  'Сильные совпадения объединяются, спорные закрываются без merge',
  'Test и технические значения ФИО остаются в аудите, но не создают участников',
];

export default function ImportsPage() {
  const [runs, setRuns] = useState<ImportRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  async function reload() {
    const result = await api<{ items: ImportRunSummary[] }>('/imports');
    setRuns(result.items);
  }

  useEffect(() => {
    void reload()
      .catch((caught) => toast.error(apiErrorMessage(caught, 'История импорта недоступна')))
      .finally(() => setLoading(false));
  }, []);

  async function start(mode: 'dry-run' | 'commit', runId?: string) {
    setWorking(true);
    try {
      if (mode === 'dry-run')
        await api('/imports/local-workbook/dry-run', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: '{}',
        });
      else
        await api(`/imports/${runId}/commit`, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: '{}',
        });
      await reload();
      toast.success(mode === 'dry-run' ? 'Dry-run завершён' : 'Импорт зафиксирован');
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Импорт не запущен'));
    } finally {
      setWorking(false);
    }
  }

  const latestDryRun = runs.find((run) => run.mode === 'DRY_RUN' && run.status === 'COMPLETED');

  return (
    <PageStack>
      <PageHeader
        eyebrow="Воспроизводимый ETL"
        title="Импорт исходной книги"
        description="Координаты и hash исходных строк сохраняются неизменно; чувствительные значения редактируются до staging, а создание людей проходит через безопасное разрешение дублей."
        actions={
          <Button disabled={working} onClick={() => start('dry-run')} type="button">
            <PlayIcon />
            {working ? 'Обрабатываем…' : 'Запустить dry-run'}
          </Button>
        }
      />

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <span className="bg-success/12 text-success flex size-12 shrink-0 items-center justify-center rounded-xl">
              <FileSpreadsheetIcon className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Локальный источник
              </p>
              <strong className="mt-0.5 block truncate text-sm font-semibold">
                Участники_всех_мероприятий_Стартап_студии_ЯДРО1.xlsx
              </strong>
              <p className="text-muted-foreground mt-1 text-xs">
                34 листа · контроль: 11 739 строк · 12 122 наблюдения
              </p>
            </div>
            <Badge variant="soft-success">
              <ShieldCheckIcon />
              SHA-256 при запуске
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Что гарантирует импорт</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground space-y-1.5 text-xs">
              {GUARANTEES.map((item) => (
                <li className="flex items-start gap-2" key={item}>
                  <CheckCircle2Icon className="text-success mt-px size-3.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      {latestDryRun && (
        <Card>
          <CardHeader>
            <div>
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Последняя проверка
              </p>
              <CardTitle className="mt-1">Dry-run завершён</CardTitle>
            </div>
            <CardAction>
              <Button
                disabled={working}
                onClick={() => start('commit', latestDryRun.id)}
                type="button"
              >
                <DatabaseIcon />
                Подтвердить импорт
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { value: `${latestDryRun.sheetsProcessed}/34`, label: 'листов' },
              {
                value: latestDryRun.sourceRecords.toLocaleString('ru-RU'),
                label: 'raw-строк',
              },
              {
                value: latestDryRun.observations.toLocaleString('ru-RU'),
                label: 'наблюдений',
              },
              {
                value: latestDryRun.duplicatesQueued.toLocaleString('ru-RU'),
                label: 'совпадений найдено',
              },
              { value: latestDryRun.rejected.toLocaleString('ru-RU'), label: 'отклонено ФИО' },
              { value: latestDryRun.quarantined.toLocaleString('ru-RU'), label: 'карантин' },
            ].map((stat) => (
              <div className="bg-muted/50 rounded-lg px-3 py-2.5" key={stat.label}>
                <strong className="block text-lg font-semibold tabular">{stat.value}</strong>
                <span className="text-muted-foreground text-xs">{stat.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              История
            </p>
            <CardTitle className="mt-1">Запуски импорта</CardTitle>
          </div>
        </CardHeader>
        {loading ? (
          <CardContent className="space-y-3">
            {[0, 1, 2].map((row) => (
              <Skeleton className="h-9 w-full" key={row} />
            ))}
          </CardContent>
        ) : runs.length === 0 ? (
          <EmptyState
            title="Запусков ещё нет"
            text="Dry-run проверит книгу без изменения канонических данных."
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Статус</TableHead>
                  <TableHead>Режим</TableHead>
                  <TableHead>Файл</TableHead>
                  <TableHead className="text-right">Строк</TableHead>
                  <TableHead>Запущен</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Badge variant={RUN_STATUS_VARIANTS[run.status] ?? 'soft-muted'}>
                        {run.status === 'RUNNING' && (
                          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                        )}
                        {RUN_STATUS_LABELS[run.status] ?? run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{RUN_MODE_LABELS[run.mode]}</TableCell>
                    <TableCell className="text-muted-foreground max-w-80 truncate">
                      {run.fileName}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {run.sourceRecords.toLocaleString('ru-RU')}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(run.createdAt, true)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>
    </PageStack>
  );
}
