'use client';

import { type FormEvent, useState } from 'react';

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
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'PHONE', label: 'Телефон' },
  { value: 'EMAIL', label: 'Email' },
] as const;

type ContactType = (typeof CONTACT_TYPES)[number]['value'];

export function CreatePersonDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [contactType, setContactType] = useState<ContactType>('TELEGRAM');
  const [contact, setContact] = useState('');
  const [organization, setOrganization] = useState('');
  const [faculty, setFaculty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ id: string }>('/people', {
        method: 'POST',
        body: JSON.stringify({
          lastName,
          firstName,
          patronymic,
          lifecycleDataState: 'COMPLETE',
          contacts: contact ? [{ type: contactType, value: contact, isPrimary: true }] : [],
          organization: organization || undefined,
          faculty: faculty || undefined,
        }),
      });
      onCreated(result.id);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить участника'));
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogDescription>Новая карточка</DialogDescription>
          <DialogTitle>Добавить участника</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="contents">
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-person-last-name">Фамилия *</Label>
                <Input
                  autoFocus
                  id="create-person-last-name"
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Иванов"
                  required
                  value={lastName}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-person-first-name">Имя *</Label>
                <Input
                  id="create-person-first-name"
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder="Иван"
                  required
                  value={firstName}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="create-person-patronymic">Отчество *</Label>
                <Input
                  id="create-person-patronymic"
                  onChange={(event) => setPatronymic(event.target.value)}
                  placeholder="Иванович"
                  required
                  value={patronymic}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Тип контакта</Label>
                <Select
                  value={contactType}
                  onValueChange={(next) => setContactType(next as ContactType)}
                >
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
                <Label htmlFor="create-person-contact">
                  {contactType === 'TELEGRAM' ? 'Telegram (главный контакт)' : 'Контакт'}
                </Label>
                <Input
                  id="create-person-contact"
                  onChange={(event) => setContact(event.target.value)}
                  placeholder={contactType === 'TELEGRAM' ? '@username' : '+7 999 123-45-67'}
                  value={contact}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-person-organization">Организация</Label>
                <Input
                  id="create-person-organization"
                  onChange={(event) => setOrganization(event.target.value)}
                  placeholder="НГУ"
                  value={organization}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-person-faculty">Факультет</Label>
                <Input
                  id="create-person-faculty"
                  onChange={(event) => setFaculty(event.target.value)}
                  placeholder="ФИТ"
                  value={faculty}
                />
              </div>
            </div>

            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Отмена
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? 'Сохраняем…' : 'Создать карточку'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
