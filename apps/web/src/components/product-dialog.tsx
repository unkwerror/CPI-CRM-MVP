'use client';

import { type FormEvent, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';
import { PRODUCT_STATUS_LABELS } from '@/lib/fpf-labels';
import type { ProductSummary } from '@/lib/types';

/** Закрытие требует причины, поэтому статус CLOSED недоступен при создании. */
type DraftProductStatus = 'IDEA' | 'PACKAGING' | 'ON_SALE';

const DRAFT_PRODUCT_STATUSES: DraftProductStatus[] = ['IDEA', 'PACKAGING', 'ON_SALE'];

export function ProductDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deliveryModel, setDeliveryModel] = useState('');
  const [documentationUrl, setDocumentationUrl] = useState('');
  const [status, setStatus] = useState<DraftProductStatus>('IDEA');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          status,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(deliveryModel.trim() ? { deliveryModel: deliveryModel.trim() } : {}),
          ...(documentationUrl.trim() ? { documentationUrl: documentationUrl.trim() } : {}),
          ...(price ? { price: Number(price) } : {}),
        }),
      });
      toast.success(`Продукт «${name.trim()}» создан`);
      onCreated();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось создать продукт'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogDescription>База продуктов</DialogDescription>
          <DialogTitle>Новый продукт</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <form id="product-create-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-name">Название *</Label>
              <Input
                id="product-name"
                autoFocus
                maxLength={500}
                minLength={2}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Хакатон под ключ"
                required
                value={name}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="product-status">Статус</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as DraftProductStatus)}
              >
                <SelectTrigger id="product-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DRAFT_PRODUCT_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRODUCT_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="product-price">Цена, ₽</Label>
              <Input
                id="product-price"
                className="tabular"
                min={0}
                onChange={(event) => setPrice(event.target.value)}
                step="0.01"
                type="number"
                value={price}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-delivery">Модель реализации</Label>
              <Input
                id="product-delivery"
                maxLength={2000}
                onChange={(event) => setDeliveryModel(event.target.value)}
                placeholder="Кто и как проводит, что входит в поставку"
                value={deliveryModel}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-docs">Ссылка на документацию</Label>
              <Input
                id="product-docs"
                maxLength={1000}
                onChange={(event) => setDocumentationUrl(event.target.value)}
                placeholder="https://…"
                value={documentationUrl}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-description">Описание</Label>
              <Textarea
                id="product-description"
                maxLength={10_000}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                value={description}
              />
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
            form="product-create-form"
            type="submit"
            disabled={saving || name.trim().length < 2}
          >
            {saving ? 'Создаём…' : 'Создать продукт'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloseProductDialog({
  product,
  onClose,
  onClosed,
}: {
  product: ProductSummary;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: product.version,
          status: 'CLOSED',
          closeReason: reason.trim(),
        }),
      });
      toast.success(`Продукт «${product.name}» закрыт`);
      onClosed();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось закрыть продукт'));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogDescription>Продукт не продаётся</DialogDescription>
          <DialogTitle>Закрыть «{product.name}»</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <form id="product-close-form" onSubmit={submit} className="space-y-1.5">
            <Label htmlFor="product-close-reason">Причина закрытия *</Label>
            <Textarea
              id="product-close-reason"
              autoFocus
              maxLength={2000}
              minLength={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Почему продукт не продался и что решили"
              required
              rows={3}
              value={reason}
            />
            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
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
            form="product-close-form"
            type="submit"
            variant="destructive"
            disabled={saving || reason.trim().length < 3}
          >
            {saving ? 'Закрываем…' : 'Закрыть продукт'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
