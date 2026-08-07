'use client';

import {
  ExternalLinkIcon,
  FileSignatureIcon,
  HandshakeIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  UserRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate, formatMoney } from '@/lib/api';
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_TYPE_LABELS,
  DEAL_TYPE_LABELS,
  INTERACTION_CHANNEL_LABELS,
  INTERACTION_DIRECTION_LABELS,
  PARTNER_KIND_LABELS,
  PARTNER_STATUS_LABELS,
} from '@/lib/fpf-labels';
import { DEAL_STATUS_LABELS, DEAL_STATUS_VARIANTS } from '@/lib/status-labels';
import type { PartnerDetail, PartnerStatus } from '@/lib/types';

import { AGREEMENT_STATUS_VARIANTS, PARTNER_STATUS_VARIANTS } from '../partner-ui';
import { AgreementDialog, ContactDialog, InteractionDialog } from './partner-dialogs';

type DialogKind = 'contact' | 'agreement' | 'interaction';

export function PartnerPageClient({ id }: { id: string }) {
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const { can } = useCurrentUser();
  const canWrite = can('partners.write');

  const load = useCallback(async () => {
    setError(null);
    try {
      setPartner(await api<PartnerDetail>(`/partners/${id}`));
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить партнёра'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveNotes() {
    if (!partner || notesDraft === null) return;
    setSavingNotes(true);
    try {
      await api(`/partners/${partner.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: partner.version, notes: notesDraft.trim() || null }),
      });
      setNotesDraft(null);
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось сохранить комментарий'));
    } finally {
      setSavingNotes(false);
    }
  }

  async function changeStatus(status: PartnerStatus) {
    if (!partner) return;
    setStatusSaving(true);
    try {
      await api(`/partners/${partner.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: partner.version, status }),
      });
      await load();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось изменить статус'));
    } finally {
      setStatusSaving(false);
    }
  }

  if (loading) {
    return (
      <PageStack>
        <Skeleton className="h-16 w-full max-w-xl" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full" />
      </PageStack>
    );
  }

  if (error || !partner) {
    return (
      <PageStack>
        <Card>
          <EmptyState title="Партнёр недоступен" text={error ?? 'Карточка не найдена'} />
        </Card>
      </PageStack>
    );
  }

  const closeDialog = () => setDialog(null);
  const reloadAfterSave = () => {
    setDialog(null);
    void load();
  };

  return (
    <PageStack>
      <PageHeader
        backHref="/partners"
        backLabel="Все партнёры"
        title={partner.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{PARTNER_KIND_LABELS[partner.kind]}</span>
            {partner.inn && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular">ИНН {partner.inn}</span>
              </>
            )}
            {partner.website && (
              <>
                <span aria-hidden="true">·</span>
                <a
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                  href={partner.website}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {partner.website}
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              </>
            )}
          </span>
        }
        actions={
          canWrite ? (
            <Select
              disabled={statusSaving}
              onValueChange={(value) => void changeStatus(value as PartnerStatus)}
              value={partner.status}
            >
              <SelectTrigger aria-label="Статус партнёра" className="w-52" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PARTNER_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant={PARTNER_STATUS_VARIANTS[partner.status]}>
              {PARTNER_STATUS_LABELS[partner.status]}
            </Badge>
          )
        }
      />

      {(partner.notes || canWrite) && (
        <Card>
          <CardHeader>
            <CardTitle>Комментарий</CardTitle>
            {canWrite && notesDraft === null && (
              <Button onClick={() => setNotesDraft(partner.notes ?? '')} size="xs" variant="ghost">
                <PencilIcon /> Редактировать
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {notesDraft !== null ? (
              <div className="space-y-2.5">
                <Textarea
                  aria-label="Комментарий к партнёру"
                  disabled={savingNotes}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  rows={6}
                  value={notesDraft}
                />
                <div className="flex gap-2">
                  <Button disabled={savingNotes} onClick={() => void saveNotes()} size="sm">
                    {savingNotes ? 'Сохраняем…' : 'Сохранить'}
                  </Button>
                  <Button
                    disabled={savingNotes}
                    onClick={() => setNotesDraft(null)}
                    size="sm"
                    variant="outline"
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : partner.notes ? (
              <p className="text-[13px] wrap-anywhere whitespace-pre-wrap">{partner.notes}</p>
            ) : (
              <p className="text-muted-foreground text-[13px]">Комментария пока нет.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="contacts">
        <TabsList className="w-full max-w-2xl">
          <TabsTrigger value="contacts">
            ЛПР <TabCount value={partner.contacts.length} />
          </TabsTrigger>
          <TabsTrigger value="agreements">
            Соглашения <TabCount value={partner.agreements.length} />
          </TabsTrigger>
          <TabsTrigger value="interactions">
            Взаимодействия <TabCount value={partner.interactions.length} />
          </TabsTrigger>
          <TabsTrigger value="deals">
            Сделки <TabCount value={partner.deals.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>ЛПР и контакты</CardTitle>
              {canWrite && (
                <Button onClick={() => setDialog('contact')} size="sm" variant="outline">
                  <PlusIcon /> Добавить ЛПР
                </Button>
              )}
            </CardHeader>
            {partner.contacts.length === 0 ? (
              <EmptyState
                icon={UserRoundIcon}
                title="ЛПР не каталогизированы"
                text="Добавьте ключевые контакты партнёра."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ФИО</TableHead>
                      <TableHead>Должность</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Telegram</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partner.contacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{contact.fullName}</span>
                            {contact.isDecisionMaker && <Badge variant="soft-primary">ЛПР</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.position || '—'}
                        </TableCell>
                        <TableCell>{contact.email || '—'}</TableCell>
                        <TableCell className="tabular">{contact.phone || '—'}</TableCell>
                        <TableCell>{contact.telegram || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="agreements">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Соглашения</CardTitle>
              {canWrite && (
                <Button onClick={() => setDialog('agreement')} size="sm" variant="outline">
                  <PlusIcon /> Новое соглашение
                </Button>
              )}
            </CardHeader>
            {partner.agreements.length === 0 ? (
              <EmptyState
                icon={FileSignatureIcon}
                title="Соглашений нет"
                text="Зафиксируйте соглашение с партнёром."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Соглашение</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partner.agreements.map((agreement) => (
                      <TableRow key={agreement.id}>
                        <TableCell className="font-medium">{agreement.title}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {AGREEMENT_TYPE_LABELS[agreement.agreementType]}
                        </TableCell>
                        <TableCell>
                          <Badge variant={AGREEMENT_STATUS_VARIANTS[agreement.status]}>
                            {AGREEMENT_STATUS_LABELS[agreement.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {agreement.amount === null || agreement.amount === undefined
                            ? '—'
                            : formatMoney(agreement.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="interactions">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Взаимодействия</CardTitle>
              {canWrite && (
                <Button onClick={() => setDialog('interaction')} size="sm" variant="outline">
                  <PlusIcon /> Записать касание
                </Button>
              )}
            </CardHeader>
            {partner.interactions.length === 0 ? (
              <EmptyState
                icon={MessageSquareIcon}
                title="Взаимодействий нет"
                text="Партнёрство без взаимодействий не считается активным — зафиксируйте первое касание."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Когда</TableHead>
                      <TableHead>Канал</TableHead>
                      <TableHead>Направление</TableHead>
                      <TableHead>С кем</TableHead>
                      <TableHead>Итог</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partner.interactions.map((interaction) => (
                      <TableRow key={interaction.id}>
                        <TableCell className="whitespace-nowrap tabular">
                          {formatDate(interaction.occurredAt, true)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="soft-muted">
                            {INTERACTION_CHANNEL_LABELS[interaction.channel] ?? interaction.channel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {INTERACTION_DIRECTION_LABELS[interaction.direction] ??
                            interaction.direction}
                        </TableCell>
                        <TableCell>{interaction.contactName || '—'}</TableCell>
                        <TableCell className="max-w-md">
                          {interaction.outcome || '—'}
                          {interaction.comment && (
                            <span className="text-muted-foreground block text-xs">
                              {interaction.comment}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="deals">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Сделки</CardTitle>
              <Button asChild size="sm" variant="ghost">
                <Link href="/deals">Все сделки</Link>
              </Button>
            </CardHeader>
            {partner.deals.length === 0 ? (
              <EmptyState
                icon={HandshakeIcon}
                title="Сделок нет"
                text="Сделки партнёра появятся здесь."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Сделка</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Продукт</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partner.deals.map((deal) => (
                      <TableRow key={deal.id}>
                        <TableCell className="font-medium">{deal.title}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {DEAL_TYPE_LABELS[deal.dealType]}
                        </TableCell>
                        <TableCell>
                          <Badge variant={DEAL_STATUS_VARIANTS[deal.status]}>
                            {DEAL_STATUS_LABELS[deal.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {deal.productName || '—'}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatMoney(deal.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {dialog === 'contact' && (
        <ContactDialog partnerId={partner.id} onClose={closeDialog} onSaved={reloadAfterSave} />
      )}
      {dialog === 'agreement' && (
        <AgreementDialog partnerId={partner.id} onClose={closeDialog} onSaved={reloadAfterSave} />
      )}
      {dialog === 'interaction' && (
        <InteractionDialog partner={partner} onClose={closeDialog} onSaved={reloadAfterSave} />
      )}
    </PageStack>
  );
}

function TabCount({ value }: { value: number }) {
  return <span className="text-muted-foreground text-[11px] font-semibold tabular">{value}</span>;
}
