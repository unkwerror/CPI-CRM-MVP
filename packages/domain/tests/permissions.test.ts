import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  Permissions,
  ROLE_PERMISSIONS,
  Roles,
  hasEveryPermission,
  hasPermission,
  permissionsForRoles,
} from '../src/permissions.js';

describe('role permission matrix', () => {
  it('defines exactly the five MVP roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.values(Roles).sort());
  });

  it('gives admin every permission', () => {
    expect(ROLE_PERMISSIONS.admin).toEqual(ALL_PERMISSIONS);
  });

  it('allows community manager operational work but not raw imports or audit', () => {
    expect(hasPermission([Roles.COMMUNITY_MANAGER], Permissions.PEOPLE_WRITE)).toBe(true);
    expect(hasPermission([Roles.COMMUNITY_MANAGER], Permissions.EVENTS_WRITE)).toBe(true);
    expect(hasPermission([Roles.COMMUNITY_MANAGER], Permissions.ARTIFACTS_WRITE)).toBe(true);
    expect(hasPermission([Roles.COMMUNITY_MANAGER], Permissions.IMPORTS_READ_RAW)).toBe(false);
    expect(hasPermission([Roles.COMMUNITY_MANAGER], Permissions.AUDIT_READ)).toBe(false);
  });

  it('allows methodologist to review artifacts without participant mutation', () => {
    expect(hasPermission([Roles.METHODOLOGIST], Permissions.ARTIFACTS_REVIEW)).toBe(true);
    expect(hasPermission([Roles.METHODOLOGIST], Permissions.PEOPLE_WRITE)).toBe(false);
  });

  it('gives data steward raw import and duplicate-resolution rights', () => {
    expect(
      hasEveryPermission(
        [Roles.DATA_STEWARD],
        [Permissions.IMPORTS_RUN, Permissions.IMPORTS_READ_RAW, Permissions.DUPLICATES_RESOLVE],
      ),
    ).toBe(true);
    expect(hasPermission([Roles.DATA_STEWARD], Permissions.EVENTS_WRITE)).toBe(false);
    expect(hasPermission([Roles.DATA_STEWARD], Permissions.SETTINGS_MANAGE)).toBe(false);
  });

  it('keeps auditor read-only', () => {
    expect(hasPermission([Roles.AUDITOR], Permissions.AUDIT_READ)).toBe(true);
    for (const mutation of [
      Permissions.PEOPLE_WRITE,
      Permissions.EVENTS_WRITE,
      Permissions.CONTACTS_WRITE,
      Permissions.ARTIFACTS_WRITE,
      Permissions.ARTIFACTS_REVIEW,
      Permissions.TASKS_MANAGE,
      Permissions.IMPORTS_RUN,
      Permissions.DUPLICATES_RESOLVE,
      Permissions.SETTINGS_MANAGE,
      Permissions.EXPORTS_BULK,
    ]) {
      expect(hasPermission([Roles.AUDITOR], mutation)).toBe(false);
    }
  });

  it('unions permissions for users with multiple roles', () => {
    const combined = permissionsForRoles([Roles.COMMUNITY_MANAGER, Roles.METHODOLOGIST]);
    expect(combined).toContain(Permissions.PEOPLE_WRITE);
    expect(combined).toContain(Permissions.ARTIFACTS_REVIEW);
    expect(combined).not.toContain(Permissions.IMPORTS_READ_RAW);
  });
});
