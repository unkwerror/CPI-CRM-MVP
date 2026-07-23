import { Roles } from '@cpi-crm/domain';
import { describe, expect, it } from 'vitest';

import { recognizedRoles, safeReturnTo } from '../src/plugins/auth.js';

describe('OIDC realm role mapping', () => {
  it('accepts only explicit CRM roles', () => {
    expect(recognizedRoles(['offline_access', Roles.COMMUNITY_MANAGER, 42])).toEqual([
      Roles.COMMUNITY_MANAGER,
    ]);
  });

  it('returns no permissions-bearing fallback for an unknown claim', () => {
    expect(recognizedRoles(['offline_access', 'default-roles-cpi-crm'])).toEqual([]);
    expect(recognizedRoles(undefined)).toEqual([]);
  });
});

describe('post-login return path', () => {
  it('keeps ordinary local CRM paths', () => {
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/participants?q=%D0%98%D0%B2%D0%B0%D0%BD')).toBe(
      '/participants?q=%D0%98%D0%B2%D0%B0%D0%BD',
    );
    expect(safeReturnTo('/events#upcoming')).toBe('/events#upcoming');
  });

  it.each([
    undefined,
    '',
    'events',
    'https://example.org',
    '//example.org/path',
    '///example.org/path',
    '/\\example.org/path',
    '/events\\details',
    '/%2f%2fexample.org/path',
    '/%5cexample.org/path',
    '/events%0d%0aLocation:%20https://example.org',
    '/events\u0000',
    '/events\u007f',
    '/events%ZZ',
  ])('falls back to the CRM root for an unsafe value: %s', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});
