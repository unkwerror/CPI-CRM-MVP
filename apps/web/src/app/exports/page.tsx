'use client';

import {
  ArchiveIcon,
  FileArchiveIcon,
  FileJsonIcon,
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

          <div className="grid items-start gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Полный архив за период</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-[13px] leading-relaxed">
                  ZIP содержит изображение дашборда, JSON-сводку, отдельные CSV по артефактам, новым
                  участникам, задачам, мероприятиям и результатам СВЯ/БИ, а также все доступные
                  файлы артефактов из общего облачного хранилища.
                </p>
                <Button asChild size="lg">
                  <a href={`/api/exports/period/package.zip?${query}`}>
                    <FileArchiveIcon /> Скачать ZIP с артефактами
                  </a>
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={`/api/exports/period/report.svg?${query}`}>
                      <ImageIcon /> Картинка отчёта
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={`/api/exports/period/summary.json?${query}`}>
                      <FileJsonIcon /> JSON-сводка
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
                  <a href="/api/exports/participants.csv">
                    <UsersIcon /> Все участники CSV
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
                  'СВЯ / БИ в трекинге',
                  `${report.programs.svya.tracked} / ${report.programs.biAcadempark.tracked}`,
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
