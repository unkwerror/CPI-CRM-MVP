'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_TYPE_LABELS,
  INTERACTION_CHANNEL_LABELS,
  INTERACTION_DIRECTION_LABELS,
} from '@/lib/fpf-labels';
import type { AgreementStatus, AgreementType, PartnerDetail } from '@/lib/types';

import { Field, FormGrid } from '../partner-ui';

interface DialogProps {
  onClose: () => void;
  onSaved: () => void;
}

function FormDialog({
  eyebrow,
  title,
  formId,
  saving,
  disabled = false,
  error,
  onClose,
  onSubmit,
  children,
}: {
  eyebrow: string;
  title: string;
  formId: string;
  saving: boolean;
  disabled?: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogDescription>{eyebrow}</DialogDescription>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <form className="space-y-4" id={formId} onSubmit={onSubmit}>
            <FormGrid>{children}</FormGrid>
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
          <Button disabled={saving || disabled} form={formId} type="submit">
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContactDialog({
  partnerId,
  onClose,
  onSaved,
}: DialogProps & { partnerId: string }) {
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [isDecisionMaker, setIsDecisionMaker] = useState(true);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [telegram, setTelegram] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/partners/${partnerId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          isDecisionMaker,
          ...(position.trim() ? { position: position.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
        }),
      });
      toast.success('Контакт добавлен');
      onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить'));
      setSaving(false);
    }
  }

  return (
    <FormDialog
      disabled={fullName.trim().length < 2}
      error={error}
      eyebrow="База партнёров"
      formId="partner-contact-form"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      title="Добавить ЛПР"
    >
      <Field full htmlFor="contact-name" label="ФИО *">
        <Input
          autoFocus
          id="contact-name"
          maxLength={500}
          minLength={2}
          onChange={(event) => setFullName(event.target.value)}
          required
          value={fullName}
        />
      </Field>
      <Field htmlFor="contact-position" label="Должность">
        <Input
          id="contact-position"
          maxLength={500}
          onChange={(event) => setPosition(event.target.value)}
          value={position}
        />
      </Field>
      <div className="flex items-center justify-between gap-3 self-end rounded-md border px-3 py-2">
        <Label className="normal-case" htmlFor="contact-decision-maker">
          Принимает решения
        </Label>
        <Switch
          checked={isDecisionMaker}
          id="contact-decision-maker"
          onCheckedChange={setIsDecisionMaker}
        />
      </div>
      <Field htmlFor="contact-email" label="Email">
        <Input
          id="contact-email"
          maxLength={500}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
      </Field>
      <Field htmlFor="contact-phone" label="Телефон">
        <Input
          id="contact-phone"
          maxLength={100}
          onChange={(event) => setPhone(event.target.value)}
          value={phone}
        />
      </Field>
      <Field htmlFor="contact-telegram" label="Telegram">
        <Input
          id="contact-telegram"
          maxLength={100}
          onChange={(event) => setTelegram(event.target.value)}
          value={telegram}
        />
      </Field>
    </FormDialog>
  );
}

export function AgreementDialog({
  partnerId,
  onClose,
  onSaved,
}: DialogProps & { partnerId: string }) {
  const [title, setTitle] = useState('');
  const [agreementType, setAgreementType] = useState<AgreementType>('PARTNERSHIP');
  const [status, setStatus] = useState<AgreementStatus>('DRAFT');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/partners/${partnerId}/agreements`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          agreementType,
          status,
          ...(amount ? { amount: Number(amount) } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      toast.success('Соглашение сохранено');
      onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить'));
      setSaving(false);
    }
  }

  return (
    <FormDialog
      disabled={title.trim().length < 2}
      error={error}
      eyebrow="База партнёров"
      formId="partner-agreement-form"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      title="Новое соглашение"
    >
      <Field full htmlFor="agreement-title" label="Название *">
        <Input
          autoFocus
          id="agreement-title"
          maxLength={500}
          minLength={2}
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
      </Field>
      <Field htmlFor="agreement-type" label="Тип">
        <Select
          onValueChange={(value) => setAgreementType(value as AgreementType)}
          value={agreementType}
        >
          <SelectTrigger id="agreement-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(AGREEMENT_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="agreement-status" label="Статус">
        <Select onValueChange={(value) => setStatus(value as AgreementStatus)} value={status}>
          <SelectTrigger id="agreement-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(AGREEMENT_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="agreement-amount" label="Сумма, ₽">
        <Input
          className="tabular"
          id="agreement-amount"
          min={0}
          onChange={(event) => setAmount(event.target.value)}
          step="0.01"
          type="number"
          value={amount}
        />
      </Field>
      <Field full htmlFor="agreement-comment" label="Комментарий">
        <Textarea
          id="agreement-comment"
          maxLength={10_000}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          value={comment}
        />
      </Field>
    </FormDialog>
  );
}

const NO_CONTACT = 'none';

export function InteractionDialog({
  partner,
  onClose,
  onSaved,
}: DialogProps & { partner: PartnerDetail }) {
  const [channel, setChannel] = useState('IN_PERSON');
  const [direction, setDirection] = useState('OUTBOUND');
  const [contactId, setContactId] = useState(NO_CONTACT);
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [outcome, setOutcome] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/partners/${partner.id}/interactions`, {
        method: 'POST',
        body: JSON.stringify({
          channel,
          direction,
          occurredAt: new Date(occurredAt).toISOString(),
          ...(contactId !== NO_CONTACT ? { contactId } : {}),
          ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      toast.success('Взаимодействие записано');
      onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось сохранить'));
      setSaving(false);
    }
  }

  return (
    <FormDialog
      error={error}
      eyebrow="История отношений"
      formId="partner-interaction-form"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      title="Записать взаимодействие"
    >
      <Field htmlFor="interaction-channel" label="Канал">
        <Select onValueChange={setChannel} value={channel}>
          <SelectTrigger id="interaction-channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(INTERACTION_CHANNEL_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="interaction-direction" label="Направление">
        <Select onValueChange={setDirection} value={direction}>
          <SelectTrigger id="interaction-direction">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(INTERACTION_DIRECTION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="interaction-occurred-at" label="Когда *">
        <Input
          id="interaction-occurred-at"
          onChange={(event) => setOccurredAt(event.target.value)}
          required
          type="datetime-local"
          value={occurredAt}
        />
      </Field>
      <Field htmlFor="interaction-contact" label="С кем (ЛПР)">
        <Select onValueChange={setContactId} value={contactId}>
          <SelectTrigger id="interaction-contact">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONTACT}>Не указан</SelectItem>
            {partner.contacts.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                {contact.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field full htmlFor="interaction-outcome" label="Итог">
        <Input
          id="interaction-outcome"
          maxLength={2000}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder="Например, договорились о пилоте"
          value={outcome}
        />
      </Field>
      <Field full htmlFor="interaction-comment" label="Комментарий">
        <Textarea
          id="interaction-comment"
          maxLength={10_000}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          value={comment}
        />
      </Field>
    </FormDialog>
  );
}
