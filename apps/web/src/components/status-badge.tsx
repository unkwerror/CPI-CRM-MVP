import { Badge } from '@/components/ui/badge';
import type { ActivationState, ActivityStatus } from '@/lib/types';

const ACTIVITY_LABELS: Record<ActivityStatus, string> = {
  ACTIVE: 'Активен',
  MEDIUM: 'Средняя активность',
  INACTIVE: 'Неактивен',
  UNKNOWN: 'Статус неизвестен',
};

const ACTIVITY_VARIANTS = {
  ACTIVE: 'soft-success',
  MEDIUM: 'soft-warning',
  INACTIVE: 'soft-destructive',
  UNKNOWN: 'soft-muted',
  NOT_ACTIVATED: 'soft-muted',
} as const;

export function StatusBadge({
  activity,
  activation,
}: {
  activity: ActivityStatus;
  activation: ActivationState;
}) {
  const effective = activation === 'NOT_ACTIVATED' ? 'NOT_ACTIVATED' : activity;
  const label =
    activation === 'NOT_ACTIVATED'
      ? 'Не активирован'
      : activation === 'UNKNOWN_LEGACY' && activity === 'UNKNOWN'
        ? 'История неполна'
        : ACTIVITY_LABELS[activity];

  return <Badge variant={ACTIVITY_VARIANTS[effective]}>{label}</Badge>;
}
