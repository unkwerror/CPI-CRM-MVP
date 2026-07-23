import type { ActivationState, ActivityStatus } from '@/lib/types';

const activityLabels: Record<ActivityStatus, string> = {
  ACTIVE: 'Активен',
  MEDIUM: 'Средняя активность',
  INACTIVE: 'Неактивен',
  UNKNOWN: 'Статус неизвестен',
};

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
        : activityLabels[activity];

  return <span className={`status status--${effective.toLowerCase()}`}>{label}</span>;
}
