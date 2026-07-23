import type { Pool, PoolClient } from 'pg';

import { HttpProblem } from './problem.js';

export interface OrganizationContext {
  id: string;
  ruleSetId: string;
  activeWindowHours: number;
  inactiveAfterHours: number;
  baselineAt: Date | null;
  timezone: string;
}

export async function getOrganizationContext(db: Pool | PoolClient): Promise<OrganizationContext> {
  const result = await db.query<{
    id: string;
    rule_set_id: string;
    active_window_hours: number;
    inactive_after_hours: number;
    artifact_baseline_at: Date | null;
    timezone: string;
  }>(`SELECT o.id,
            os.current_lifecycle_rule_set_id AS rule_set_id,
            lrs.active_window_hours,
            lrs.inactive_after_hours,
            os.artifact_baseline_at,
            os.timezone
       FROM organization_settings os
       JOIN organizations o ON o.id = os.organization_id
       JOIN lifecycle_rule_sets lrs ON lrs.id = os.current_lifecycle_rule_set_id
      ORDER BY os.created_at
      LIMIT 1`);
  const row = result.rows[0];
  if (!row) {
    throw new HttpProblem(503, 'Система не настроена', 'Запустите pnpm db:seed после миграций.');
  }
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    activeWindowHours: row.active_window_hours,
    inactiveAfterHours: row.inactive_after_hours,
    baselineAt: row.artifact_baseline_at,
    timezone: row.timezone,
  };
}
