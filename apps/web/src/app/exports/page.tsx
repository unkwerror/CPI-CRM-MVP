'use client';

import {
  ArchiveIcon,
  FileArchiveIcon,
  FileSpreadsheetIcon,
  ImageIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, formatBytes, formatDate } from '@/lib/api';
import type { OperationalPeriodReport } from '@/lib/types';

export default function ExportsPage() {
  const [weeks, setWeeks] = useState(4);
  const [weeksInput, setWeeksInput] = useState('4');
  const [report, setReport] = useState<OperationalPeriodReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void api<OperationalPeriodReport>(`/exports/period/summary.json?weeks=${weeks}`, {
        signal: controller.signal,
      })
        .then(setReport)
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setError(caught instanceof Error ? caught.message : 'Выгрузки недоступны');
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [weeks]);

  const query = `weeks=${weeks}`;
  const maxScoreCount = Math.max(
    1,
    ...(report?.artifacts.scoreDistribution.map((item) => item.count) ?? [0]),
  );

  return (
    <PageStack>
      <PageHeader
        eyebrow="Данные CRM"
        title="Выгрузки"
        description={
          report
            ? `${formatDate(report.period.from)} — ${formatDate(report.period.to)} · ${report.artifacts.submittedVersions.toLocaleString('ru-RU')} отправленных версий`
            : 'Выберите период — сводка и архив сформируются по одним правилам.'
        }
        actions={
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Последние</span>
            <Input
              aria-label="Количество недель"
              className="w-20"
              inputMode="numeric"
              max={52}
              min={1}
              onBlur={() => setWeeksInput(String(weeks))}
              onChange={(event) => {
                const value = event.target.value;
                setWeeksInput(value);
                const parsed = Number(value);
                if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 52) {
                  setWeeks(parsed);
                }
              }}
              type="number"
              value={weeksInput}
            />
            <span className="text-muted-foreground">недель</span>
          </label>
        }
      />

      {error ? (
        <Card>
          <EmptyState title="Не удалось подготовить выгрузку" text={error} />
        </Card>
      ) : !report ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Новые участники', report.people.newPeople, `из бота: ${report.people.newFromBot}`],
              [
                'Артефакты',
                report.artifacts.submittedVersions,
                `авторов: ${report.artifacts.uniqueAuthors}`,
              ],
              [
                'Доступные файлы',
                report.artifacts.availableFiles,
                formatBytes(report.artifacts.bytes),
              ],
              [
                'Оценено',
                report.artifacts.reviewed,
                `средний балл: ${report.artifacts.averageScore?.toFixed(1) ?? '—'}`,
              ],
            ].map(([label, value, hint]) => (
              <Card key={String(label)}>
                <CardContent>
                  <span className="text-muted-foreground text-[13px]">{label}</span>
                  <strong className="mt-1 block text-2xl font-semibold tabular">
                    {Number(value).toLocaleString('ru-RU')}
                  </strong>
                  <small className="text-muted-foreground">{hint}</small>
                </CardContent>
              </Card>
            ))}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Качество артефактов за период</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <div
                  className="flex h-36 items-end gap-2"
                  aria-label="Распределение оценок от 1 до 10"
                >
                  {report.artifacts.scoreDistribution.map((item) => (
                    <div
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                      key={item.score}
                    >
                      <span className="text-muted-foreground text-[11px] tabular">
                        {item.count}
                      </span>
                      <div
                        className="bg-primary w-full max-w-8 rounded-t-md"
                        style={{ height: `${Math.max(4, (item.count / maxScoreCount) * 94)}px` }}
                      />
                      <span className="text-muted-foreground text-xs tabular">{item.score}</span>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  Субъективная оценка качества по шкале 1–10
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                {[
                  ['Средняя', report.artifacts.averageScore?.toFixed(1) ?? '—'],
                  ['Медиана', report.artifacts.medianScore?.toFixed(1) ?? '—'],
                  ['Принято', report.artifacts.accepted],
                  ['Не принято', report.artifacts.rejected],
                  ['Оценено', report.artifacts.reviewed],
                  ['Ждут оценки', report.artifacts.awaitingReview],
                ].map(([label, value]) => (
                  <div className="rounded-lg border p-3" key={String(label)}>
                    <span className="text-muted-foreground block text-xs">{label}</span>
                    <strong className="mt-1 block text-lg tabular">{value}</strong>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Полный архив за период</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-[13px] leading-relaxed">
                  ZIP содержит изображение дашборда, компактный XLSX на 6 листов, полные карточки
                  новых участников и доступные файлы артефактов из общего облачного хранилища.
                </p>
                <Button asChild size="lg">
                  <a href={`/api/exports/period/package.zip?${query}`}>
                    <FileArchiveIcon /> Скачать ZIP с артефактами
                  </a>
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={`/api/exports/period/report.xlsx?${query}`}>
                      <FileSpreadsheetIcon /> XLSX-отчёт
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={`/api/exports/period/report.svg?${query}`}>
                      <ImageIcon /> Картинка отчёта
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Другие выгрузки</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button asChild className="w-full justify-start" variant="outline">
                  <a href={`/api/exports/participants.xlsx?${query}`}>
                    <UsersIcon /> Все участники за период XLSX
                  </a>
                </Button>
                <Button asChild className="w-full justify-start" variant="outline">
                  <Link href="/events">
                    <FileSpreadsheetIcon /> Пакеты мероприятий
                  </Link>
                </Button>
                <Button asChild className="w-full justify-start" variant="outline">
                  <Link href="/imports">
                    <ArchiveIcon /> История импортов
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Что попадёт в пакет</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Отправленные версии', report.artifacts.submittedVersions],
                ['Участия в мероприятиях', report.events.participations],
                [
                  'Созданные / завершённые задачи',
                  `${report.tasks.created} / ${report.tasks.completed}`,
                ],
                [
                  'Взаимодействия / просроченные контакты',
                  `${report.interactions.recorded} / ${report.interactions.followUpsDue}`,
                ],
              ].map(([label, value]) => (
                <div className="rounded-lg border p-3" key={String(label)}>
                  <span className="text-muted-foreground block text-xs">{label}</span>
                  <strong className="mt-1 block text-lg tabular">{value}</strong>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </PageStack>
  );
}
