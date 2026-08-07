'use client';

import { ArrowRightIcon, HandshakeIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  DataToolbar,
  ToolbarReset,
  ToolbarSearch,
  ToolbarSelect,
  ToolbarSpacer,
} from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate, formatMoney } from '@/lib/api';
import { PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS } from '@/lib/fpf-labels';
import type { PartnerKind, PartnerStatus, PartnerSummary } from '@/lib/types';

import { Field, FormGrid, PARTNER_STATUS_VARIANTS } from './partner-ui';

const ANY = 'all';

export default function PartnersPage() {
  return (
    <Suspense
      fallback={
        <PageStack>
          <Skeleton className="h-16 w-full max-w-xl" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-96 w-full" />
        </PageStack>
      }
    >
      <PartnersContent />
    </Suspense>
  );
}

function PartnersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [items, setItems] = useState<PartnerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { can } = useCurrentUser();
  const canWrite = can('partners.write');

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const key of ['q', 'status', 'kind'] as const) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    try {
      const response = await api<{ items: PartnerSummary[] }>(`/partners?${params}`);
      setItems(response.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить партнёров'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/partners${params.size ? `?${params}` : ''}`);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ q: query.trim() || null });
  }

  const hasFilters = ['q', 'status', 'kind'].some((key) => searchParams.has(key));

  return (
    <PageStack>
      <PageHeader
        eyebrow="База партнёров: ЮЛ, ЛПР и соглашения"
        title="Партнёры"
        description="Учитываются активные соглашения с взаимодействиями — развитие отношений отделено от продаж."
        actions={
          canWrite ? (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon /> Новый партнёр
            </Button>
          ) : null
        }
      />

      <DataToolbar>
        <form className="min-w-56 flex-1" onSubmit={submitSearch}>
          <ToolbarSearch
            label="Поиск партнёра"
            onChange={(value) => {
              setQuery(value);
              if (!value && urlQuery) updateParams({ q: null });
            }}
            placeholder="Поиск по названию…"
            value={query}
          />
        </form>
        <ToolbarSelect
          label="Статус"
          onChange={(value) => updateParams({ status: value === ANY ? null : value })}
          options={[
            { value: ANY, label: 'Любой статус' },
            ...Object.entries(PARTNER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          value={searchParams.get('status') ?? ANY}
          width="w-48"
        />
        <ToolbarSelect
          label="Тип"
          onChange={(value) => updateParams({ kind: value === ANY ? null : value })}
          options={[
            { value: ANY, label: 'Любой тип' },
            ...Object.entries(PARTNER_KIND_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          value={searchParams.get('kind') ?? ANY}
          width="w-48"
        />
        {hasFilters && (
          <ToolbarReset
            onClick={() => {
              setQuery('');
              router.push('/partners');
            }}
          />
        )}
        <ToolbarSpacer />
        <span className="text-muted-foreground pb-1.5 text-[13px] tabular">
          Найдено: {items.length}
        </span>
      </DataToolbar>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            icon={HandshakeIcon}
            title="Партнёры не найдены"
            text={
              hasFilters
                ? 'Измените или сбросьте фильтры.'
                : 'Заведите первого партнёра: ЮЛ, его ЛПР и историю взаимодействий.'
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Партнёр</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">ЛПР</TableHead>
                  <TableHead className="text-right">Активные соглашения</TableHead>
                  <TableHead>Последнее взаимодействие</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Открыть</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={8}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((partner) => (
                      <TableRow key={partner.id}>
                        <TableCell>
                          <Link
                            className="group flex items-center gap-2.5"
                            href={`/partners/${partner.id}`}
                          >
                            <span className="bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors">
                              <HandshakeIcon className="size-4" />
                            </span>
                            <span className="font-medium group-hover:underline">
                              {partner.name}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {PARTNER_KIND_LABELS[partner.kind]}
                        </TableCell>
                        <TableCell>
                          <Badge variant={PARTNER_STATUS_VARIANTS[partner.status]}>
                            {PARTNER_STATUS_LABELS[partner.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular">{partner.contactCount}</TableCell>
                        <TableCell className="text-right tabular">
                          {partner.activeAgreements}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {partner.lastInteractionAt
                            ? formatDate(partner.lastInteractionAt, true)
                            : 'Не было'}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatMoney(partner.wonAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="icon-sm" variant="ghost">
                            <Link
                              aria-label={`Открыть «${partner.name}»`}
                              href={`/partners/${partner.id}`}
                            >
                              <ArrowRightIcon />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {showCreate && (
        <CreatePartnerDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/partners/${id}`)}
        />
      )}
    </PageStack>
  );
}

function CreatePartnerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PartnerKind>('COMMERCIAL');
  const [status, setStatus] = useState<PartnerStatus>('PROSPECT');
  const [inn, setInn] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api<{ id: string }>('/partners', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          kind,
          status,
          ...(inn.trim() ? { inn: inn.trim() } : {}),
          ...(website.trim() ? { website: website.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      toast.success('Партнёр создан');
      onCreated(result.id);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось создать партнёра'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogDescription>Новый партнёр</DialogDescription>
          <DialogTitle>Добавить партнёра</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <form className="space-y-4" id="create-partner-form" onSubmit={submit}>
            <FormGrid>
              <Field full htmlFor="partner-name" label="Название организации *">
                <Input
                  autoFocus
                  id="partner-name"
                  maxLength={500}
                  minLength={2}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Например, Фонд содействия инновациям"
                  required
                  value={name}
                />
              </Field>
              <Field htmlFor="partner-kind" label="Тип">
                <Select onValueChange={(value) => setKind(value as PartnerKind)} value={kind}>
                  <SelectTrigger id="partner-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PARTNER_KIND_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field htmlFor="partner-status" label="Статус">
                <Select onValueChange={(value) => setStatus(value as PartnerStatus)} value={status}>
                  <SelectTrigger id="partner-status">
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
              </Field>
              <Field htmlFor="partner-inn" label="ИНН">
                <Input
                  id="partner-inn"
                  maxLength={20}
                  onChange={(event) => setInn(event.target.value)}
                  value={inn}
                />
              </Field>
              <Field htmlFor="partner-website" label="Сайт">
                <Input
                  id="partner-website"
                  maxLength={1000}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://…"
                  value={website}
                />
              </Field>
              <Field full htmlFor="partner-notes" label="Заметки">
                <Textarea
                  id="partner-notes"
                  maxLength={10_000}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  value={notes}
                />
              </Field>
            </FormGrid>
            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
          </form>
        </DialogBody>

        <DialogFooter>
          <Button disabled={saving} onClick={onClose} type="button" variant="outline">
            Отмена
          </Button>
          <Button
            disabled={saving || name.trim().length < 2}
            form="create-partner-form"
            type="submit"
          >
            {saving ? 'Создаём…' : 'Создать партнёра'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
