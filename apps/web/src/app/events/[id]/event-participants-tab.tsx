'use client';

import { FileCheck2Icon, MessageSquareIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { DataToolbar, ToolbarSearch, ToolbarSelect } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { initials } from '@/lib/api';
import { ATTENDANCE_LABELS, PARTICIPATION_DECISION_LABELS } from '@/lib/status-labels';
import type { EventParticipantSummary } from '@/lib/types';

export function EventParticipantsTab({
  participants,
  onOpenArtifact,
}: {
  participants: EventParticipantSummary[];
  onOpenArtifact: (versionId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [artifactFilter, setArtifactFilter] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return participants.filter((person) => {
      if (needle && !person.canonicalFullName.toLowerCase().includes(needle)) return false;
      if (artifactFilter === 'WITH' && person.artifacts.length === 0) return false;
      if (artifactFilter === 'WITHOUT' && person.artifacts.length > 0) return false;
      return true;
    });
  }, [artifactFilter, participants, search]);

  if (participants.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={UsersIcon}
          title="Участников пока нет"
          text="В источниках не найдено записей участия."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <DataToolbar>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Поиск по ФИО…" />
        <ToolbarSelect
          label="Артефакты"
          value={artifactFilter}
          onChange={setArtifactFilter}
          options={[
            { value: '', label: 'Все участники' },
            { value: 'WITH', label: 'С артефактами' },
            { value: 'WITHOUT', label: 'Без артефактов' },
          ]}
        />
        <span className="text-muted-foreground ml-auto text-[13px] tabular">
          Показано {filtered.length} из {participants.length}
        </span>
      </DataToolbar>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="Никто не подошёл под фильтры" text="Измените условия отбора." />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Участник</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Активность</TableHead>
                  <TableHead>Участие</TableHead>
                  <TableHead>Артефакты</TableHead>
                  <TableHead>Комментарии</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <Link
                        href={`/participants/${person.id}`}
                        className="flex items-center gap-2.5"
                      >
                        <Avatar className="size-8">
                          <AvatarFallback>{initials(person.canonicalFullName)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <strong className="block truncate font-medium hover:underline">
                            {person.canonicalFullName}
                          </strong>
                          <small className="text-muted-foreground block text-xs">
                            {person.participationCount > 1
                              ? `${person.participationCount} записей участия`
                              : '1 запись участия'}
                          </small>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {person.primaryContact ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        activity={person.activityStatus}
                        activation={person.activationState}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="block text-[13px] font-medium">
                        {person.decisions
                          .map((value) => PARTICIPATION_DECISION_LABELS[value] ?? value)
                          .join(', ') || 'Не указано'}
                      </span>
                      <small className="text-muted-foreground block text-xs">
                        {person.attendances
                          .map((value) => ATTENDANCE_LABELS[value] ?? value)
                          .join(', ') || 'Посещение не указано'}
                      </small>
                    </TableCell>
                    <TableCell>
                      {person.artifacts.length === 0 ? (
                        <span className="text-muted-foreground">Нет</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          {person.artifacts.map((artifact) => (
                            <Button
                              key={artifact.id}
                              variant="ghost"
                              size="xs"
                              className="max-w-56"
                              disabled={!artifact.latestVersionId}
                              onClick={() =>
                                artifact.latestVersionId && onOpenArtifact(artifact.latestVersionId)
                              }
                            >
                              <FileCheck2Icon />
                              <span className="truncate">{artifact.title}</span>
                            </Button>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {person.comments.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="text-muted-foreground space-y-1 text-xs">
                          {person.comments.map((comment) => (
                            <p key={comment} className="flex items-start gap-1.5">
                              <MessageSquareIcon className="mt-0.5 size-3 shrink-0" />
                              <span>{comment}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>
    </div>
  );
}
