'use client';

import {
  ArrowLeft,
  FileSignature,
  Handshake,
  MessageSquare,
  Pencil,
  Plus,
  UserRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ApiError, api, formatDate, formatMoney } from '@/lib/api';
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_TYPE_LABELS,
  DEAL_STATUS_LABELS,
  DEAL_TYPE_LABELS,
  INTERACTION_CHANNEL_LABELS,
  INTERACTION_DIRECTION_LABELS,
  PARTNER_KIND_LABELS,
  PARTNER_STATUS_LABELS,
} from '@/lib/fpf-labels';
import type {
  AgreementStatus,
  AgreementType,
  CurrentUser,
  PartnerDetail,
  PartnerStatus,
} from '@/lib/types';

export function PartnerPageClient({ id }: { id: string }) {
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [dialog, setDialog] = useState<'contact' | 'agreement' | 'interaction' | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPartner(await api<PartnerDetail>(`/partners/${id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить партнёра');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<CurrentUser>('/auth/me')
      .then((user) => setCanWrite(user.permissions.includes('partners.write')))
      .catch(() => setCanWrite(false));
  }, []);

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
      window.alert(
        caught instanceof ApiError
          ? (caught.detail ?? caught.message)
          : 'Не удалось сохранить комментарий',
      );
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
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить статус');
    } finally {
      setStatusSaving(false);
    }
  }

  if (loading) return <div className="page-loading">Загружаем партнёра…</div>;
  if (error || !partner) {
    return (
      <div className="page-stack">
        <section className="panel">
          <EmptyState title="Партнёр недоступен" text={error ?? 'Карточка не найдена'} />
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--split">
        <div>
          <Link className="text-link" href="/partners">
            <ArrowLeft size={15} /> Все партнёры
          </Link>
          <h1>{partner.name}</h1>
          <p>
            {PARTNER_KIND_LABELS[partner.kind]}
            {partner.inn ? ` · ИНН ${partner.inn}` : ''}
            {partner.website ? ' · ' : ''}
            {partner.website && (
              <a href={partner.website} rel="noreferrer" target="_blank">
                {partner.website}
              </a>
            )}
          </p>
        </div>
        <div className="heading-actions">
          {canWrite ? (
            <select
              aria-label="Статус партнёра"
              className="select-control"
              disabled={statusSaving}
              value={partner.status}
              onChange={(event) => void changeStatus(event.target.value as PartnerStatus)}
            >
              {Object.entries(PARTNER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <span className="event-status">{PARTNER_STATUS_LABELS[partner.status]}</span>
          )}
        </div>
      </section>

      {(partner.notes || canWrite) && (
        <section className="panel">
          <header className="panel__header">
            <h2>Комментарий</h2>
            {canWrite && notesDraft === null && (
              <button className="text-link" onClick={() => setNotesDraft(partner.notes ?? '')}>
                <Pencil size={14} /> Редактировать
              </button>
            )}
          </header>
          {notesDraft !== null ? (
            <div>
              <textarea
                className="notes-textarea"
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                rows={6}
                style={{ width: '100%', resize: 'vertical' }}
                disabled={savingNotes}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  className="button button--primary button--compact"
                  onClick={() => void saveNotes()}
                  disabled={savingNotes}
                >
                  {savingNotes ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button
                  className="button button--secondary button--compact"
                  onClick={() => setNotesDraft(null)}
                  disabled={savingNotes}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : partner.notes ? (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                font: 'inherit',
                margin: 0,
              }}
            >
              {partner.notes}
            </pre>
          ) : (
            <p className="muted">Комментария пока нет.</p>
          )}
        </section>
      )}

      <section className="dashboard-columns">
        <article className="panel panel--wide">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Лица, принимающие решения</p>
              <h2>ЛПР и контакты</h2>
            </div>
            {canWrite && (
              <button className="button button--secondary" onClick={() => setDialog('contact')}>
                <Plus size={15} /> Добавить ЛПР
              </button>
            )}
          </header>
          {partner.contacts.length === 0 ? (
            <EmptyState
              title="ЛПР не каталогизированы"
              text="Добавьте ключевые контакты партнёра."
            />
          ) : (
            <div className="detail-list">
              {partner.contacts.map((contact) => (
                <div className="detail-row" key={contact.id}>
                  <span className="detail-row__icon">
                    <UserRound size={17} />
                  </span>
                  <span>
                    <strong>
                      {contact.fullName}
                      {contact.isDecisionMaker ? ' · ЛПР' : ''}
                    </strong>
                    <small>
                      {[contact.position, contact.email, contact.phone, contact.telegram]
                        .filter(Boolean)
                        .join(' · ') || 'Контактные данные не указаны'}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Соглашения</p>
              <h2>Статус соглашений</h2>
            </div>
            {canWrite && (
              <button className="button button--secondary" onClick={() => setDialog('agreement')}>
                <Plus size={15} />
              </button>
            )}
          </header>
          {partner.agreements.length === 0 ? (
            <EmptyState title="Соглашений нет" text="Зафиксируйте соглашение с партнёром." />
          ) : (
            <div className="detail-list">
              {partner.agreements.map((agreement) => (
                <div className="detail-row" key={agreement.id}>
                  <span className="detail-row__icon">
                    <FileSignature size={17} />
                  </span>
                  <span>
                    <strong>{agreement.title}</strong>
                    <small>
                      {AGREEMENT_TYPE_LABELS[agreement.agreementType]} ·{' '}
                      {AGREEMENT_STATUS_LABELS[agreement.status]}
                      {agreement.amount !== null && agreement.amount !== undefined
                        ? ` · ${formatMoney(agreement.amount)}`
                        : ''}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="dashboard-columns dashboard-columns--bottom">
        <article className="panel panel--wide">
          <header className="panel__header">
            <div>
              <p className="eyebrow">История отношений</p>
              <h2>Взаимодействия</h2>
            </div>
            {canWrite && (
              <button className="button button--secondary" onClick={() => setDialog('interaction')}>
                <Plus size={15} /> Записать касание
              </button>
            )}
          </header>
          {partner.interactions.length === 0 ? (
            <EmptyState
              title="Взаимодействий нет"
              text="Партнёрство без взаимодействий не считается активным — зафиксируйте первое касание."
            />
          ) : (
            <div className="detail-list">
              {partner.interactions.map((interaction) => (
                <div className="detail-row" key={interaction.id}>
                  <span className="detail-row__icon">
                    <MessageSquare size={17} />
                  </span>
                  <span>
                    <strong>
                      {INTERACTION_CHANNEL_LABELS[interaction.channel] ?? interaction.channel} ·{' '}
                      {INTERACTION_DIRECTION_LABELS[interaction.direction] ?? interaction.direction}
                      {interaction.contactName ? ` · ${interaction.contactName}` : ''}
                    </strong>
                    <small>
                      {formatDate(interaction.occurredAt, true)}
                      {interaction.outcome ? ` · ${interaction.outcome}` : ''}
                      {interaction.comment ? ` — ${interaction.comment}` : ''}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <header className="panel__header">
            <div>
              <p className="eyebrow">Обеспечение выручки</p>
              <h2>Сделки</h2>
            </div>
            <Link className="text-link" href="/deals">
              Все сделки
            </Link>
          </header>
          {partner.deals.length === 0 ? (
            <EmptyState title="Сделок нет" text="Сделки партнёра появятся здесь." />
          ) : (
            <div className="detail-list">
              {partner.deals.map((deal) => (
                <div className="detail-row" key={deal.id}>
                  <span className="detail-row__icon">
                    <Handshake size={17} />
                  </span>
                  <span>
                    <strong>{deal.title}</strong>
                    <small>
                      {DEAL_TYPE_LABELS[deal.dealType]} · {DEAL_STATUS_LABELS[deal.status]} ·{' '}
                      {formatMoney(deal.amount)}
                      {deal.productName ? ` · ${deal.productName}` : ''}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {dialog === 'contact' && (
        <ContactDialog
          partnerId={partner.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog === 'agreement' && (
        <AgreementDialog
          partnerId={partner.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog === 'interaction' && (
        <InteractionDialog
          partner={partner}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DialogShell({
  title,
  eyebrow,
  saving,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  saving: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section
        aria-modal="true"
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
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
        {children}
      </section>
    </div>
  );
}

function ContactDialog({
  partnerId,
  onClose,
  onSaved,
}: {
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? (caught.detail ?? caught.message) : 'Не удалось сохранить',
      );
      setSaving(false);
    }
  }

  return (
    <DialogShell eyebrow="База партнёров" onClose={onClose} saving={saving} title="Добавить ЛПР">
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="form-field form-field--full">
            <span>ФИО *</span>
            <input
              autoFocus
              minLength={2}
              maxLength={500}
              onChange={(event) => setFullName(event.target.value)}
              required
              value={fullName}
            />
          </label>
          <label className="form-field">
            <span>Должность</span>
            <input
              maxLength={500}
              onChange={(event) => setPosition(event.target.value)}
              value={position}
            />
          </label>
          <label className="form-field">
            <span>Роль</span>
            <select
              onChange={(event) => setIsDecisionMaker(event.target.value === 'yes')}
              value={isDecisionMaker ? 'yes' : 'no'}
            >
              <option value="yes">ЛПР — принимает решения</option>
              <option value="no">Контактное лицо</option>
            </select>
          </label>
          <label className="form-field">
            <span>Email</span>
            <input
              maxLength={500}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </label>
          <label className="form-field">
            <span>Телефон</span>
            <input maxLength={100} onChange={(event) => setPhone(event.target.value)} value={phone} />
          </label>
          <label className="form-field">
            <span>Telegram</span>
            <input
              maxLength={100}
              onChange={(event) => setTelegram(event.target.value)}
              value={telegram}
            />
          </label>
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
            disabled={saving || fullName.trim().length < 2}
            type="submit"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}

function AgreementDialog({
  partnerId,
  onClose,
  onSaved,
}: {
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? (caught.detail ?? caught.message) : 'Не удалось сохранить',
      );
      setSaving(false);
    }
  }

  return (
    <DialogShell
      eyebrow="База партнёров"
      onClose={onClose}
      saving={saving}
      title="Новое соглашение"
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="form-field form-field--full">
            <span>Название *</span>
            <input
              autoFocus
              minLength={2}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className="form-field">
            <span>Тип</span>
            <select
              onChange={(event) => setAgreementType(event.target.value as AgreementType)}
              value={agreementType}
            >
              {Object.entries(AGREEMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Статус</span>
            <select
              onChange={(event) => setStatus(event.target.value as AgreementStatus)}
              value={status}
            >
              {Object.entries(AGREEMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Сумма, ₽</span>
            <input
              min={0}
              onChange={(event) => setAmount(event.target.value)}
              step="0.01"
              type="number"
              value={amount}
            />
          </label>
          <label className="form-field form-field--full">
            <span>Комментарий</span>
            <textarea
              maxLength={10_000}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              value={comment}
            />
          </label>
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
            disabled={saving || title.trim().length < 2}
            type="submit"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}

function InteractionDialog({
  partner,
  onClose,
  onSaved,
}: {
  partner: PartnerDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState('IN_PERSON');
  const [direction, setDirection] = useState('OUTBOUND');
  const [contactId, setContactId] = useState('');
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
          ...(contactId ? { contactId } : {}),
          ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? (caught.detail ?? caught.message) : 'Не удалось сохранить',
      );
      setSaving(false);
    }
  }

  return (
    <DialogShell
      eyebrow="История отношений"
      onClose={onClose}
      saving={saving}
      title="Записать взаимодействие"
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="form-field">
            <span>Канал</span>
            <select onChange={(event) => setChannel(event.target.value)} value={channel}>
              {Object.entries(INTERACTION_CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Направление</span>
            <select onChange={(event) => setDirection(event.target.value)} value={direction}>
              {Object.entries(INTERACTION_DIRECTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Когда *</span>
            <input
              onChange={(event) => setOccurredAt(event.target.value)}
              required
              type="datetime-local"
              value={occurredAt}
            />
          </label>
          <label className="form-field">
            <span>С кем (ЛПР)</span>
            <select onChange={(event) => setContactId(event.target.value)} value={contactId}>
              <option value="">Не указан</option>
              {partner.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field form-field--full">
            <span>Итог</span>
            <input
              maxLength={2000}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="Например, договорились о пилоте"
              value={outcome}
            />
          </label>
          <label className="form-field form-field--full">
            <span>Комментарий</span>
            <textarea
              maxLength={10_000}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              value={comment}
            />
          </label>
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
          <button className="button button--primary" disabled={saving} type="submit">
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}
