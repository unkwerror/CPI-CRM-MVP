'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ApiError, api } from '@/lib/api';
import type { ContactPoint, PersonDetail } from '@/lib/types';

const CONTACT_TYPES = [
  { value: 'PHONE', label: 'Телефон' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'MAX', label: 'MAX' },
  { value: 'OTHER', label: 'Другое' },
] as const;

type ContactType = (typeof CONTACT_TYPES)[number]['value'];

interface EditableContact {
  key: string;
  id?: string;
  type: ContactType;
  value: string;
  telegramUserId?: string;
  isIdentity?: boolean;
  isPrimary: boolean;
}

function toEditableContacts(contacts: ContactPoint[]): EditableContact[] {
  if (!contacts.length) {
    return [
      {
        key: crypto.randomUUID(),
        type: 'TELEGRAM',
        value: '',
        isPrimary: true,
      },
    ];
  }
  return contacts.map((contact) => ({
    key: contact.id,
    id: contact.id,
    type: contact.type,
    value: contact.rawValue,
    ...(contact.telegramUserId ? { telegramUserId: contact.telegramUserId } : {}),
    ...(contact.isIdentity ? { isIdentity: true } : {}),
    isPrimary: contact.isPrimary,
  }));
}

export function EditPersonDialog({
  person,
  canEditContacts,
  onClose,
  onSaved,
}: {
  person: PersonDetail;
  canEditContacts: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const primaryAffiliation = person.affiliations[0];
  const [lastName, setLastName] = useState(person.lastName);
  const [firstName, setFirstName] = useState(person.firstName);
  const [patronymic, setPatronymic] = useState(person.patronymic);
  const [organization, setOrganization] = useState(
    primaryAffiliation?.organization ?? person.organization ?? '',
  );
  const [faculty, setFaculty] = useState(primaryAffiliation?.faculty ?? person.faculty ?? '');
  const [roleTitle, setRoleTitle] = useState(primaryAffiliation?.role ?? '');
  const [contacts, setContacts] = useState<EditableContact[]>(() =>
    toEditableContacts(person.contacts),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateContact(key: string, patch: Partial<EditableContact>) {
    setContacts((current) =>
      current.map((contact) => (contact.key === key ? { ...contact, ...patch } : contact)),
    );
  }

  function removeContact(key: string) {
    setContacts((current) => {
      const next = current.filter((contact) => contact.key !== key);
      if (next.length === 0) {
        return [{ key: crypto.randomUUID(), type: 'TELEGRAM', value: '', isPrimary: true }];
      }
      if (!next.some((contact) => contact.isPrimary) && next[0]) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  function addContact() {
    setContacts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        type: 'TELEGRAM',
        value: '',
        isPrimary: current.length === 0,
      },
    ]);
  }

  function togglePrimary(contact: EditableContact, checked: boolean) {
    setContacts((current) =>
      current.map((item) => {
        if (item.key === contact.key) return { ...item, isPrimary: checked };
        if (checked && item.type === contact.type) return { ...item, isPrimary: false };
        return item;
      }),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (![lastName, firstName, patronymic].every((part) => part.trim().length > 0)) {
      setError('Заполните фамилию, имя и отчество');
      return;
    }

    const filledContacts = contacts
      .map((contact) => ({
        ...contact,
        value: contact.value.trim(),
      }))
      .filter((contact) => contact.value.length > 0);

    if (canEditContacts) {
      const invalidPrimaryGroups = new Map<string, number>();
      for (const contact of filledContacts) {
        if (!contact.isPrimary) continue;
        invalidPrimaryGroups.set(contact.type, (invalidPrimaryGroups.get(contact.type) ?? 0) + 1);
      }
      for (const [type, count] of invalidPrimaryGroups) {
        if (count > 1) {
          setError(`Для типа ${type} может быть только один основной контакт`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        version: person.version,
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        patronymic: patronymic.trim(),
        organization: organization.trim() || null,
        faculty: faculty.trim() || null,
        roleTitle: roleTitle.trim() || null,
      };
      if (canEditContacts) {
        payload.contacts = filledContacts.map((contact) => ({
          ...(contact.id ? { id: contact.id } : {}),
          type: contact.type,
          value: contact.value,
          ...(contact.telegramUserId ? { telegramUserId: contact.telegramUserId } : {}),
          isPrimary: contact.isPrimary,
        }));
      }
      await api(`/people/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось сохранить карточку',
      );
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Карточка участника</DialogDescription>
          <DialogTitle>Редактировать участника</DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-person-last-name">Фамилия *</Label>
                <Input
                  autoFocus
                  id="edit-person-last-name"
                  maxLength={200}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                  value={lastName}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-person-first-name">Имя *</Label>
                <Input
                  id="edit-person-first-name"
                  maxLength={200}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                  value={firstName}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-person-patronymic">Отчество *</Label>
                <Input
                  id="edit-person-patronymic"
                  maxLength={200}
                  onChange={(event) => setPatronymic(event.target.value)}
                  required
                  value={patronymic}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-person-organization">Организация</Label>
                <Input
                  id="edit-person-organization"
                  maxLength={500}
                  onChange={(event) => setOrganization(event.target.value)}
                  placeholder="ВУЗ, компания или студия"
                  value={organization}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-person-faculty">Факультет / подразделение</Label>
                <Input
                  id="edit-person-faculty"
                  maxLength={500}
                  onChange={(event) => setFaculty(event.target.value)}
                  placeholder="Необязательно"
                  value={faculty}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-person-role">Роль / должность</Label>
                <Input
                  id="edit-person-role"
                  maxLength={500}
                  onChange={(event) => setRoleTitle(event.target.value)}
                  placeholder="Например, участник акселератора"
                  value={roleTitle}
                />
              </div>
            </div>

            {canEditContacts && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label asChild>
                    <h3>Контакты</h3>
                  </Label>
                  <Button onClick={addContact} size="xs" type="button" variant="ghost">
                    <PlusIcon /> Добавить
                  </Button>
                </div>

                <div className="space-y-2">
                  {contacts.map((contact) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]"
                      key={contact.key}
                    >
                      <Select
                        disabled={Boolean(contact.isIdentity)}
                        onValueChange={(next) =>
                          updateContact(contact.key, { type: next as ContactType })
                        }
                        value={contact.type}
                      >
                        <SelectTrigger aria-label="Тип контакта" size="sm">
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

                      <div className="col-span-2 space-y-1 sm:col-span-1">
                        <Input
                          aria-label="Значение контакта"
                          className="h-8"
                          onChange={(event) =>
                            updateContact(contact.key, { value: event.target.value })
                          }
                          placeholder="Значение"
                          readOnly={contact.isIdentity}
                          value={contact.value}
                        />
                        {contact.isIdentity && contact.telegramUserId && (
                          <p className="text-muted-foreground text-xs">
                            Главный идентификатор Telegram ID: {contact.telegramUserId}
                          </p>
                        )}
                      </div>

                      <label className="flex items-center gap-2 text-[13px] whitespace-nowrap">
                        <Checkbox
                          checked={contact.isPrimary}
                          disabled={contact.isIdentity}
                          onCheckedChange={(checked) => togglePrimary(contact, checked === true)}
                        />
                        Основной
                      </label>

                      <Button
                        aria-label="Удалить контакт"
                        disabled={contact.isIdentity}
                        onClick={() => removeContact(contact.key)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                </div>

                <p className="text-muted-foreground text-xs">
                  Telegram ID — главный идентификатор и меняется только синхронизацией с ботом.
                  Остальные пустые строки не сохраняются, убранные контакты архивируются.
                </p>
              </section>
            )}

            {error && (
              <p aria-live="polite" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Отмена
            </Button>
            <Button
              disabled={saving || !lastName.trim() || !firstName.trim() || !patronymic.trim()}
              type="submit"
            >
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
