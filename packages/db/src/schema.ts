import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export type JsonObject = Record<string, unknown>;

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
const editable = () => ({
  version: integer('version').notNull().default(1),
  archivedAt: timestamptz('archived_at'),
  ...timestamps(),
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Authentication and authorization -------------------------------------------------

export const appUserStatusEnum = pgEnum('app_user_status', ['ACTIVE', 'DISABLED']);
export const lifecycleDataStateEnum = pgEnum('lifecycle_data_state', [
  'LEGACY_INCOMPLETE',
  'COMPLETE',
]);
export const activationStateEnum = pgEnum('activation_state', [
  'UNKNOWN_LEGACY',
  'NOT_ACTIVATED',
  'ACTIVATED',
]);
export const activityStatusEnum = pgEnum('activity_status', [
  'UNKNOWN',
  'ACTIVE',
  'MEDIUM',
  'INACTIVE',
]);
export const aliasTypeEnum = pgEnum('person_alias_type', [
  'FORMER_NAME',
  'SHORT_NAME',
  'TRANSLITERATION',
  'MISSPELLING',
  'SOURCE_VARIANT',
  'OTHER',
]);
export const contactPointTypeEnum = pgEnum('contact_point_type', [
  'EMAIL',
  'PHONE',
  'TELEGRAM',
  'MAX',
  'OTHER',
]);
export const dataOriginEnum = pgEnum('data_origin', ['LEGACY_IMPORT', 'LIVE']);
export const consentStatusEnum = pgEnum('consent_status', [
  'GRANTED',
  'DENIED',
  'UNKNOWN',
  'WITHDRAWN',
]);
export const participationDecisionEnum = pgEnum('participation_decision', [
  'UNKNOWN',
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'WAITLISTED',
]);
export const attendanceStatusEnum = pgEnum('attendance_status', [
  'UNKNOWN',
  'ATTENDED',
  'NO_SHOW',
  'PARTIAL',
]);
export const membershipRoleEnum = pgEnum('membership_role', ['LEAD', 'MEMBER', 'MENTOR', 'OTHER']);
export const artifactStatusEnum = pgEnum('artifact_status', ['ACTIVE', 'ARCHIVED', 'VOIDED']);
export const artifactVersionStatusEnum = pgEnum('artifact_version_status', [
  'DRAFT',
  'SUBMITTED',
  'VOIDED',
]);
export const artifactContentTypeEnum = pgEnum('artifact_content_type', [
  'FILE',
  'EXTERNAL_URL',
  'TEXT',
  'MIXED',
]);
export const contributionRoleEnum = pgEnum('artifact_contribution_role', ['AUTHOR', 'CONTRIBUTOR']);
export const artifactAssetTypeEnum = pgEnum('artifact_asset_type', ['FILE', 'EXTERNAL_URL']);
export const fileObjectStatusEnum = pgEnum('file_object_status', [
  'PENDING',
  'SCANNING',
  'AVAILABLE',
  'REJECTED',
  'QUARANTINED',
]);
export const reviewStatusEnum = pgEnum('artifact_review_status', [
  'PENDING',
  'UNDER_REVIEW',
  'FINAL',
  'VOIDED',
]);
export const reviewDecisionEnum = pgEnum('artifact_review_decision', [
  'NEEDS_REVISION',
  'ACCEPTED',
  'REJECTED',
]);
export const lifecycleDimensionEnum = pgEnum('lifecycle_dimension', ['ACTIVATION', 'ACTIVITY']);
export const lifecycleTransitionReasonEnum = pgEnum('lifecycle_transition_reason', [
  'ARTIFACT_BECAME_COUNTABLE',
  'ARTIFACT_VOIDED',
  'TIME_WINDOW_ELAPSED',
  'RULE_SET_CHANGED',
  'LEGACY_STATE_RESOLVED',
  'RECONCILIATION',
]);
export const interactionChannelEnum = pgEnum('interaction_channel', [
  'EMAIL',
  'PHONE',
  'TELEGRAM',
  'MAX',
  'IN_PERSON',
  'OTHER',
]);
export const interactionDirectionEnum = pgEnum('interaction_direction', [
  'INBOUND',
  'OUTBOUND',
  'INTERNAL',
]);
export const taskStatusEnum = pgEnum('task_status', ['OPEN', 'DONE', 'CANCELLED']);
export const importRunModeEnum = pgEnum('import_run_mode', ['DRY_RUN', 'COMMIT', 'REVERT']);
export const importRunStatusEnum = pgEnum('import_run_status', [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export const sourceRecordStatusEnum = pgEnum('source_record_status', [
  'PENDING',
  'PARSED',
  'QUARANTINED',
  'IGNORED',
]);
export const observationResolutionStatusEnum = pgEnum('observation_resolution_status', [
  'PENDING',
  'RESOLVED',
  'REVIEW_REQUIRED',
  'REJECTED',
]);
export const duplicateCandidateStatusEnum = pgEnum('duplicate_candidate_status', [
  'OPEN',
  'MERGED',
  'NOT_DUPLICATE',
  'DISMISSED',
]);
export const mergeOperationStatusEnum = pgEnum('merge_operation_status', [
  'APPLIED',
  'REVERTED',
  'PARTIALLY_REVERTED',
]);
export const mergeItemActionEnum = pgEnum('merge_item_action', [
  'REASSIGNED',
  'CANONICAL_VALUE_SELECTED',
  'ARCHIVED',
  'RESTORED',
]);
export const queueItemStatusEnum = pgEnum('queue_item_status', ['OPEN', 'RESOLVED', 'DISMISSED']);
export const outboxStatusEnum = pgEnum('outbox_status', [
  'PENDING',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
]);
export const partnerKindEnum = pgEnum('partner_kind', [
  'COMMERCIAL',
  'GRANT_FUND',
  'UNIVERSITY',
  'GOVERNMENT',
  'MEDIA',
  'OTHER',
]);
export const partnerStatusEnum = pgEnum('partner_status', [
  'PROSPECT',
  'DEVELOPING',
  'ACTIVE',
  'PAUSED',
  'CLOSED',
]);
export const partnerAgreementTypeEnum = pgEnum('partner_agreement_type', [
  'GRANT',
  'COMMERCIAL',
  'PARTNERSHIP',
  'INFO_PARTNERSHIP',
]);
export const partnerAgreementStatusEnum = pgEnum('partner_agreement_status', [
  'DRAFT',
  'NEGOTIATION',
  'ACTIVE',
  'COMPLETED',
  'TERMINATED',
]);
export const productStatusEnum = pgEnum('product_status', [
  'IDEA',
  'PACKAGING',
  'ON_SALE',
  'CLOSED',
]);
export const dealTypeEnum = pgEnum('deal_type', ['GRANT', 'COMMERCIAL']);
export const dealStatusEnum = pgEnum('deal_status', ['LEAD', 'NEGOTIATION', 'WON', 'LOST']);

export const appUsers = pgTable(
  'app_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oidcSubject: text('oidc_subject').notNull(),
    email: text('email').notNull(),
    normalizedEmail: text('normalized_email').notNull(),
    displayName: text('display_name').notNull(),
    status: appUserStatusEnum('status').notNull().default('ACTIVE'),
    lastLoginAt: timestamptz('last_login_at'),
    ...editable(),
  },
  (table) => [
    uniqueIndex('app_users_oidc_subject_uidx').on(table.oidcSubject),
    uniqueIndex('app_users_normalized_email_uidx')
      .on(table.normalizedEmail)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(true),
    ...editable(),
  },
  (table) => [uniqueIndex('roles_code_uidx').on(table.code)],
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description'),
    ...timestamps(),
  },
  (table) => [uniqueIndex('permissions_code_uidx').on(table.code)],
);

export const appUserRoles = pgTable(
  'app_user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedByUserId: uuid('assigned_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (table) => [uniqueIndex('app_user_roles_user_role_uidx').on(table.userId, table.roleId)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('role_permissions_role_permission_uidx').on(table.roleId, table.permissionId),
  ],
);

// Organization-level rules and settings -------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    shortName: text('short_name'),
    kind: text('kind'),
    externalId: text('external_id'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('organizations_normalized_name_idx').on(table.normalizedName),
    uniqueIndex('organizations_external_id_uidx')
      .on(table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

export const lifecycleRuleSets = pgTable(
  'lifecycle_rule_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ruleVersion: integer('rule_version').notNull(),
    activeWindowHours: integer('active_window_hours').notNull().default(252),
    inactiveAfterHours: integer('inactive_after_hours').notNull().default(504),
    effectiveFrom: timestamptz('effective_from').notNull(),
    effectiveTo: timestamptz('effective_to'),
    createdByUserId: uuid('created_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    changeComment: text('change_comment').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('lifecycle_rule_sets_org_version_uidx').on(table.organizationId, table.ruleVersion),
    index('lifecycle_rule_sets_effective_idx').on(table.organizationId, table.effectiveFrom),
    check(
      'lifecycle_rule_sets_windows_check',
      sql`${table.activeWindowHours} > 0 and ${table.inactiveAfterHours} > ${table.activeWindowHours}`,
    ),
    check(
      'lifecycle_rule_sets_period_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const organizationSettings = pgTable(
  'organization_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    artifactBaselineAt: timestamptz('artifact_baseline_at'),
    timezone: text('timezone').notNull().default('Asia/Novosibirsk'),
    currentLifecycleRuleSetId: uuid('current_lifecycle_rule_set_id').references(
      () => lifecycleRuleSets.id,
      {
        onDelete: 'restrict',
      },
    ),
    updatedByUserId: uuid('updated_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    changeReason: text('change_reason').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (table) => [uniqueIndex('organization_settings_organization_uidx').on(table.organizationId)],
);

// Participant registry -------------------------------------------------------------

export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    canonicalFullName: text('canonical_full_name').notNull(),
    normalizedFullName: text('normalized_full_name').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    lifecycleDataState: lifecycleDataStateEnum('lifecycle_data_state')
      .notNull()
      .default('LEGACY_INCOMPLETE'),
    activationState: activationStateEnum('activation_state').notNull().default('UNKNOWN_LEGACY'),
    activityStatus: activityStatusEnum('activity_status').notNull().default('UNKNOWN'),
    activatedAt: timestamptz('activated_at'),
    activationRecordedAt: timestamptz('activation_recorded_at'),
    lastArtifactAt: timestamptz('last_artifact_at'),
    nextStatusTransitionAt: timestamptz('next_status_transition_at'),
    appliedLifecycleRuleSetId: uuid('applied_lifecycle_rule_set_id').references(
      () => lifecycleRuleSets.id,
      {
        onDelete: 'set null',
      },
    ),
    mergedIntoPersonId: uuid('merged_into_person_id').references((): AnyPgColumn => persons.id, {
      onDelete: 'restrict',
    }),
    ...editable(),
  },
  (table) => [
    index('persons_organization_idx').on(table.organizationId),
    index('persons_normalized_full_name_idx').on(table.normalizedFullName),
    index('persons_owner_idx').on(table.ownerUserId),
    index('persons_lifecycle_queue_idx').on(table.activityStatus, table.nextStatusTransitionAt),
    index('persons_merged_into_idx').on(table.mergedIntoPersonId),
    check(
      'persons_no_self_merge_check',
      sql`${table.mergedIntoPersonId} is null or ${table.mergedIntoPersonId} <> ${table.id}`,
    ),
  ],
);

export const personAliases = pgTable(
  'person_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    rawValue: text('raw_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    aliasType: aliasTypeEnum('alias_type').notNull().default('SOURCE_VARIANT'),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    isPreferred: boolean('is_preferred').notNull().default(false),
    validFrom: timestamptz('valid_from'),
    validTo: timestamptz('valid_to'),
    ...editable(),
  },
  (table) => [
    index('person_aliases_normalized_idx').on(table.normalizedValue),
    uniqueIndex('person_aliases_fact_uidx')
      .on(table.personId, table.normalizedValue, table.aliasType)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('person_aliases_preferred_uidx')
      .on(table.personId)
      .where(sql`${table.isPreferred} and ${table.archivedAt} is null`),
    check(
      'person_aliases_period_check',
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const contactPoints = pgTable(
  'contact_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    type: contactPointTypeEnum('type').notNull(),
    rawValue: text('raw_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    messengerStableId: text('messenger_stable_id'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    validFrom: timestamptz('valid_from'),
    validTo: timestamptz('valid_to'),
    ...editable(),
  },
  (table) => [
    index('contact_points_person_idx').on(table.personId),
    index('contact_points_normalized_idx').on(table.type, table.normalizedValue),
    index('contact_points_messenger_id_idx').on(table.type, table.messengerStableId),
    uniqueIndex('contact_points_primary_type_uidx')
      .on(table.personId, table.type)
      .where(sql`${table.isPrimary} and ${table.archivedAt} is null`),
    check(
      'contact_points_period_check',
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const affiliations = pgTable(
  'affiliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    roleTitle: text('role_title'),
    faculty: text('faculty'),
    department: text('department'),
    isPrimary: boolean('is_primary').notNull().default(false),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    validFrom: timestamptz('valid_from'),
    validTo: timestamptz('valid_to'),
    ...editable(),
  },
  (table) => [
    index('affiliations_person_idx').on(table.personId),
    index('affiliations_organization_idx').on(table.organizationId),
    uniqueIndex('affiliations_primary_uidx')
      .on(table.personId)
      .where(sql`${table.isPrimary} and ${table.archivedAt} is null`),
    check(
      'affiliations_period_check',
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    color: text('color'),
    ...editable(),
  },
  (table) => [
    uniqueIndex('tags_org_normalized_name_uidx')
      .on(table.organizationId, table.normalizedName)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const personTags = pgTable(
  'person_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    assignedByUserId: uuid('assigned_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (table) => [uniqueIndex('person_tags_person_tag_uidx').on(table.personId, table.tagId)],
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    status: consentStatusEnum('status').notNull().default('UNKNOWN'),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    evidence: jsonb('evidence').$type<JsonObject>(),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    recordedByUserId: uuid('recorded_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (table) => [
    index('consent_records_person_purpose_idx').on(table.personId, table.purpose, table.recordedAt),
  ],
);

// Minimal program, event, project, and team graph ----------------------------------

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('programs_organization_idx').on(table.organizationId),
    index('programs_normalized_name_idx').on(table.normalizedName),
    check(
      'programs_period_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const cohorts = pgTable(
  'cohorts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    status: text('status').notNull().default('ACTIVE'),
    ...editable(),
  },
  (table) => [
    uniqueIndex('cohorts_program_name_uidx')
      .on(table.programId, table.name)
      .where(sql`${table.archivedAt} is null`),
    check(
      'cohorts_period_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    status: text('status').notNull().default('PLANNED'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('events_organization_idx').on(table.organizationId),
    index('events_program_idx').on(table.programId),
    index('events_normalized_name_idx').on(table.normalizedName),
    uniqueIndex('events_organization_normalized_name_uidx')
      .on(table.organizationId, table.normalizedName)
      .where(sql`${table.archivedAt} is null`),
    check(
      'events_status_check',
      sql`${table.status} in ('UNKNOWN', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')`,
    ),
    check(
      'events_period_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const eventParticipations = pgTable(
  'event_participations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    registeredAt: timestamptz('registered_at'),
    decision: participationDecisionEnum('decision').notNull().default('UNKNOWN'),
    decisionAt: timestamptz('decision_at'),
    attendance: attendanceStatusEnum('attendance').notNull().default('UNKNOWN'),
    attendedAt: timestamptz('attended_at'),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    ...editable(),
  },
  (table) => [
    uniqueIndex('event_participations_person_event_uidx')
      .on(table.personId, table.eventId)
      .where(sql`${table.archivedAt} is null`),
    index('event_participations_event_idx').on(table.eventId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('ACTIVE'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('projects_organization_idx').on(table.organizationId),
    index('projects_normalized_name_idx').on(table.normalizedName),
    check(
      'projects_period_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const projectAliases = pgTable(
  'project_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    rawValue: text('raw_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    ...editable(),
  },
  (table) => [
    uniqueIndex('project_aliases_project_value_uidx')
      .on(table.projectId, table.normalizedValue)
      .where(sql`${table.archivedAt} is null`),
    index('project_aliases_normalized_idx').on(table.normalizedValue),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    ...editable(),
  },
  (table) => [index('teams_normalized_name_idx').on(table.normalizedName)],
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('MEMBER'),
    roleLabel: text('role_label'),
    validFrom: timestamptz('valid_from'),
    validTo: timestamptz('valid_to'),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    ...editable(),
  },
  (table) => [
    uniqueIndex('team_memberships_active_fact_uidx')
      .on(table.teamId, table.personId, table.role)
      .where(sql`${table.validTo} is null and ${table.archivedAt} is null`),
    index('team_memberships_person_idx').on(table.personId),
    check(
      'team_memberships_period_check',
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const projectTeamLinks = pgTable(
  'project_team_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    validFrom: timestamptz('valid_from'),
    validTo: timestamptz('valid_to'),
    ...editable(),
  },
  (table) => [
    uniqueIndex('project_team_links_active_fact_uidx')
      .on(table.projectId, table.teamId)
      .where(sql`${table.validTo} is null and ${table.archivedAt} is null`),
    check(
      'project_team_links_period_check',
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

// Immutable artifact versions and reviews -----------------------------------------

export const fileObjects = pgTable(
  'file_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    declaredMimeType: text('declared_mime_type'),
    detectedMimeType: text('detected_mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    status: fileObjectStatusEnum('status').notNull().default('PENDING'),
    scanResult: jsonb('scan_result').$type<JsonObject>(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    availableAt: timestamptz('available_at'),
    rejectedAt: timestamptz('rejected_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('file_objects_bucket_key_uidx').on(table.bucket, table.objectKey),
    index('file_objects_sha256_idx').on(table.sha256),
    index('file_objects_status_idx').on(table.status, table.createdAt),
    check('file_objects_size_check', sql`${table.sizeBytes} >= 0`),
    check(
      'file_objects_sha256_check',
      sql`${table.sha256} is null or ${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const artifactTypes = pgTable(
  'artifact_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    ...editable(),
  },
  (table) => [uniqueIndex('artifact_types_code_uidx').on(table.code)],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => artifactTypes.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    status: artifactStatusEnum('status').notNull().default('ACTIVE'),
    createdByUserId: uuid('created_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    voidedAt: timestamptz('voided_at'),
    voidReason: text('void_reason'),
    ...editable(),
  },
  (table) => [
    index('artifacts_organization_idx').on(table.organizationId),
    index('artifacts_project_idx').on(table.projectId),
    index('artifacts_type_idx').on(table.typeId),
  ],
);

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    status: artifactVersionStatusEnum('status').notNull().default('DRAFT'),
    contentType: artifactContentTypeEnum('content_type').notNull(),
    textContent: text('text_content'),
    submittedAt: timestamptz('submitted_at'),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    contentFingerprint: text('content_fingerprint'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    qualifiesForActivation: boolean('qualifies_for_activation').notNull().default(false),
    qualifiesForActivity: boolean('qualifies_for_activity').notNull().default(false),
    countabilityReasons: jsonb('countability_reasons').$type<JsonObject>().notNull().default({}),
    dataOrigin: dataOriginEnum('data_origin').notNull(),
    backdateReason: text('backdate_reason'),
    voidedAt: timestamptz('voided_at'),
    voidedByUserId: uuid('voided_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    voidReason: text('void_reason'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('artifact_versions_number_uidx').on(table.artifactId, table.versionNumber),
    uniqueIndex('artifact_versions_active_fingerprint_uidx')
      .on(table.artifactId, table.contentFingerprint)
      .where(sql`${table.contentFingerprint} is not null and ${table.status} <> 'VOIDED'`),
    index('artifact_versions_countable_idx').on(table.qualifiesForActivity, table.submittedAt),
    check('artifact_versions_number_check', sql`${table.versionNumber} > 0`),
    check(
      'artifact_versions_fingerprint_check',
      sql`${table.contentFingerprint} is null or ${table.contentFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'artifact_versions_activity_implies_activation_check',
      sql`not ${table.qualifiesForActivity} or ${table.qualifiesForActivation}`,
    ),
    check(
      'artifact_versions_activity_date_check',
      sql`not ${table.qualifiesForActivity} or ${table.submittedAt} is not null`,
    ),
  ],
);

export const artifactVersionContributors = pgTable(
  'artifact_version_contributors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactVersionId: uuid('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    contributionRole: contributionRoleEnum('contribution_role').notNull(),
    contributionDescription: text('contribution_description'),
    authorshipSource: text('authorship_source').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('artifact_version_contributors_fact_uidx').on(
      table.artifactVersionId,
      table.personId,
    ),
    index('artifact_version_contributors_person_idx').on(table.personId, table.contributionRole),
  ],
);

export const artifactAssets = pgTable(
  'artifact_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactVersionId: uuid('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    assetType: artifactAssetTypeEnum('asset_type').notNull(),
    fileObjectId: uuid('file_object_id').references(() => fileObjects.id, { onDelete: 'restrict' }),
    externalUrl: text('external_url'),
    displayOrder: integer('display_order').notNull().default(0),
    caption: text('caption'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('artifact_assets_version_order_uidx').on(
      table.artifactVersionId,
      table.displayOrder,
    ),
    uniqueIndex('artifact_assets_version_file_uidx')
      .on(table.artifactVersionId, table.fileObjectId)
      .where(sql`${table.fileObjectId} is not null`),
    index('artifact_assets_file_idx').on(table.fileObjectId),
    check(
      'artifact_assets_exactly_one_content_check',
      sql`num_nonnulls(${table.fileObjectId}, ${table.externalUrl}) = 1`,
    ),
    check(
      'artifact_assets_type_matches_content_check',
      sql`(${table.assetType} = 'FILE' and ${table.fileObjectId} is not null) or (${table.assetType} = 'EXTERNAL_URL' and ${table.externalUrl} is not null)`,
    ),
    check('artifact_assets_order_check', sql`${table.displayOrder} >= 0`),
  ],
);

export const rubricVersions = pgTable(
  'rubric_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactTypeId: uuid('artifact_type_id').references(() => artifactTypes.id, {
      onDelete: 'restrict',
    }),
    rubricCode: text('rubric_code').notNull(),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    anchors: jsonb('anchors').$type<JsonObject>().notNull(),
    effectiveFrom: timestamptz('effective_from').notNull(),
    effectiveTo: timestamptz('effective_to'),
    publishedByUserId: uuid('published_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('rubric_versions_code_version_uidx').on(table.rubricCode, table.versionNumber),
    check('rubric_versions_number_check', sql`${table.versionNumber} > 0`),
    check(
      'rubric_versions_period_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const artifactReviews = pgTable(
  'artifact_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactVersionId: uuid('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'restrict' }),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    rubricVersionId: uuid('rubric_version_id')
      .notNull()
      .references(() => rubricVersions.id, { onDelete: 'restrict' }),
    score: smallint('score'),
    comment: text('comment'),
    status: reviewStatusEnum('status').notNull().default('PENDING'),
    decision: reviewDecisionEnum('decision'),
    supersedesReviewId: uuid('supersedes_review_id').references(
      (): AnyPgColumn => artifactReviews.id,
      {
        onDelete: 'restrict',
      },
    ),
    reviewedAt: timestamptz('reviewed_at'),
    voidedAt: timestamptz('voided_at'),
    voidReason: text('void_reason'),
    ...timestamps(),
  },
  (table) => [
    index('artifact_reviews_version_idx').on(table.artifactVersionId, table.createdAt),
    uniqueIndex('artifact_reviews_supersedes_uidx')
      .on(table.supersedesReviewId)
      .where(sql`${table.supersedesReviewId} is not null`),
    check(
      'artifact_reviews_score_check',
      sql`${table.score} is null or (${table.score} between 1 and 10)`,
    ),
    check(
      'artifact_reviews_final_fields_check',
      sql`${table.status} <> 'FINAL' or (${table.score} is not null and ${table.decision} is not null and ${table.reviewedAt} is not null)`,
    ),
    check(
      'artifact_reviews_no_self_supersede_check',
      sql`${table.supersedesReviewId} is null or ${table.supersedesReviewId} <> ${table.id}`,
    ),
  ],
);

export const artifactReviewSelections = pgTable(
  'artifact_review_selections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactVersionId: uuid('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    currentFinalReviewId: uuid('current_final_review_id')
      .notNull()
      .references(() => artifactReviews.id, { onDelete: 'restrict' }),
    selectedByUserId: uuid('selected_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('artifact_review_selections_version_uidx').on(table.artifactVersionId),
    uniqueIndex('artifact_review_selections_review_uidx').on(table.currentFinalReviewId),
  ],
);

export const lifecycleStatusHistory = pgTable(
  'lifecycle_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    dimension: lifecycleDimensionEnum('dimension').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    reason: lifecycleTransitionReasonEnum('reason').notNull(),
    lifecycleRuleSetId: uuid('lifecycle_rule_set_id').references(() => lifecycleRuleSets.id, {
      onDelete: 'restrict',
    }),
    artifactVersionId: uuid('artifact_version_id').references(() => artifactVersions.id, {
      onDelete: 'restrict',
    }),
    effectiveAt: timestamptz('effective_at').notNull(),
    detectedAt: timestamptz('detected_at').notNull().defaultNow(),
    metadata: jsonb('metadata').$type<JsonObject>().notNull().default({}),
    ...timestamps(),
  },
  (table) => [
    index('lifecycle_status_history_person_idx').on(table.personId, table.effectiveAt),
    index('lifecycle_status_history_detection_idx').on(table.detectedAt),
  ],
);

// Operational CRM -----------------------------------------------------------------

export const interactions = pgTable(
  'interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    channel: interactionChannelEnum('channel').notNull(),
    direction: interactionDirectionEnum('direction').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    outcome: text('outcome'),
    comment: text('comment'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    ...editable(),
  },
  (table) => [
    index('interactions_person_timeline_idx').on(table.personId, table.occurredAt),
    index('interactions_project_idx').on(table.projectId),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id').references(() => persons.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('OPEN'),
    assigneeUserId: uuid('assignee_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    dueAt: timestamptz('due_at'),
    completedAt: timestamptz('completed_at'),
    result: text('result'),
    isNextStep: boolean('is_next_step').notNull().default(false),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'set null',
    }),
    ...editable(),
  },
  (table) => [
    index('tasks_assignee_queue_idx').on(table.assigneeUserId, table.status, table.dueAt),
    index('tasks_person_idx').on(table.personId, table.status),
    uniqueIndex('tasks_one_open_next_step_per_person_uidx')
      .on(table.personId)
      .where(
        sql`${table.personId} is not null and ${table.isNextStep} and ${table.status} = 'OPEN' and ${table.archivedAt} is null`,
      ),
    check(
      'tasks_subject_check',
      sql`${table.personId} is not null or ${table.projectId} is not null`,
    ),
    check(
      'tasks_completion_check',
      sql`${table.status} <> 'DONE' or ${table.completedAt} is not null`,
    ),
    check(
      'tasks_no_self_parent_check',
      sql`${table.parentTaskId} is null or ${table.parentTaskId} <> ${table.id}`,
    ),
  ],
);

// FPF: partner base, product base, and revenue pipeline ----------------------------

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    kind: partnerKindEnum('kind').notNull().default('OTHER'),
    status: partnerStatusEnum('status').notNull().default('PROSPECT'),
    inn: text('inn'),
    website: text('website'),
    notes: text('notes'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('partners_organization_idx').on(table.organizationId),
    uniqueIndex('partners_org_normalized_name_uidx')
      .on(table.organizationId, table.normalizedName)
      .where(sql`${table.archivedAt} is null`),
    index('partners_status_idx').on(table.status),
  ],
);

export const partnerContacts = pgTable(
  'partner_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    position: text('position'),
    isDecisionMaker: boolean('is_decision_maker').notNull().default(false),
    email: text('email'),
    phone: text('phone'),
    telegram: text('telegram'),
    notes: text('notes'),
    ...editable(),
  },
  (table) => [index('partner_contacts_partner_idx').on(table.partnerId)],
);

export const partnerAgreements = pgTable(
  'partner_agreements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    agreementType: partnerAgreementTypeEnum('agreement_type').notNull(),
    status: partnerAgreementStatusEnum('status').notNull().default('DRAFT'),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    signedAt: timestamptz('signed_at'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    comment: text('comment'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('partner_agreements_partner_idx').on(table.partnerId, table.status),
    check('partner_agreements_amount_check', sql`${table.amount} is null or ${table.amount} >= 0`),
    check(
      'partner_agreements_period_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const partnerInteractions = pgTable(
  'partner_interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => partnerContacts.id, { onDelete: 'set null' }),
    channel: interactionChannelEnum('channel').notNull(),
    direction: interactionDirectionEnum('direction').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    outcome: text('outcome'),
    comment: text('comment'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    ...editable(),
  },
  (table) => [index('partner_interactions_timeline_idx').on(table.partnerId, table.occurredAt)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    description: text('description'),
    deliveryModel: text('delivery_model'),
    documentationUrl: text('documentation_url'),
    status: productStatusEnum('status').notNull().default('IDEA'),
    price: numeric('price', { precision: 14, scale: 2 }),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    closedAt: timestamptz('closed_at'),
    closeReason: text('close_reason'),
    ...editable(),
  },
  (table) => [
    index('products_organization_idx').on(table.organizationId),
    uniqueIndex('products_org_normalized_name_uidx')
      .on(table.organizationId, table.normalizedName)
      .where(sql`${table.archivedAt} is null`),
    check('products_price_check', sql`${table.price} is null or ${table.price} >= 0`),
    check(
      'products_closed_fields_check',
      sql`${table.status} <> 'CLOSED' or (${table.closedAt} is not null and ${table.closeReason} is not null)`,
    ),
  ],
);

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    agreementId: uuid('agreement_id').references(() => partnerAgreements.id, {
      onDelete: 'set null',
    }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    dealType: dealTypeEnum('deal_type').notNull(),
    status: dealStatusEnum('status').notNull().default('LEAD'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('RUB'),
    expectedCloseAt: timestamptz('expected_close_at'),
    closedAt: timestamptz('closed_at'),
    comment: text('comment'),
    ownerUserId: uuid('owner_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    ...editable(),
  },
  (table) => [
    index('deals_organization_idx').on(table.organizationId),
    index('deals_partner_idx').on(table.partnerId),
    index('deals_pipeline_idx').on(table.status, table.closedAt),
    check('deals_amount_check', sql`${table.amount} >= 0`),
    check(
      'deals_closed_fields_check',
      sql`${table.status} in ('LEAD', 'NEGOTIATION') or ${table.closedAt} is not null`,
    ),
  ],
);

// Append-only audit, reliable events, and request idempotency ----------------------

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
    actorSubject: text('actor_subject'),
    requestId: text('request_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before').$type<JsonObject>(),
    after: jsonb('after').$type<JsonObject>(),
    reason: text('reason'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId, table.occurredAt),
    index('audit_log_actor_idx').on(table.actorUserId, table.occurredAt),
    index('audit_log_request_idx').on(table.requestId),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    availableAt: timestamptz('available_at').notNull().defaultNow(),
    lockedAt: timestamptz('locked_at'),
    lockedBy: text('locked_by'),
    publishedAt: timestamptz('published_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    ...timestamps(),
  },
  (table) => [
    index('outbox_events_delivery_idx').on(table.status, table.availableAt),
    index('outbox_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
    check('outbox_events_attempts_check', sql`${table.attempts} >= 0`),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subject: text('subject').notNull(),
    route: text('route').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    responseStatus: integer('response_status'),
    responseHeaders: jsonb('response_headers').$type<JsonObject>(),
    responseBody: jsonb('response_body').$type<unknown>(),
    completedAt: timestamptz('completed_at'),
    expiresAt: timestamptz('expires_at').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idempotency_records_scope_key_uidx').on(
      table.subject,
      table.route,
      table.idempotencyKey,
    ),
    index('idempotency_records_expiry_idx').on(table.expiresAt),
    check('idempotency_records_payload_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'idempotency_records_response_status_check',
      sql`${table.responseStatus} is null or (${table.responseStatus} between 100 and 599)`,
    ),
  ],
);

// Reproducible import staging and field-level provenance ---------------------------

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    sourceFileObjectId: uuid('source_file_object_id')
      .notNull()
      .references(() => fileObjects.id, { onDelete: 'restrict' }),
    originalFilename: text('original_filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    importerVersion: text('importer_version').notNull(),
    baselineSnapshotAt: timestamptz('baseline_snapshot_at'),
    timezoneSnapshot: text('timezone_snapshot').notNull(),
    lifecycleRuleSetSnapshotId: uuid('lifecycle_rule_set_snapshot_id').references(
      () => lifecycleRuleSets.id,
      {
        onDelete: 'restrict',
      },
    ),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('import_batches_org_sha256_uidx').on(table.organizationId, table.sha256),
    uniqueIndex('import_batches_source_file_uidx').on(table.sourceFileObjectId),
    check('import_batches_size_check', sql`${table.sizeBytes} >= 0`),
    check('import_batches_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const importRuns = pgTable(
  'import_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    mode: importRunModeEnum('mode').notNull(),
    parserVersion: text('parser_version').notNull(),
    rulesVersion: text('rules_version').notNull(),
    status: importRunStatusEnum('status').notNull().default('QUEUED'),
    basedOnRunId: uuid('based_on_run_id').references((): AnyPgColumn => importRuns.id, {
      onDelete: 'restrict',
    }),
    statistics: jsonb('statistics').$type<JsonObject>().notNull().default({}),
    errors: jsonb('errors').$type<unknown[]>().notNull().default([]),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    initiatedByUserId: uuid('initiated_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    index('import_runs_batch_idx').on(table.batchId, table.createdAt),
    index('import_runs_status_idx').on(table.status, table.createdAt),
    check(
      'import_runs_period_check',
      sql`${table.finishedAt} is null or ${table.startedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    check(
      'import_runs_no_self_parent_check',
      sql`${table.basedOnRunId} is null or ${table.basedOnRunId} <> ${table.id}`,
    ),
  ],
);

export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    sourceFilename: text('source_filename').notNull(),
    sheetName: text('sheet_name').notNull(),
    rowNumber: integer('row_number').notNull(),
    rawJson: jsonb('raw_json').$type<JsonObject>().notNull(),
    rowHash: text('row_hash').notNull(),
    status: sourceRecordStatusEnum('status').notNull().default('PENDING'),
    errorCode: text('error_code'),
    errorReason: text('error_reason'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('source_records_sheet_row_uidx').on(
      table.batchId,
      table.sheetName,
      table.rowNumber,
    ),
    index('source_records_status_idx').on(table.batchId, table.status),
    index('source_records_row_hash_idx').on(table.rowHash),
    check('source_records_row_number_check', sql`${table.rowNumber} > 0`),
    check('source_records_row_hash_check', sql`${table.rowHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const personObservations = pgTable(
  'person_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id')
      .notNull()
      .references(() => sourceRecords.id, { onDelete: 'restrict' }),
    importRunId: uuid('import_run_id')
      .notNull()
      .references(() => importRuns.id, { onDelete: 'restrict' }),
    slotKey: text('slot_key').notNull(),
    parserVersion: text('parser_version').notNull(),
    sourceNamespace: text('source_namespace'),
    externalId: text('external_id'),
    observationFingerprint: text('observation_fingerprint').notNull(),
    rawValues: jsonb('raw_values').$type<JsonObject>().notNull(),
    normalizedValues: jsonb('normalized_values').$type<JsonObject>().notNull(),
    resolutionStatus: observationResolutionStatusEnum('resolution_status')
      .notNull()
      .default('PENDING'),
    resolvedPersonId: uuid('resolved_person_id').references(() => persons.id, {
      onDelete: 'restrict',
    }),
    resolutionReason: text('resolution_reason'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamptz('resolved_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('person_observations_record_slot_parser_uidx').on(
      table.sourceRecordId,
      table.slotKey,
      table.parserVersion,
    ),
    index('person_observations_resolution_queue_idx').on(table.resolutionStatus, table.createdAt),
    index('person_observations_fingerprint_idx').on(table.observationFingerprint),
    check(
      'person_observations_fingerprint_check',
      sql`${table.observationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'person_observations_external_identity_check',
      sql`(${table.sourceNamespace} is null) = (${table.externalId} is null)`,
    ),
    check(
      'person_observations_resolved_person_check',
      sql`${table.resolutionStatus} <> 'RESOLVED' or ${table.resolvedPersonId} is not null`,
    ),
  ],
);

export const externalIdentities = pgTable(
  'external_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    sourceNamespace: text('source_namespace').notNull(),
    externalId: text('external_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    firstSeenSourceRecordId: uuid('first_seen_source_record_id').references(
      () => sourceRecords.id,
      {
        onDelete: 'restrict',
      },
    ),
    ...editable(),
  },
  (table) => [
    uniqueIndex('external_identities_namespace_id_uidx')
      .on(table.organizationId, table.sourceNamespace, table.externalId)
      .where(sql`${table.archivedAt} is null`),
    index('external_identities_person_idx').on(table.personId),
  ],
);

export const sourceEntityLinks = pgTable(
  'source_entity_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id')
      .notNull()
      .references(() => sourceRecords.id, { onDelete: 'restrict' }),
    importRunId: uuid('import_run_id').references(() => importRuns.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    relation: text('relation').notNull(),
    factFingerprint: text('fact_fingerprint'),
    createdEntity: boolean('created_entity').notNull().default(false),
    detachedAt: timestamptz('detached_at'),
    detachedByRunId: uuid('detached_by_run_id').references(() => importRuns.id, {
      onDelete: 'restrict',
    }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('source_entity_links_fact_uidx').on(
      table.sourceRecordId,
      table.entityType,
      table.relation,
      table.entityId,
    ),
    index('source_entity_links_entity_idx').on(table.entityType, table.entityId),
    index('source_entity_links_run_idx').on(table.importRunId),
    check(
      'source_entity_links_fingerprint_check',
      sql`${table.factFingerprint} is null or ${table.factFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fieldObservations = pgTable(
  'field_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    fieldName: text('field_name').notNull(),
    rawValue: jsonb('raw_value').$type<unknown>(),
    normalizedValue: jsonb('normalized_value').$type<unknown>(),
    sourceRecordId: uuid('source_record_id').references(() => sourceRecords.id, {
      onDelete: 'restrict',
    }),
    auditLogId: uuid('audit_log_id').references(() => auditLog.id, { onDelete: 'restrict' }),
    observedByUserId: uuid('observed_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    isCanonical: boolean('is_canonical').notNull().default(false),
    validFrom: timestamptz('valid_from').notNull().defaultNow(),
    validTo: timestamptz('valid_to'),
    ...timestamps(),
  },
  (table) => [
    index('field_observations_entity_field_idx').on(
      table.entityType,
      table.entityId,
      table.fieldName,
    ),
    index('field_observations_source_idx').on(table.sourceRecordId),
    uniqueIndex('field_observations_current_canonical_uidx')
      .on(table.entityType, table.entityId, table.fieldName)
      .where(sql`${table.isCanonical} and ${table.validTo} is null`),
    check(
      'field_observations_provenance_check',
      sql`num_nonnulls(${table.sourceRecordId}, ${table.auditLogId}) >= 1`,
    ),
    check(
      'field_observations_period_check',
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

// Human-reviewed duplicate resolution and reversible merge ------------------------

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personAId: uuid('person_a_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    personBId: uuid('person_b_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    confidenceBasisPoints: integer('confidence_basis_points').notNull(),
    evidenceFingerprint: text('evidence_fingerprint').notNull(),
    reasons: jsonb('reasons').$type<unknown[]>().notNull().default([]),
    conflicts: jsonb('conflicts').$type<unknown[]>().notNull().default([]),
    status: duplicateCandidateStatusEnum('status').notNull().default('OPEN'),
    detectedAt: timestamptz('detected_at').notNull().defaultNow(),
    decidedAt: timestamptz('decided_at'),
    decidedByUserId: uuid('decided_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    decisionReason: text('decision_reason'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('duplicate_candidates_pair_evidence_uidx').on(
      table.personAId,
      table.personBId,
      table.evidenceFingerprint,
    ),
    index('duplicate_candidates_queue_idx').on(
      table.status,
      table.confidenceBasisPoints,
      table.detectedAt,
    ),
    check('duplicate_candidates_pair_order_check', sql`${table.personAId} < ${table.personBId}`),
    check(
      'duplicate_candidates_confidence_check',
      sql`${table.confidenceBasisPoints} between 0 and 10000`,
    ),
    check(
      'duplicate_candidates_fingerprint_check',
      sql`${table.evidenceFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const notDuplicatePairs = pgTable(
  'not_duplicate_pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personAId: uuid('person_a_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    personBId: uuid('person_b_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    evidenceFingerprint: text('evidence_fingerprint').notNull(),
    reason: text('reason').notNull(),
    decidedByUserId: uuid('decided_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    decidedAt: timestamptz('decided_at').notNull().defaultNow(),
    supersededAt: timestamptz('superseded_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('not_duplicate_pairs_pair_evidence_uidx').on(
      table.personAId,
      table.personBId,
      table.evidenceFingerprint,
    ),
    index('not_duplicate_pairs_active_idx').on(
      table.personAId,
      table.personBId,
      table.supersededAt,
    ),
    check('not_duplicate_pairs_pair_order_check', sql`${table.personAId} < ${table.personBId}`),
    check(
      'not_duplicate_pairs_fingerprint_check',
      sql`${table.evidenceFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const mergeOperations = pgTable(
  'merge_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    masterPersonId: uuid('master_person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    duplicateCandidateId: uuid('duplicate_candidate_id').references(() => duplicateCandidates.id, {
      onDelete: 'restrict',
    }),
    clusterBefore: jsonb('cluster_before').$type<unknown[]>().notNull(),
    clusterAfter: jsonb('cluster_after').$type<unknown[]>().notNull(),
    status: mergeOperationStatusEnum('status').notNull().default('APPLIED'),
    reason: text('reason').notNull(),
    operatedByUserId: uuid('operated_by_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    appliedAt: timestamptz('applied_at').notNull().defaultNow(),
    revertedAt: timestamptz('reverted_at'),
    revertedByUserId: uuid('reverted_by_user_id').references(() => appUsers.id, {
      onDelete: 'restrict',
    }),
    revertReason: text('revert_reason'),
    ...timestamps(),
  },
  (table) => [
    index('merge_operations_master_idx').on(table.masterPersonId, table.appliedAt),
    check(
      'merge_operations_revert_fields_check',
      sql`${table.status} = 'APPLIED' or (${table.revertedAt} is not null and ${table.revertedByUserId} is not null and ${table.revertReason} is not null)`,
    ),
  ],
);

export const mergeOperationItems = pgTable(
  'merge_operation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mergeOperationId: uuid('merge_operation_id')
      .notNull()
      .references(() => mergeOperations.id, { onDelete: 'restrict' }),
    action: mergeItemActionEnum('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    sourcePersonId: uuid('source_person_id').references(() => persons.id, { onDelete: 'restrict' }),
    targetPersonId: uuid('target_person_id').references(() => persons.id, { onDelete: 'restrict' }),
    fieldName: text('field_name'),
    before: jsonb('before').$type<JsonObject>(),
    after: jsonb('after').$type<JsonObject>(),
    revertedAt: timestamptz('reverted_at'),
    ...timestamps(),
  },
  (table) => [
    index('merge_operation_items_operation_idx').on(table.mergeOperationId, table.createdAt),
    index('merge_operation_items_entity_idx').on(table.entityType, table.entityId),
  ],
);

export const mergeReassignmentQueue = pgTable(
  'merge_reassignment_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mergeOperationId: uuid('merge_operation_id')
      .notNull()
      .references(() => mergeOperations.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    reason: text('reason').notNull(),
    candidatePersonIds: jsonb('candidate_person_ids').$type<string[]>().notNull(),
    status: queueItemStatusEnum('status').notNull().default('OPEN'),
    resolvedPersonId: uuid('resolved_person_id').references(() => persons.id, {
      onDelete: 'restrict',
    }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamptz('resolved_at'),
    ...timestamps(),
  },
  (table) => [index('merge_reassignment_queue_status_idx').on(table.status, table.createdAt)],
);

export const importRevertConflicts = pgTable(
  'import_revert_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revertRunId: uuid('revert_run_id')
      .notNull()
      .references(() => importRuns.id, { onDelete: 'restrict' }),
    sourceEntityLinkId: uuid('source_entity_link_id').references(() => sourceEntityLinks.id, {
      onDelete: 'restrict',
    }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    reason: text('reason').notNull(),
    details: jsonb('details').$type<JsonObject>().notNull().default({}),
    status: queueItemStatusEnum('status').notNull().default('OPEN'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamptz('resolved_at'),
    ...timestamps(),
  },
  (table) => [index('import_revert_conflicts_queue_idx').on(table.revertRunId, table.status)],
);

// Transactionally rebuilt PostgreSQL search document -------------------------------

export const personSearchDocuments = pgTable(
  'person_search_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    internalIds: text('internal_ids').notNull().default(''),
    canonicalName: text('canonical_name').notNull(),
    aliases: text('aliases').notNull().default(''),
    contacts: text('contacts').notNull().default(''),
    organizations: text('organizations').notNull().default(''),
    projects: text('projects').notNull().default(''),
    artifacts: text('artifacts').notNull().default(''),
    searchText: text('search_text').notNull(),
    searchVector: tsvector('search_vector')
      .notNull()
      .default(sql`''::tsvector`),
    matchMetadata: jsonb('match_metadata').$type<JsonObject>().notNull().default({}),
    rebuiltAt: timestamptz('rebuilt_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('person_search_documents_person_uidx').on(table.personId),
    index('person_search_documents_vector_idx').using('gin', table.searchVector),
    index('person_search_documents_name_trgm_idx').using(
      'gin',
      sql`${table.canonicalName} gin_trgm_ops`,
    ),
    index('person_search_documents_text_trgm_idx').using(
      'gin',
      sql`${table.searchText} gin_trgm_ops`,
    ),
  ],
);
