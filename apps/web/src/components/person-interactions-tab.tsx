'use client';

import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  DownloadIcon,
  FileCheck2Icon,
  FileUpIcon,
  MessageCircleIcon,
  PlusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, apiErrorMessage, formatDate } from '@/lib/api';
import type { PersonTimelineItem } from '@/lib/types';

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE: 'Звонок',
  TELEGRAM: 'Telegram',
  MAX: 'MAX',
  IN_PERSON: 'Встреча',
  NOTE: 'Заметка',
  OTHER: 'Другое',
};

function itemTitle(item: PersonTimelineItem): string {
  if (item.kind === 'INTERACTION') return CHANNEL_LABELS[item.channel] ?? item.channel;
  if (item.kind === 'EVENT') return `Мероприятие: ${item.eventName}`;
  if (item.kind === 'ARTIFACT') return `Отправлен артефакт: ${item.title}`;
  if (item.kind === 'REVIEW') return `Оценён артефакт: ${item.title}`;
  if (item.kind === 'TASK_COMPLETED') return `Завершена задача: ${item.title}`;
  return `Создана задача: ${item.title}`;
}

function itemDetails(item: PersonTimelineItem): string[] {
  if (item.kind === 'INTERACTION') {
    return [
      item.outcome ?? '',
      item.comment ?? '',
      item.responsibleName ? `Ответственный: ${item.responsibleName}` : '',
      item.nextContactAt ? `Следующий контакт: ${formatDate(item.nextContactAt, true)}` : '',
    ].filter(Boolean);
  }
  if (item.kind === 'EVENT') {
    return [item.result ?? '', `Решение: ${item.decision} · посещение: ${item.attendance}`].filter(
      Boolean,
    );
  }
  if (item.kind === 'ARTIFACT') {
    return [item.typeName ?? '', item.eventName ? `Мероприятие: ${item.eventName}` : ''].filter(
      Boolean,
    );
  }
  if (item.kind === 'REVIEW') {
    return [
      item.score == null ? 'Без оценки' : `Оценка: ${item.score}/10`,
      item.decision ? `Решение: ${item.decision}` : '',
    ].filter(Boolean);
  }
  if (item.kind === 'TASK_CREATED' || item.kind === 'TASK_COMPLETED') {
    return [
      item.result ?? '',
      item.assigneeName ? `Исполнитель: ${item.assigneeName}` : '',
      item.dueAt ? `Срок: ${formatDate(item.dueAt, true)}` : '',
    ].filter(Boolean);
  }
  return [];
}

function ItemIcon({ kind }: { kind: PersonTimelineItem['kind'] }) {
  const Icon =
    kind === 'INTERACTION'
      ? MessageCircleIcon
      : kind === 'EVENT'
        ? CalendarDaysIcon
        : kind === 'ARTIFACT'
          ? FileUpIcon
          : kind === 'REVIEW'
            ? FileCheck2Icon
            : kind === 'TASK_COMPLETED'
              ? CheckCircle2Icon
              : ClipboardListIcon;
  return <Icon className="size-4" />;
}

export function PersonInteractionsTab({
  personId,
  canAdd,
  onAdd,
  refreshKey,
}: {
  personId: string;
  canAdd: boolean;
  onAdd: () => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<PersonTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void api<{ items: PersonTimelineItem[] }>(`/people/${personId}/timeline`)
      .then((response) => setItems(response.items))
      .catch((caught) => setError(apiErrorMessage(caught, 'Не удалось загрузить взаимодействия')))
      .finally(() => setLoading(false));
  }, [personId, refreshKey]);

  async function download(fileId: string) {
    try {
      const response = await api<{ downloadUrl: string }>(`/files/${fileId}/download-url`);
      window.open(response.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось скачать файл'));
    }
  }

  return (
    <div className="space-y-4">
      {canAdd && (
        <div className="flex justify-end">
          <Button onClick={onAdd} size="sm">
            <PlusIcon /> Добавить взаимодействие
          </Button>
        </div>
      )}
      <Card>
        {error ? (
          <EmptyState title="Лента недоступна" text={error} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            icon={MessageCircleIcon}
            title="Взаимодействий пока нет"
            text="Здесь появятся контакты, мероприятия, артефакты, оценки и задачи участника."
          />
        ) : (
          <CardContent>
            <ol className="space-y-5 border-l pl-6">
              {items.map((item) => {
                const details = itemDetails(item);
                return (
                  <li className="relative" key={`${item.kind}:${item.id}`}>
                    <span className="bg-primary ring-card absolute top-1 -left-8 flex size-5 items-center justify-center rounded-full text-white ring-4">
                      <ItemIcon kind={item.kind} />
                    </span>
                    <small className="text-muted-foreground block text-xs">
                      {formatDate(item.occurredAt, true)}
                    </small>
                    <strong className="block text-[13px] font-medium">
                      {item.kind === 'EVENT' ? (
                        <Link className="hover:text-primary" href={`/events/${item.eventId}`}>
                          {itemTitle(item)}
                        </Link>
                      ) : (
                        itemTitle(item)
                      )}
                    </strong>
                    {details.map((detail) => (
                      <p
                        className="text-muted-foreground text-[13px] whitespace-pre-wrap"
                        key={detail}
                      >
                        {detail}
                      </p>
                    ))}
                    {item.kind === 'INTERACTION' && item.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.attachments.map((file) => (
                          <Button
                            key={file.id}
                            onClick={() => void download(file.id)}
                            size="xs"
                            variant="outline"
                          >
                            <DownloadIcon /> {file.fileName}
                          </Button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
              {loading && <li className="text-muted-foreground text-[13px]">Загружаем ленту…</li>}
            </ol>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
