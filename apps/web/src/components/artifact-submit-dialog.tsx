'use client';

import { PaperclipIcon, TrashIcon } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage, formatBytes, formatDate } from '@/lib/api';
import type { PersonEventSummary } from '@/lib/types';
import { UPLOAD_ACCEPT, uploadFile } from '@/lib/upload';

const ARTIFACT_TYPES = [
  {
    code: 'PITCH_DECK',
    label: 'Презентация / pitch deck',
    description: 'Слайды для защиты проекта или встречи с партнёрами',
  },
  {
    code: 'CODE_REPOSITORY',
    label: 'Код или репозиторий',
    description: 'Ссылка на исходный код и техническую реализацию',
  },
  {
    code: 'APPLICATION',
    label: 'Заявка',
    description: 'Заявка на конкурс, грант, акселератор или программу',
  },
  {
    code: 'INTERVIEW',
    label: 'Интервью',
    description: 'Кастдев, интервью с клиентом или экспертом',
  },
  {
    code: 'FINANCIAL_MODEL',
    label: 'Финансовая модель',
    description: 'Экономика проекта, бюджет или финансовый прогноз',
  },
  {
    code: 'HOMEWORK',
    label: 'Домашнее задание',
    description: 'Результат задания по программе мероприятия',
  },
  {
    code: 'REPORT_RESEARCH',
    label: 'Отчёт / исследование',
    description: 'Аналитический отчёт, исследование или результаты проверки гипотез',
  },
  {
    code: 'PROTOTYPE_MVP',
    label: 'Прототип / MVP',
    description: 'Демонстрация продукта, макет или работающий прототип',
  },
  {
    code: 'OTHER',
    label: 'Другое',
    description: 'Другой подтверждённый результат участника',
  },
] as const;

/** Отсутствие привязки к мероприятию: Radix Select не принимает пустую строку. */
const NO_EVENT = 'NONE';

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Создание артефакта и отправка первой версии одним шагом. Идентификаторы уже
 * созданных сущностей держим в ref, чтобы повторная отправка после ошибки не
 * плодила дубликаты.
 */
export function ArtifactSubmitDialog({
  personId,
  events,
  onClose,
  onCreated,
}: {
  personId: string;
  events: PersonEventSummary[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [eventId, setEventId] = useState(NO_EVENT);
  const [contentType, setContentType] = useState<'TEXT' | 'EXTERNAL_URL' | 'FILE'>('TEXT');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string; sizeBytes: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(toLocalDateTimeValue(new Date()));
  const [useHistoricalDate, setUseHistoricalDate] = useState(false);
  const [backdateReason, setBackdateReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artifactIdRef = useRef<string | null>(null);
  const versionIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedSubmittedAt = useHistoricalDate ? new Date(submittedAt) : null;
  const isBackdated =
    parsedSubmittedAt !== null &&
    Number.isFinite(parsedSubmittedAt.getTime()) &&
    Date.now() - parsedSubmittedAt.getTime() > 5 * 60 * 1000;
  const artifactLocked = Boolean(artifactIdRef.current);
  const versionLocked = Boolean(versionIdRef.current);

  // Файл уходит в хранилище сразу при выборе: до проверки антивирусом версию
  // артефакта всё равно не отправить, а ждать её в момент сохранения дольше и
  // непонятнее для пользователя.
  async function attachFiles(selected: FileList | null) {
    const chosen = Array.from(selected ?? []);
    if (!chosen.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of chosen) {
        const id = await uploadFile(file);
        setFiles((current) => [...current, { id, name: file.name, sizeBytes: file.size }]);
      }
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить файл'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedDate = useHistoricalDate ? new Date(submittedAt) : null;
    if (submittedDate && !Number.isFinite(submittedDate.getTime())) {
      setError('Укажите корректную дату отправки.');
      return;
    }
    if (contentType === 'FILE' && !files.length) {
      setError('Приложите хотя бы один файл.');
      return;
    }
    const backdated = submittedDate ? Date.now() - submittedDate.getTime() > 5 * 60 * 1000 : false;
    if (backdated && backdateReason.trim().length < 3) {
      setError('Для даты задним числом укажите причину не короче трёх символов.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let artifactId = artifactIdRef.current;
      if (!artifactId) {
        const artifact = await api<{ id: string }>('/artifacts', {
          method: 'POST',
          body: JSON.stringify({
            title,
            typeCode: type,
            eventId: eventId === NO_EVENT ? undefined : eventId,
          }),
        });
        artifactId = artifact.id;
        artifactIdRef.current = artifact.id;
      }

      let versionId = versionIdRef.current;
      if (!versionId) {
        const comment = contentType === 'FILE' ? content.trim() : '';
        const version = await api<{ id: string }>(`/artifacts/${artifactId}/versions`, {
          method: 'POST',
          body: JSON.stringify({
            contentType: contentType === 'FILE' && comment ? 'MIXED' : contentType,
            textContent: contentType === 'TEXT' ? content : comment || undefined,
            externalUrls: contentType === 'EXTERNAL_URL' ? [content] : [],
            fileObjectIds: files.map((file) => file.id),
            contributors: [{ personId, role: 'AUTHOR' }],
          }),
        });
        versionId = version.id;
        versionIdRef.current = version.id;
      }

      await api(`/artifact-versions/${versionId}/submit`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          ...(submittedDate ? { submittedAt: submittedDate.toISOString() } : {}),
          backdateReason: backdated ? backdateReason.trim() : undefined,
        }),
      });
      await onCreated();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось отправить артефакт'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Новый результат</DialogDescription>
          <DialogTitle>Добавить артефакт</DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogBody className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="artifact-title">Название *</Label>
              <Input
                autoFocus
                disabled={artifactLocked}
                id="artifact-title"
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Тип артефакта *</Label>
              <Select disabled={artifactLocked} value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Тип артефакта">
                  <SelectValue placeholder="Выберите тип" />
                </SelectTrigger>
                <SelectContent>
                  {ARTIFACT_TYPES.map((artifactType) => (
                    <SelectItem key={artifactType.code} value={artifactType.code}>
                      {artifactType.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Мероприятие (необязательно)</Label>
              {events.length ? (
                <div className="space-y-2">
                  <Select disabled={artifactLocked} onValueChange={setEventId} value={eventId}>
                    <SelectTrigger aria-label="Выбрать мероприятие">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_EVENT}>Без привязки к мероприятию</SelectItem>
                      {events.map((event) => (
                        <SelectItem key={event.id} value={event.id}>
                          {event.name}
                          {event.startsAt ? ` · ${formatDate(event.startsAt)}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  У участника пока нет мероприятий, поэтому артефакт будет создан без привязки.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Формат</Label>
              <Select
                disabled={versionLocked}
                onValueChange={(next) => setContentType(next as typeof contentType)}
                value={contentType}
              >
                <SelectTrigger aria-label="Формат содержимого">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Текст</SelectItem>
                  <SelectItem value="EXTERNAL_URL">Внешняя ссылка</SelectItem>
                  <SelectItem value="FILE">Файл</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center gap-2.5 text-[13px]">
                <Checkbox
                  checked={useHistoricalDate}
                  onCheckedChange={(value) => setUseHistoricalDate(value === true)}
                />
                Указать фактическую дату из прежней системы
              </label>
              {useHistoricalDate && (
                <div className="space-y-1.5">
                  <Label htmlFor="artifact-submitted-at">Фактическая дата отправки</Label>
                  <Input
                    id="artifact-submitted-at"
                    max={toLocalDateTimeValue(new Date(Date.now() + 5 * 60 * 1000))}
                    onChange={(event) => setSubmittedAt(event.target.value)}
                    required
                    type="datetime-local"
                    value={submittedAt}
                  />
                </div>
              )}
            </div>

            {contentType === 'FILE' && (
              <div className="space-y-2">
                <Label htmlFor="artifact-files">Файлы *</Label>
                <input
                  accept={UPLOAD_ACCEPT}
                  className="sr-only"
                  disabled={versionLocked || uploading}
                  id="artifact-files"
                  multiple
                  onChange={(event) => void attachFiles(event.target.files)}
                  ref={fileInputRef}
                  type="file"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={versionLocked || uploading}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                    variant="outline"
                  >
                    <PaperclipIcon /> {uploading ? 'Загружаем…' : 'Выбрать файлы'}
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    До 25 МБ: PDF, документы Office, изображения, текст или ZIP. Каждый файл
                    проверяется антивирусом, это занимает несколько секунд.
                  </span>
                </div>
                {files.length > 0 && (
                  <ul className="space-y-1.5">
                    {files.map((file) => (
                      <li
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]"
                        key={file.id}
                      >
                        <span className="truncate">
                          {file.name}
                          <span className="text-muted-foreground">
                            {' · '}
                            {formatBytes(file.sizeBytes)}
                          </span>
                        </span>
                        <Button
                          aria-label={`Убрать «${file.name}»`}
                          disabled={versionLocked}
                          onClick={() =>
                            setFiles((current) => current.filter((item) => item.id !== file.id))
                          }
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <TrashIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="artifact-content">
                {contentType === 'TEXT'
                  ? 'Содержание *'
                  : contentType === 'EXTERNAL_URL'
                    ? 'Ссылка *'
                    : 'Комментарий к файлам'}
              </Label>
              <Textarea
                disabled={versionLocked}
                id="artifact-content"
                onChange={(event) => setContent(event.target.value)}
                required={contentType !== 'FILE'}
                rows={contentType === 'FILE' ? 3 : 5}
                value={content}
              />
            </div>

            {isBackdated && (
              <div className="space-y-1.5">
                <Label htmlFor="artifact-backdate-reason">Причина даты задним числом *</Label>
                <Textarea
                  id="artifact-backdate-reason"
                  minLength={3}
                  onChange={(event) => setBackdateReason(event.target.value)}
                  placeholder="Например: перенос подтверждённого результата из прежней системы"
                  required
                  rows={2}
                  value={backdateReason}
                />
              </div>
            )}

            {versionLocked && (
              <p className="bg-muted text-muted-foreground rounded-lg border p-3 text-[13px]">
                Черновик версии уже сохранён. Повторная отправка не создаст копию.
              </p>
            )}

            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving || uploading} type="submit">
              {saving
                ? 'Отправляем…'
                : versionLocked
                  ? 'Повторить отправку'
                  : 'Создать и отправить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
