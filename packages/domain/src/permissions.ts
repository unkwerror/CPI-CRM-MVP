export const Permissions = {
  PEOPLE_READ: 'people.read',
  PEOPLE_WRITE: 'people.write',
  EVENTS_WRITE: 'events.write',
  CONTACTS_READ: 'contacts.read',
  CONTACTS_WRITE: 'contacts.write',
  ARTIFACTS_READ: 'artifacts.read',
  ARTIFACTS_WRITE: 'artifacts.write',
  ARTIFACTS_REVIEW: 'artifacts.review',
  TASKS_MANAGE: 'tasks.manage',
  IMPORTS_RUN: 'imports.run',
  IMPORTS_READ_RAW: 'imports.read_raw',
  DUPLICATES_RESOLVE: 'duplicates.resolve',
  AUDIT_READ: 'audit.read',
  SETTINGS_MANAGE: 'settings.manage',
  EXPORTS_BULK: 'exports.bulk',
  PARTNERS_READ: 'partners.read',
  PARTNERS_WRITE: 'partners.write',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  DEALS_READ: 'deals.read',
  DEALS_WRITE: 'deals.write',
  METRICS_READ: 'metrics.read',
  EXPENSES_READ: 'expenses.read',
  EXPENSES_WRITE: 'expenses.write',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(Object.values(Permissions));

export const Roles = {
  ADMIN: 'admin',
  /** Руководитель СС: стратегия, контроль выручки и метрик. */
  LEADER: 'leader',
  COMMUNITY_MANAGER: 'community_manager',
  /** Ивент-менеджер: препродакшн, проведение и постпродакшн мероприятий. */
  EVENT_MANAGER: 'event_manager',
  /** Менеджер по партнёрке/продажам: партнёры, соглашения, сделки. */
  PARTNER_MANAGER: 'partner_manager',
  METHODOLOGIST: 'methodologist',
  /** Менеджер по операционке (бэк-офис): документооборот и сопровождение. */
  BACK_OFFICE: 'back_office',
  /** SMM-менеджер: информационная политика. */
  SMM_MANAGER: 'smm_manager',
  /** Менеджер по продукту: формирование и документирование продуктов. */
  PRODUCT_MANAGER: 'product_manager',
  DATA_STEWARD: 'data_steward',
  AUDITOR: 'auditor',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

const permissions = (...values: Permission[]): readonly Permission[] => Object.freeze(values);

/** Central fail-closed role matrix. A user with multiple roles receives the union. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  [Roles.ADMIN]: ALL_PERMISSIONS,
  [Roles.LEADER]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.CONTACTS_READ,
    Permissions.ARTIFACTS_READ,
    Permissions.PARTNERS_READ,
    Permissions.PRODUCTS_READ,
    Permissions.DEALS_READ,
    Permissions.METRICS_READ,
    Permissions.EXPENSES_READ,
    Permissions.EXPENSES_WRITE,
    Permissions.AUDIT_READ,
    Permissions.EXPORTS_BULK,
    Permissions.SETTINGS_MANAGE,
  ),
  [Roles.COMMUNITY_MANAGER]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.PEOPLE_WRITE,
    Permissions.EVENTS_WRITE,
    Permissions.CONTACTS_READ,
    Permissions.CONTACTS_WRITE,
    Permissions.ARTIFACTS_READ,
    Permissions.ARTIFACTS_WRITE,
    Permissions.TASKS_MANAGE,
    Permissions.METRICS_READ,
  ),
  [Roles.EVENT_MANAGER]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.CONTACTS_READ,
    Permissions.EVENTS_WRITE,
    Permissions.ARTIFACTS_READ,
    Permissions.ARTIFACTS_WRITE,
    Permissions.TASKS_MANAGE,
    Permissions.METRICS_READ,
    Permissions.EXPENSES_READ,
  ),
  [Roles.PARTNER_MANAGER]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.PARTNERS_READ,
    Permissions.PARTNERS_WRITE,
    Permissions.DEALS_READ,
    Permissions.DEALS_WRITE,
    Permissions.PRODUCTS_READ,
    Permissions.TASKS_MANAGE,
    Permissions.METRICS_READ,
    Permissions.EXPENSES_READ,
  ),
  [Roles.METHODOLOGIST]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.ARTIFACTS_READ,
    Permissions.ARTIFACTS_REVIEW,
    Permissions.METRICS_READ,
  ),
  [Roles.BACK_OFFICE]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.CONTACTS_READ,
    Permissions.PARTNERS_READ,
    Permissions.DEALS_READ,
    Permissions.TASKS_MANAGE,
    Permissions.EXPENSES_READ,
    Permissions.EXPENSES_WRITE,
    Permissions.AUDIT_READ,
    Permissions.EXPORTS_BULK,
  ),
  [Roles.SMM_MANAGER]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.METRICS_READ,
    Permissions.EXPENSES_READ,
  ),
  [Roles.PRODUCT_MANAGER]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.ARTIFACTS_READ,
    Permissions.PRODUCTS_READ,
    Permissions.PRODUCTS_WRITE,
    Permissions.DEALS_READ,
    Permissions.METRICS_READ,
    Permissions.EXPENSES_READ,
  ),
  [Roles.DATA_STEWARD]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.PEOPLE_WRITE,
    Permissions.CONTACTS_READ,
    Permissions.CONTACTS_WRITE,
    Permissions.ARTIFACTS_READ,
    Permissions.IMPORTS_RUN,
    Permissions.IMPORTS_READ_RAW,
    Permissions.DUPLICATES_RESOLVE,
    Permissions.AUDIT_READ,
    Permissions.EXPORTS_BULK,
  ),
  [Roles.AUDITOR]: permissions(
    Permissions.PEOPLE_READ,
    Permissions.CONTACTS_READ,
    Permissions.ARTIFACTS_READ,
    Permissions.AUDIT_READ,
  ),
});

export function permissionsForRoles(roles: readonly Role[]): readonly Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }
  return Object.freeze(ALL_PERMISSIONS.filter((permission) => granted.has(permission)));
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission) ?? false);
}

export function hasEveryPermission(
  roles: readonly Role[],
  required: readonly Permission[],
): boolean {
  return required.every((permission) => hasPermission(roles, permission));
}

export function hasAnyPermission(roles: readonly Role[], required: readonly Permission[]): boolean {
  return required.some((permission) => hasPermission(roles, permission));
}
