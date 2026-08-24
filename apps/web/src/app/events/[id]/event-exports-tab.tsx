'use client';

import { DownloadIcon, FileArchiveIcon, FileSpreadsheetIcon, UploadIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import type { EventAttendanceImportResult } from '@/lib/types';

export function EventExportsTab({
  eventId,
  canExport,
  canImport,
  onImported,
}: {
  eventId: string;
  canExport: boolean;
  canImport: boolean;
  onImported: () => void | Promise<void>;
}) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<EventAttendanceImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function importAttendance(file: File) {
    setImporting(true);
    setResult(null);
    try {
      const response = await fetch(`/api/events/${eventId}/participants/import-xlsx`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: file,
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as {
          title?: string;
          detail?: string;
        } | null;
        throw new ApiError(
          problem?.title ?? 'Не удалось загрузить таблицу',
          response.status,
          problem?.detail,
        );
      }
      const imported = (await response.json()) as EventAttendanceImportResult;
      setResult(imported);
      toast.success(`Обработано строк «Да»: ${imported.attendedRows}`);
      await onImported();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось загрузить таблицу посещений',
      );
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const problemRows = result
    ? result.invalid.length + result.unmatched.length + result.ambiguous.length
    : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Выгрузки</CardTitle>
            <CardDescription>
              ZIP-пакет собирает таблицу участников и файлы артефактов в одном архиве.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {canExport ? (
            <>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <FileArchiveIcon className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">ZIP-пакет мероприятия</p>
                  <p className="text-muted-foreground text-xs">
                    Участники.xlsx со ссылками, папки «Артефакты» и «Проекты» с работами, а также
                    manifest.json со списком недоступных файлов.
                  </p>
                </div>
                <Button size="sm" asChild>
                  <a href={`/api/exports/events/${eventId}/package.zip`}>
                    <DownloadIcon />
                    Скачать
                  </a>
                </Button>
              </div>

              <div className="flex items-start gap-3 rounded-lg border p-3">
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <FileSpreadsheetIcon className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Только таблица участников</p>
                  <p className="text-muted-foreground text-xs">
                    XLSX без файлов — если нужен быстрый список контактов.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/exports/events/${eventId}/participants.xlsx`}>
                    <DownloadIcon />
                    Скачать
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-[13px]">Нужно право «Массовые выгрузки».</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Загрузка посещений</CardTitle>
            <CardDescription>
              Таблица со столбцом посещения: участники сопоставляются по ФИО.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {canImport ? (
            <>
              <input
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importAttendance(file);
                }}
                ref={fileInput}
                type="file"
              />
              <Button
                variant="outline"
                disabled={importing}
                onClick={() => fileInput.current?.click()}
              >
                <UploadIcon />
                {importing ? 'Загружаем…' : 'Выбрать XLSX'}
              </Button>

              {result && (
                <div className="space-y-2 rounded-lg border p-3 text-[13px]">
                  <p>
                    Строк «Да»: <strong className="tabular">{result.attendedRows}</strong> · найдено
                    в CRM: <strong className="tabular">{result.resolved}</strong> · добавлено:{' '}
                    <strong className="tabular">{result.added}</strong> · отмечено посещение:{' '}
                    <strong className="tabular">{result.markedAttended}</strong>
                  </p>
                  {problemRows > 0 && (
                    <details>
                      <summary className="text-muted-foreground cursor-pointer text-xs">
                        Неверное ФИО: {result.invalid.length}; не найдены: {result.unmatched.length}
                        ; неоднозначны: {result.ambiguous.length}
                      </summary>
                      <ul className="text-muted-foreground mt-2 space-y-0.5 text-xs">
                        {result.invalid.slice(0, 20).map((item) => (
                          <li key={`invalid-${item.rowNumber}`}>
                            Строка {item.rowNumber}: {item.rawFullName || 'ФИО не заполнено'} —
                            неверное ФИО
                          </li>
                        ))}
                        {result.unmatched.slice(0, 20).map((item) => (
                          <li key={`unmatched-${item.rowNumber}`}>
                            Строка {item.rowNumber}: {item.fullName} — нет в базе
                          </li>
                        ))}
                        {result.ambiguous.slice(0, 20).map((item) => (
                          <li key={`ambiguous-${item.rowNumber}`}>
                            Строка {item.rowNumber}: {item.fullName} — несколько карточек
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-[13px]">Нужно право «Изменение участников».</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
