import type { badgeVariants } from '@/components/ui/badge';
import type { DealStatus, TaskSummary } from '@/lib/types';

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>['variant'];

export const EVENT_STATUS_LABELS: Record<string, string> = {
  UNKNOWN: 'Не указан',
  PLANNED: 'Запланировано',
  ACTIVE: 'Идёт',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
};

export const EVENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  UNKNOWN: 'soft-muted',
  PLANNED: 'soft-info',
  ACTIVE: 'soft-primary',
  COMPLETED: 'soft-success',
  CANCELLED: 'soft-destructive',
};

export const EVENT_STATUS_ORDER = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  LEAD: 'Лид',
  NEGOTIATION: 'Переговоры',
  WON: 'Выиграна',
  LOST: 'Проиграна',
};

export const DEAL_STATUS_VARIANTS: Record<DealStatus, BadgeVariant> = {
  LEAD: 'soft-info',
  NEGOTIATION: 'soft-warning',
  WON: 'soft-success',
  LOST: 'soft-destructive',
};

export const DEAL_STATUS_ORDER: DealStatus[] = ['LEAD', 'NEGOTIATION', 'WON', 'LOST'];

export const TASK_STATUS_LABELS: Record<TaskSummary['status'], string> = {
  OPEN: 'Открыта',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнена',
  CANCELLED: 'Отменена',
};

export const TASK_STATUS_VARIANTS: Record<TaskSummary['status'], BadgeVariant> = {
  OPEN: 'soft-info',
  IN_PROGRESS: 'soft-warning',
  DONE: 'soft-success',
  CANCELLED: 'soft-muted',
};

export const TASK_STATUS_ORDER: TaskSummary['status'][] = [
  'OPEN',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
];

export const PARTICIPATION_DECISION_LABELS: Record<string, string> = {
  UNKNOWN: 'Не указано',
  PENDING: 'На рассмотрении',
  ACCEPTED: 'Принят',
  REJECTED: 'Отклонён',
  WAITLISTED: 'В резерве',
};

export const ATTENDANCE_LABELS: Record<string, string> = {
  UNKNOWN: 'Не отмечено',
  ATTENDED: 'Посетил',
  NO_SHOW: 'Не пришёл',
  PARTIAL: 'Частично',
};

export const ARTIFACT_VERSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Отправлен',
  VOIDED: 'Аннулирован',
};

/** Решение по артефакту после упрощения рубрикатора: принят или не принят. */
export const REVIEW_DECISION_LABELS: Record<string, string> = {
  ACCEPTED: 'Принят',
  REJECTED: 'Не принят',
  NEEDS_REVISION: 'На доработку',
};

export const REVIEW_DECISION_VARIANTS: Record<string, BadgeVariant> = {
  ACCEPTED: 'soft-success',
  REJECTED: 'soft-destructive',
  NEEDS_REVISION: 'soft-warning',
};

export function scoreVariant(score: number | null | undefined): BadgeVariant {
  if (score === null || score === undefined) return 'soft-muted';
  if (score >= 7) return 'soft-success';
  if (score >= 4) return 'soft-warning';
  return 'soft-destructive';
}
