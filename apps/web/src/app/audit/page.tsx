'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
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

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  reason?: string | null;
  occurred_at: string;
  actor_name?: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  'person.created': 'Участник создан',
  'person.updated': 'Участник изменён',
  'contact.created': 'Контакт добавлен',
  'artifact.created': 'Артефакт создан',
  'artifact.updated': 'Данные артефакта изменены',
  'artifact.version_created': 'Версия создана',
  'artifact.version_submitted': 'Версия отправлена',
  'artifact.reviewed': 'Оценка сохранена',
  'task.created': 'Задача создана',
  'task.completed': 'Задача завершена',
  'interaction.created': 'Взаимодействие записано',
  'person.merge': 'Карточки объединены',
  'person.unmerge': 'Объединение отменено',
  'import.commit_completed': 'Импорт зафиксирован',
  'audit.read': 'Журнал просмотрен',
};

export default function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: AuditEntry[] }>('/audit?limit=100')
      .then((result) => setItems(result.items))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Журнал недоступен'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageStack>
      <PageHeader
        eyebrow="Контроль"
        title="Журнал действий"
        description="Мутации, изменения статусов и доступ к защищённым данным."
      />
      <Card>
        {error ? (
          <EmptyState title="Журнал недоступен" text={error} />
        ) : loading ? (
          <CardContent className="space-y-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton className="h-9 w-full" key={row} />
            ))}
          </CardContent>
        ) : items.length === 0 ? (
          <EmptyState title="Журнал включён" text="Записи появятся после первых действий в CRM." />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Объект</TableHead>
                  <TableHead>Инициатор</TableHead>
                  <TableHead>Причина</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap tabular">
                      {formatDate(item.occurred_at, true)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {ACTION_LABELS[item.action] ?? item.action}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.entity_type}
                      {item.entity_id ? ` · ${item.entity_id.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell>{item.actor_name ?? 'Система'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.reason ?? '—'}</TableCell>
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
