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
import { api, apiErrorMessage } from '@/lib/api';

const CONTACT_TYPES = [
  { value: 'PHONE', label: 'Телефон' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'MAX', label: 'MAX' },
  { value: 'OTHER', label: 'Другое' },
] as const;

type ContactType = (typeof CONTACT_TYPES)[number]['value'];

/** Раньше контакт добавлялся двумя подряд `window.prompt` без валидации типа. */
export function PersonContactDialog({
  personId,
  onClose,
  onSaved,
}: {
  personId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [type, setType] = useState<ContactType>('PHONE');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/people/${personId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ type, value: value.trim(), isPrimary: true }),
      });
      toast.success('Контакт добавлен');
      await onSaved();
      onClose();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось добавить контакт'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogDescription>Карточка участника</DialogDescription>
          <DialogTitle>Добавить контакт</DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Тип контакта</Label>
              <Select onValueChange={(next) => setType(next as ContactType)} value={type}>
                <SelectTrigger aria-label="Тип контакта">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="person-contact-value">Значение *</Label>
              <Input
                autoFocus
                id="person-contact-value"
                onChange={(event) => setValue(event.target.value)}
                placeholder={type === 'TELEGRAM' ? '@username' : '+7 999 123-45-67'}
                required
                value={value}
              />
              <p className="text-muted-foreground text-xs">
                Контакт станет основным для своего типа.
              </p>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={saving || !value.trim()} type="submit">
              {saving ? 'Сохраняем…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
