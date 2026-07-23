import { createDatabase } from '@cpi-crm/db';

import { loadConfig } from './config.js';

const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations (id, name, normalized_name, short_name, kind, external_id)
       VALUES ('00000000-0000-4000-8000-000000000010', 'Центр проектных инициатив',
               'центр проектных инициатив', 'ЦПИ', 'TENANT', 'cpi-primary')
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET updated_at = now()
       RETURNING id`,
    );
    const organizationId = organization.rows[0]!.id;
    const importerUser = await client.query<{ id: string }>(
      `INSERT INTO app_users
         (id, oidc_subject, email, normalized_email, display_name, status)
       VALUES ('00000000-0000-4000-8000-000000000001', 'local-importer',
               'local-importer@cpi.local', 'local-importer@cpi.local',
               'Системный импорт', 'ACTIVE')
       ON CONFLICT (oidc_subject) DO UPDATE SET updated_at = now()
       RETURNING id`,
    );
    await client.query(
      `INSERT INTO app_user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE code = 'data_steward'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [importerUser.rows[0]!.id],
    );
    const ruleSet = await client.query<{ id: string }>(
      `INSERT INTO lifecycle_rule_sets
         (organization_id, rule_version, active_window_hours, inactive_after_hours,
          effective_from, change_comment)
       VALUES ($1, 1, 252, 504, $2, 'Начальные правила из CODEX_CRM_CPI_MVP.md')
       ON CONFLICT (organization_id, rule_version) DO UPDATE
         SET active_window_hours = EXCLUDED.active_window_hours,
             inactive_after_hours = EXCLUDED.inactive_after_hours
       RETURNING id`,
      [organizationId, config.artifactBaselineAt],
    );
    await client.query(
      `INSERT INTO organization_settings
         (organization_id, artifact_baseline_at, timezone, current_lifecycle_rule_set_id,
          change_reason)
       VALUES ($1, $2, $3, $4, 'Первичная локальная настройка')
       ON CONFLICT (organization_id) DO UPDATE
         SET artifact_baseline_at = EXCLUDED.artifact_baseline_at,
             timezone = EXCLUDED.timezone,
             current_lifecycle_rule_set_id = EXCLUDED.current_lifecycle_rule_set_id,
             updated_at = now()`,
      [organizationId, config.artifactBaselineAt, config.timezone, ruleSet.rows[0]!.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  process.stdout.write('Локальные настройки ЦПИ созданы или актуализированы.\n');
} finally {
  await pool.end();
}
