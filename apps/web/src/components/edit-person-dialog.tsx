'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

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
  isPrimary: boolean;
}

function toEditableContacts(contacts: ContactPoint[]): EditableContact[] {
  if (!contacts.length) {
    return [
      {
        key: crypto.randomUUID(),
        type: 'PHONE',
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
  const [name, setName] = useState(person.canonicalFullName);
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

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  function updateContact(key: string, patch: Partial<EditableContact>) {
    setContacts((current) =>
      current.map((contact) => (contact.key === key ? { ...contact, ...patch } : contact)),
    );
  }

  function removeContact(key: string) {
    setContacts((current) => {
      const next = current.filter((contact) => contact.key !== key);
      if (next.length === 0) {
        return [{ key: crypto.randomUUID(), type: 'PHONE', value: '', isPrimary: true }];
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
        type: 'PHONE',
        value: '',
        isPrimary: current.length === 0,
      },
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError('Укажите ФИО не короче двух символов');
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
        invalidPrimaryGroups.set(
          contact.type,
          (invalidPrimaryGroups.get(contact.type) ?? 0) + 1,
        );
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
        canonicalFullName: trimmedName,
        organization: organization.trim() || null,
        faculty: faculty.trim() || null,
        roleTitle: roleTitle.trim() || null,
      };
      if (canEditContacts) {
        payload.contacts = filledContacts.map((contact) => ({
          ...(contact.id ? { id: contact.id } : {}),
          type: contact.type,
          value: contact.value,
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
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section
        aria-labelledby="edit-person-title"
        aria-modal="true"
        className="dialog edit-person-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Карточка участника</p>
            <h2 id="edit-person-title">Редактировать участника</h2>
          </div>
          <button
            aria-label="Закрыть"
            className="icon-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>ФИО *</span>
              <input
                autoFocus
                maxLength={500}
                minLength={2}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>

            <label className="form-field">
              <span>Организация</span>
              <input
                maxLength={500}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="ВУЗ, компания или студия"
                value={organization}
              />
            </label>

            <label className="form-field">
              <span>Факультет / подразделение</span>
              <input
                maxLength={500}
                onChange={(event) => setFaculty(event.target.value)}
                placeholder="Необязательно"
                value={faculty}
              />
            </label>

            <label className="form-field form-field--full">
              <span>Роль / должность</span>
              <input
                maxLength={500}
                onChange={(event) => setRoleTitle(event.target.value)}
                placeholder="Например, участник акселератора"
                value={roleTitle}
              />
            </label>

            {canEditContacts && (
              <div className="form-field form-field--full">
                <div className="edit-person-contacts__header">
                  <span>Контакты</span>
                  <button className="text-link" onClick={addContact} type="button">
                    <Plus size={14} /> Добавить
                  </button>
                </div>
                <div className="edit-person-contacts">
                  {contacts.map((contact) => (
                    <div className="edit-person-contact-row" key={contact.key}>
                      <label className="form-field">
                        <span className="sr-only">Тип контакта</span>
                        <select
                          onChange={(event) =>
                            updateContact(contact.key, {
                              type: event.target.value as ContactType,
                            })
                          }
                          value={contact.type}
                        >
                          {CONTACT_TYPES.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span className="sr-only">Значение контакта</span>
                        <input
                          onChange={(event) =>
                            updateContact(contact.key, { value: event.target.value })
                          }
                          placeholder="Значение"
                          value={contact.value}
                        />
                      </label>
                      <label className="edit-person-contact-row__primary">
                        <input
                          checked={contact.isPrimary}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setContacts((current) =>
                              current.map((item) => {
                                if (item.key === contact.key) {
                                  return { ...item, isPrimary: checked };
                                }
                                if (checked && item.type === contact.type) {
                                  return { ...item, isPrimary: false };
                                }
                                return item;
                              }),
                            );
                          }}
                          type="checkbox"
                        />
                        Основной
                      </label>
                      <button
                        aria-label="Удалить контакт"
                        className="icon-button"
                        onClick={() => removeContact(contact.key)}
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <small className="form-field__hint">
                  Пустые строки не сохраняются. Контакты, убранные из списка, будут архивированы.
                </small>
              </div>
            )}
          </div>

          {error && (
            <p aria-live="polite" className="form-error">
              {error}
            </p>
          )}

          <footer className="dialog__footer">
            <button
              className="button button--secondary"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Отмена
            </button>
            <button
              className="button button--primary"
              disabled={saving || name.trim().length < 2}
              type="submit"
            >
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
