'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableRow, TableWrapper } from '@/components/ui/table';
import { api, formatDate } from '@/lib/api';

interface OrganizationSettings {
  id: string;
  name: string;
  artifact_baseline_at: string;
  timezone: string;
  version: number;
  rule_set_id: string;
  rule_version: number;
  active_window_hours: number;
  inactive_after_hours: number;
}

function SettingsCard({
  eyebrow,
  title,
  rows,
}: {
  eyebrow?: string;
  title: string;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          {eyebrow && (
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {eyebrow}
            </p>
          )}
          <CardTitle className={eyebrow ? 'mt-1' : undefined}>{title}</CardTitle>
        </div>
      </CardHeader>
      <TableWrapper>
        <Table>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="text-muted-foreground w-1/2">{row.label}</TableCell>
                <TableCell className="text-right font-medium tabular">{row.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<OrganizationSettings>('/settings/organization')
      .then(setSettings)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Настройки недоступны'),
      );
  }, []);

  return (
    <PageStack>
      <PageHeader
        eyebrow="Система"
        title="Настройки организации"
        description="Пороговые правила версионируются и применяются единообразно."
      />
      {error ? (
        <Card>
          <EmptyState title="Настройки недоступны" text={error} />
        </Card>
      ) : !settings ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1].map((card) => (
            <Card key={card}>
              <CardHeader>
                <Skeleton className="h-4 w-40" />
              </CardHeader>
              <CardContent className="space-y-3">
                {[0, 1, 2].map((row) => (
                  <Skeleton className="h-8 w-full" key={row} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <SettingsCard
            eyebrow={settings.name}
            title="Текущие правила lifecycle"
            rows={[
              { label: 'Активный период', value: `${settings.active_window_hours} часов` },
              { label: 'До неактивности', value: `${settings.inactive_after_hours} часов` },
              { label: 'Версия правил', value: `v${settings.rule_version}` },
            ]}
          />
          <SettingsCard
            title="Локаль и границы"
            rows={[
              { label: 'Часовая зона', value: settings.timezone },
              {
                label: 'Baseline артефактов',
                value: formatDate(settings.artifact_baseline_at, true),
              },
              { label: 'Версия настроек', value: settings.version },
            ]}
          />
        </div>
      )}
    </PageStack>
  );
}
