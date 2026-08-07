'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PersonPicker, type PersonOption } from '@/components/person-picker';
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
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage, formatMoney } from '@/lib/api';
import { DEAL_TYPE_LABELS } from '@/lib/fpf-labels';
import type { DealSummary, DealType, PartnerSummary, ProductSummary } from '@/lib/types';

const NONE = '__none__';

/** Отметка оплаты: выручка, поток и средний чек считаются по факту оплаты. */
export function MarkDealPaidDialog({
  deal,
  onOpenChange,
  onSaved,
}: {
  deal: DealSummary;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState(String(deal.amount));
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/deals/${deal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: deal.version,
          paidAt: new Date(`${paidDate}T12:00:00`).toISOString(),
          paidAmount: Number(paidAmount || 0),
        }),
      });
      toast.success(`Оплата ${formatMoney(Number(paidAmount || 0), deal.currency)} отмечена`);
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось отметить оплату'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogDescription>Выручка по факту оплаты</DialogDescription>
          <DialogTitle>Оплата: {deal.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="paid-date">Дата оплаты *</Label>
              <Input
                id="paid-date"
                onChange={(event) => setPaidDate(event.target.value)}
                required
                type="date"
                value={paidDate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paid-amount">Оплаченная сумма, ₽ *</Label>
              <Input
                id="paid-amount"
                min={0}
                onChange={(event) => setPaidAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={paidAmount}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={saving || paidDate === '' || paidAmount === ''}>
              {saving ? 'Сохраняем…' : 'Отметить оплату'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateDealDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [dealType, setDealType] = useState<DealType>('COMMERCIAL');
  const [amount, setAmount] = useState('');
  const [partnerId, setPartnerId] = useState(NONE);
  const [productId, setProductId] = useState(NONE);
  const [expectedCloseAt, setExpectedCloseAt] = useState('');
  const [comment, setComment] = useState('');
  const [partners, setPartners] = useState<PartnerSummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<{ items: PartnerSummary[] }>('/partners')
      .then((response) => setPartners(response.items))
      .catch(() => setPartners([]));
    void api<{ items: ProductSummary[] }>('/products')
      .then((response) => setProducts(response.items))
      .catch(() => setProducts([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/deals', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          dealType,
          amount: Number(amount || 0),
          ...(partnerId !== NONE ? { partnerId } : {}),
          ...(productId !== NONE ? { productId } : {}),
          ...(person ? { personId: person.id } : {}),
          ...(expectedCloseAt ? { expectedCloseAt: new Date(expectedCloseAt).toISOString() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      toast.success('Сделка создана');
      onOpenChange(false);
      onCreated();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось создать сделку'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Обеспечение выручки</DialogDescription>
          <DialogTitle>Новая сделка</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="deal-title">Название *</Label>
              <Input
                id="deal-title"
                autoFocus
                maxLength={500}
                minLength={2}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например, Грант ФСИ «Студенческий стартап»"
                required
                value={title}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Тип *</Label>
                <Select value={dealType} onValueChange={(next) => setDealType(next as DealType)}>
                  <SelectTrigger aria-label="Тип сделки">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deal-amount">Сумма, ₽ *</Label>
                <Input
                  id="deal-amount"
                  min={0}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={amount}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Партнёр</Label>
                <Select value={partnerId} onValueChange={setPartnerId}>
                  <SelectTrigger aria-label="Партнёр">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Не выбран</SelectItem>
                    {partners.map((partner) => (
                      <SelectItem key={partner.id} value={partner.id}>
                        {partner.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Продукт</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger aria-label="Продукт">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Не выбран</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deal-close">Ожидаемое закрытие</Label>
                <Input
                  id="deal-close"
                  onChange={(event) => setExpectedCloseAt(event.target.value)}
                  type="date"
                  value={expectedCloseAt}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Участник (продажа компетенций / «головы»)</Label>
              <PersonPicker value={person} onChange={setPerson} disabled={saving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deal-comment">Комментарий</Label>
              <Textarea
                id="deal-comment"
                maxLength={10_000}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                value={comment}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={saving || title.trim().length < 2 || amount === ''}>
              {saving ? 'Создаём…' : 'Создать сделку'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
