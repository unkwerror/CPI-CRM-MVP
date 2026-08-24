'use client';

import {
  AlertCircleIcon,
  BotIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  FileUpIcon,
  MessageCircleIcon,
  StarIcon,
  UsersIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { api, formatDate } from '@/lib/api';
import type { OperationalPeriodReport } from '@/lib/types';

const PERIODS = [1, 2, 4, 8, 12, 26, 52];

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof UsersIcon;
  label: string;
  value: string;
  hint: ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3.5">
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-[13px] font-medium">
        {label}
        <Icon className="size-4" />
      </div>
      <strong className="mt-1 block text-2xl font-semibold tracking-tight tabular">{value}</strong>
      <span className="text-muted-foreground mt-1 block text-xs">{hint}</span>
    </div>
  );
}

const count = (value: number) => value.toLocaleString('ru-RU');

export default function MetricsPage() {
  const [weeks, setWeeks] = useState(4);
  const [report, setReport] = useState<OperationalPeriodReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    void api<OperationalPeriodReport>(`/dashboard/cpi?weeks=${weeks}`)
      .then(setReport)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Метрики недоступны'));
  }, [weeks]);

  if (error) {
    return (
      <PageStack>
        <PageHeader title="Метрики недоступны" />
        <Card>
          <EmptyState title="Ошибка загрузки" text={error} />
        </Card>
      </PageStack>
    );
  }

  return (
    <PageStack>
      <PageHeader
        eyebrow="Операционные показатели CRM"
        title="Метрики участников и артефактов"
        description={
          report
            ? `${formatDate(report.period.from)} — ${formatDate(report.period.to)}`
            : 'Загружаем выбранный период…'
        }
        actions={
          <Select value={String(weeks)} onValueChange={(value) => setWeeks(Number(value))}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Последние {value} нед.
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {!report ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Участники и отправленные артефакты</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                icon={UsersIcon}
                label="Новые участники"
                value={count(report.people.newPeople)}
                hint={`${count(report.people.newFromBot)} пришли из Telegram-бота`}
              />
              <Metric
                icon={BotIcon}
                label="Пришли из бота"
                value={count(report.people.newFromBot)}
                hint={`${count(report.people.totalFromBot)} всего связаны с Telegram-ботом`}
              />
              <Metric
                icon={FileUpIcon}
                label="Отправленные версии"
                value={count(report.artifacts.submittedVersions)}
                hint={`${count(report.artifacts.uniqueAuthors)} уникальных авторов`}
              />
              <Metric
                icon={StarIcon}
                label="Средняя оценка"
                value={report.artifacts.averageScore?.toFixed(1) ?? '—'}
                hint={`медиана ${report.artifacts.medianScore?.toFixed(1) ?? '—'} · ${count(report.artifacts.reviewed)} оценено`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Работа команды</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                icon={CalendarDaysIcon}
                label="Участия в мероприятиях"
                value={count(report.events.participations)}
                hint={`${count(report.events.uniqueParticipants)} уникальных участников`}
              />
              <Metric
                icon={CheckCircle2Icon}
                label="Задач завершено"
                value={count(report.tasks.completed)}
                hint={`${count(report.tasks.created)} создано, ${count(report.tasks.overdueNow)} просрочено`}
              />
              <Metric
                icon={MessageCircleIcon}
                label="Взаимодействия"
                value={count(report.interactions.recorded)}
                hint={`${count(report.interactions.followUpsDue)} следующих контактов просрочено`}
              />
              <Metric
                icon={AlertCircleIcon}
                label="Нужно уточнить ФИО"
                value={count(report.people.profilesNeedReview)}
                hint="Временные карточки из Telegram-бота"
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Артефакты по типам</CardTitle>
              </CardHeader>
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Тип</TableHead>
                      <TableHead className="text-right">Версий</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.artifacts.byType.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell className="text-right tabular">{count(item.count)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Качество 1–10</CardTitle>
              </CardHeader>
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Оценка</TableHead>
                      <TableHead className="text-right">Артефактов</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.artifacts.scoreDistribution.map((item) => (
                      <TableRow key={item.score}>
                        <TableCell className="tabular">{item.score} / 10</TableCell>
                        <TableCell className="text-right tabular">{count(item.count)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Текущее состояние базы</CardTitle>
              </CardHeader>
              <TableWrapper>
                <Table>
                  <TableBody>
                    {[
                      ['Всего участников', report.people.total],
                      ['Отправляли артефакты всего', report.people.artifactSendersEver],
                      ['Отправляли за выбранный период', report.artifacts.uniqueAuthors],
                      ['Связаны с Telegram-ботом', report.people.totalFromBot],
                      ['Нужно уточнить ФИО', report.people.profilesNeedReview],
                      ['Архивировано за период', report.artifacts.archivedDuringPeriod],
                    ].map(([label, value]) => (
                      <TableRow key={String(label)}>
                        <TableCell className="text-muted-foreground">{label}</TableCell>
                        <TableCell className="text-right font-medium tabular">
                          {count(Number(value))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            </Card>
          </div>
        </>
      )}
    </PageStack>
  );
}
