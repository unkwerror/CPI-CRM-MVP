'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { api, apiErrorMessage } from '@/lib/api';
import {
  EXPENSE_CATEGORY_HINTS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
} from '@/lib/fpf-labels';
import type { DealSummary, EventSummary, ExpenseCategory, ProductSummary } from '@/lib/types';

/** Radix Select не допускает пустое значение пункта, поэтому «не привязан» — отдельный ключ. */
const UNLINKED = 'NONE';

export function ExpenseDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>('VARIABLE');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [eventId, setEventId] = useState(UNLINKED);
  const [productId, setProductId] = useState(UNLINKED);
  const [dealId, setDealId] = useState(UNLINKED);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: EventSummary[] }>('/events')
      .then((response) => setEvents(response.items))
      .catch(() => setEvents([]));
    void api<{ items: ProductSummary[] }>('/products')
      .then((response) => setProducts(response.items))
      .catch(() => setProducts([]));
    void api<{ items: DealSummary[] }>('/deals')
      .then((response) => setDeals(response.items))
      .catch(() => setDeals([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category,
          amount: Number(amount || 0),
          occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
          description: description.trim(),
          ...(eventId !== UNLINKED ? { eventId } : {}),
          ...(productId !== UNLINKED ? { productId } : {}),
          ...(dealId !== UNLINKED ? { dealId } : {}),
        }),
      });
      toast.success('Расход добавлен');
      onCreated();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось создать расход'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogDescription>Учёт затрат</DialogDescription>
          <DialogTitle>Новый расход</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <form id="expense-create-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-category">Категория *</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as ExpenseCategory)}
              >
                <SelectTrigger id="expense-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORY_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {EXPENSE_CATEGORY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{EXPENSE_CATEGORY_HINTS[category]}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-amount">Сумма, ₽ *</Label>
              <Input
                id="expense-amount"
                className="tabular"
                min={0.01}
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={amount}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-date">Дата *</Label>
              <Input
                id="expense-date"
                onChange={(event) => setOccurredAt(event.target.value)}
                required
                type="date"
                value={occurredAt}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-description">Описание *</Label>
              <Input
                id="expense-description"
                maxLength={2000}
                minLength={2}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Например, призовой фонд хакатона"
                required
                value={description}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-event">Мероприятие</Label>
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger id="expense-event" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLINKED}>Не привязан</SelectItem>
                  {events.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-product">Продукт</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="expense-product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLINKED}>Не привязан</SelectItem>
                  {products.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-deal">Сделка</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger id="expense-deal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLINKED}>Не привязан</SelectItem>
                  {deals.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p aria-live="polite" className="text-destructive text-[13px] sm:col-span-2">
                {error}
              </p>
            )}
          </form>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" type="button" disabled={saving} onClick={onClose}>
            Отмена
          </Button>
          <Button
            form="expense-create-form"
            type="submit"
            disabled={saving || description.trim().length < 2 || amount === ''}
          >
            {saving ? 'Создаём…' : 'Добавить расход'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
