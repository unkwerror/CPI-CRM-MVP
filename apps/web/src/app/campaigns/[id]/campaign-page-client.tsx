'use client';

import { CheckIcon, PauseIcon, SendIcon, UsersIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CampaignAttachments } from '@/components/campaign-attachments';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage } from '@/lib/api';
import type { CampaignAudience, CampaignDetail, CampaignSegment } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Утверждена',
  SENDING: 'Отправляется',
  PAUSED: 'Остановлена',
  SENT: 'Отправлена',
  CANCELLED: 'Отменена',
};

export function CampaignPageClient({ id }: { id: string }) {
  const { can } = useCurrentUser();
  const canWrite = can('campaigns.write');
  const canSend = can('campaigns.send');
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [audience, setAudience] = useState<CampaignAudience | null>(null);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [segment, setSegment] = useState<CampaignSegment>({});
  const [waveSize, setWaveSize] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api<CampaignDetail>(`/campaigns/${id}`);
      setCampaign(detail);
      setBody(detail.body);
      setSubject(detail.subject ?? '');
      setSegment(detail.segment);
      setWaveSize(detail.waveSize);
      setError(null);
      setAudience(await api<CampaignAudience>(`/campaigns/${id}/audience`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить рассылку'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act<T>(operation: () => Promise<T>, success: string) {
    setBusy(true);
    try {
      await operation();
      toast.success(success);
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось выполнить операцию'));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <PageStack>
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      </PageStack>
    );
  }

  if (!campaign) {
    return (
      <PageStack>
        <Skeleton className="h-32 w-full" />
      </PageStack>
    );
  }

  const isDraft = campaign.status === 'DRAFT';

  return (
    <PageStack>
      <PageHeader
        backHref="/campaigns"
        backLabel="К рассылкам"
        eyebrow="Рассылка"
        title={campaign.name}
        description={campaign.goal ?? undefined}
        actions={
          <>
            <Badge variant="soft-primary">
              {STATUS_LABELS[campaign.status] ?? campaign.status}
            </Badge>
            {isDraft && canSend ? (
              <Button
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      api(`/campaigns/${id}/approve`, {
                        method: 'POST',
                        body: JSON.stringify({ version: campaign.version }),
                      }),
                    'Рассылка утверждена',
                  )
                }
              >
                <CheckIcon /> Утвердить
              </Button>
            ) : null}
            {!isDraft && canSend && campaign.status !== 'SENT' ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api(`/campaigns/${id}/wave`, { method: 'POST' }),
                      'Волна поставлена в очередь',
                    )
                  }
                >
                  <SendIcon /> Отправить волну
                </Button>
                {campaign.status === 'SENDING' ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => api(`/campaigns/${id}/pause`, { method: 'POST' }),
                        'Отправка остановлена',
                      )
                    }
                    variant="outline"
                  >
                    <PauseIcon /> Пауза
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Сообщение</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {campaign.subject !== null ? (
              <div className="space-y-2">
                <Label htmlFor="campaign-subject">Тема письма</Label>
                <Input
                  disabled={!isDraft || !canWrite}
                  id="campaign-subject"
                  onChange={(event) => setSubject(event.target.value)}
                  value={subject}
                />
              </div>
            ) : null}
            <Textarea
              disabled={!isDraft || !canWrite}
              onChange={(event) => setBody(event.target.value)}
              rows={12}
              value={body}
            />
            <p className="text-sm text-muted-foreground">
              {isDraft
                ? 'Подстановки: {{имя}}, {{фио}}. После утверждения текст замораживается, чтобы половина базы не получила другую версию.'
                : 'Текст утверждён и больше не меняется.'}
            </p>
            {isDraft && canWrite ? (
              <Button
                disabled={busy || (body === campaign.body && subject === (campaign.subject ?? ''))}
                onClick={() =>
                  act(
                    () =>
                      api(`/campaigns/${id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          version: campaign.version,
                          body,
                          ...(campaign.subject === null ? {} : { subject }),
                        }),
                      }),
                    'Текст сохранён',
                  )
                }
                variant="outline"
              >
                Сохранить текст
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Аудитория</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <UsersIcon aria-hidden className="size-4 text-muted-foreground" />
                <span className="text-2xl font-semibold tabular-nums">
                  {audience?.total ?? '—'}
                </span>
                <span className="text-sm text-muted-foreground">получателей</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Отписавшиеся и недостижимые этим каналом уже исключены.
              </p>

              {isDraft && canWrite ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="space-y-2">
                    <Label htmlFor="segment-days">Артефакт за последние N дней</Label>
                    <Input
                      id="segment-days"
                      onChange={(event) => {
                        const { lastArtifactWithinDays: _dropped, ...rest } = segment;
                        setSegment(
                          event.target.value
                            ? { ...rest, lastArtifactWithinDays: Number(event.target.value) }
                            : rest,
                        );
                      }}
                      placeholder="например, 180"
                      type="number"
                      value={segment.lastArtifactWithinDays ?? ''}
                    />
                  </div>
                  {campaign.channel === 'TELEGRAM' ? (
                    <label className="flex items-start gap-2 text-sm" htmlFor="segment-hidden">
                      <input
                        checked={segment.includeHidden === true}
                        className="mt-1"
                        id="segment-hidden"
                        onChange={(event) =>
                          setSegment({ ...segment, includeHidden: event.target.checked })
                        }
                        type="checkbox"
                      />
                      <span>
                        Включить скрытые карточки
                        <span className="block text-muted-foreground">
                          Люди с неполным ФИО спрятаны гигиеной, но бот им писать может. Нужно для
                          просьбы дозаполнить профиль.
                        </span>
                      </span>
                    </label>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="wave-size">Размер волны</Label>
                    <Input
                      id="wave-size"
                      onChange={(event) => setWaveSize(Number(event.target.value))}
                      type="number"
                      value={waveSize}
                    />
                  </div>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api(`/campaigns/${id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({
                              version: campaign.version,
                              segment,
                              waveSize,
                            }),
                          }),
                        'Аудитория обновлена',
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    Пересчитать
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Отклик</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Stat label="В очереди" value={campaign.stats.queued} />
              <Stat label="Отправлено" value={campaign.stats.sent} />
              {campaign.channel === 'EMAIL' ? (
                <>
                  <Stat label="Доставлено" value={campaign.stats.delivered} />
                  <Stat label="Открыли" value={campaign.stats.opened} />
                  <Stat label="Перешли по ссылке" value={campaign.stats.clicked} />
                  <Stat label="Адрес не существует" value={campaign.stats.bounced} />
                </>
              ) : null}
              <Stat label="Ошибок" value={campaign.stats.failed} />
              <Stat label="Интересен конкурс" value={campaign.stats.interested} />
              <Stat label="Просят подробности" value={campaign.stats.moreInfo} />
              <Stat label="Отписались" value={campaign.stats.unsubscribed} />
            </CardContent>
          </Card>
        </div>
      </div>

      <CampaignAttachments
        campaignId={id}
        channel={campaign.channel}
        editable={isDraft && canWrite}
        items={campaign.attachments}
        onChanged={load}
      />

      {audience?.sample.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Как это увидят получатели</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {audience.sample.map((item) => (
              <div className="rounded-md border p-3" key={item.address}>
                <p className="text-xs text-muted-foreground">
                  {item.name} · {item.address}
                </p>
                <p className="mt-2 text-sm whitespace-pre-wrap">{item.preview}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </PageStack>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
