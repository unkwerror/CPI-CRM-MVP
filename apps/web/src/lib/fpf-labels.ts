import type {
  AgreementStatus,
  AgreementType,
  DealStatus,
  DealType,
  ExpenseCategory,
  PartnerKind,
  PartnerStatus,
  ProductStatus,
} from './types';

export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  COMMERCIAL: 'Коммерческий',
  GRANT_FUND: 'Грантовый фонд',
  UNIVERSITY: 'Вуз / факультет',
  GOVERNMENT: 'Госструктура',
  MEDIA: 'Инфопартнёр',
  OTHER: 'Другое',
};

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  PROSPECT: 'Потенциальный',
  DEVELOPING: 'Развитие отношений',
  ACTIVE: 'Активный',
  PAUSED: 'На паузе',
  CLOSED: 'Закрыт',
};

export const AGREEMENT_TYPE_LABELS: Record<AgreementType, string> = {
  GRANT: 'Грант',
  COMMERCIAL: 'Коммерческое',
  PARTNERSHIP: 'Партнёрское',
  INFO_PARTNERSHIP: 'Инфопартнёрство',
};

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  DRAFT: 'Черновик',
  NEGOTIATION: 'Переговоры',
  ACTIVE: 'Активно',
  COMPLETED: 'Завершено',
  TERMINATED: 'Расторгнуто',
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  IDEA: 'Идея',
  PACKAGING: 'Упаковка',
  ON_SALE: 'В продаже',
  CLOSED: 'Закрыт',
};

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  GRANT: 'Грант',
  COMMERCIAL: 'Коммерция',
};

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  LEAD: 'Лид',
  NEGOTIATION: 'Переговоры',
  WON: 'Выиграна',
  LOST: 'Проиграна',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  VARIABLE: 'Переменные',
  OPEX: 'Операционные',
  BACK_OFFICE: 'Бэк-офис',
  ACQUISITION: 'Привлечение',
  ACTIVATION: 'Активация',
};

export const EXPENSE_CATEGORY_HINTS: Record<ExpenseCategory, string> = {
  VARIABLE:
    'Возникают только из-за конкретной сделки/мероприятия: подрядчик, материалы, призовой фонд',
  OPEX: 'Содержание системы: команда, регулярные сервисы, административные процессы',
  BACK_OFFICE: 'Документы, заявки, бюджеты, сопровождение',
  ACQUISITION: 'Привлечение новых строк в базу: реклама, информационная политика',
  ACTIVATION: 'Трекинг, эксперты, активационные сессии, инструменты',
};

export const EXPENSE_CATEGORY_ORDER: ExpenseCategory[] = [
  'VARIABLE',
  'OPEX',
  'BACK_OFFICE',
  'ACQUISITION',
  'ACTIVATION',
];

export const INTERACTION_CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE: 'Телефон',
  TELEGRAM: 'Telegram',
  MAX: 'MAX',
  IN_PERSON: 'Встреча',
  OTHER: 'Другое',
};

export const INTERACTION_DIRECTION_LABELS: Record<string, string> = {
  INBOUND: 'Входящее',
  OUTBOUND: 'Исходящее',
  INTERNAL: 'Внутреннее',
};
