'use client';

import { AtSignIcon, MailIcon, PhoneIcon, SendIcon, UserXIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiErrorMessage } from '@/lib/api';
import type { AudienceReachability } from '@/lib/types';

const count = (value: number | null | undefined) =>
  value === null || value === undefined ? 'н/д' : value.toLocaleString('ru-RU');

function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function ChannelRow({
  icon: Icon,
  label,
  hint,
  value,
  total,
  tone,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  value: number;
  total: number;
  tone: 'ok' | 'warn' | 'muted';
  loading: boolean;
}) {
  const percent = share(value, total);
  const barColor =
    tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground/40';
  return (
    <div className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {loading ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums">{count(value)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{percent} %</p>
            </>
          )}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AudiencePage() {
  const [data, setData] = useState<AudienceReachability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<AudienceReachability>('/audience/reachability')
      .then((response) => {
        if (active) setData(response);
      })
      .catch((caught: unknown) => {
        if (active) setError(apiErrorMessage(caught, 'Не удалось посчитать достижимость базы'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const total = data?.total ?? 0;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Аудитория"
        title="Достижимость базы"
        description="Сколько участников мы реально можем позвать в рассылку и каким каналом. Считать это нужно до того, как писать текст: размер базы и размер аудитории — разные числа."
        actions={
          loading ? (
            <Skeleton className="h-6 w-32" />
          ) : (
            <Badge variant="soft-primary">Всего в базе: {count(total)}</Badge>
          )
        }
      />

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Каналы</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <ChannelRow
            icon={SendIcon}
            label="Telegram-бот"
            hint="Нажали /start и сохранён числовой ID — только этим людям бот может написать первым."
            value={data?.channels.telegramBot ?? 0}
            total={total}
            tone="ok"
            loading={loading}
          />
          <ChannelRow
            icon={AtSignIcon}
            label="Только @ник в Telegram"
            hint="Ник из старого импорта. Bot API не умеет превращать ник в ID, написать через бота невозможно."
            value={data?.channels.telegramUsernameOnly ?? 0}
            total={total}
            tone="warn"
            loading={loading}
          />
          <ChannelRow
            icon={MailIcon}
            label="Email"
            hint="Есть хотя бы один адрес. Основной канал для холодной части базы."
            value={data?.channels.email ?? 0}
            total={total}
            tone="ok"
            loading={loading}
          />
          <ChannelRow
            icon={PhoneIcon}
            label="Телефон"
            hint="Годится для звонка или личного сообщения менеджера, не для массовой рассылки."
            value={data?.channels.phone ?? 0}
            total={total}
            tone="muted"
            loading={loading}
          />
          <ChannelRow
            icon={UserXIcon}
            label="Недостижимы"
            hint="Ни бота, ни email. Такие строки нельзя активировать — их либо дособирать, либо чистить."
            value={data?.channels.unreachable ?? 0}
            total={total}
            tone="muted"
            loading={loading}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Можно написать</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <p className="text-3xl font-semibold tabular-nums">
                {count(data?.coverage.botOrEmail)}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Ботом или письмом — это и есть настоящий размер аудитории рассылки.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Кандидаты в пилот</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <p className="text-3xl font-semibold tabular-nums">{count(data?.pilotCandidates)}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Есть бот и артефакт за последние полгода. С них стоит начать первую волну.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Исключены</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <p className="text-3xl font-semibold tabular-nums">
                {count((data?.optedOut.telegram ?? 0) + (data?.optedOut.email ?? 0))}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Отозвали согласие на рассылки. Плюс {count(data?.deletedForever)} удалены из базы
              безвозвратно.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageStack>
  );
}
