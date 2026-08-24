import { describe, expect, it } from 'vitest';

import { isLockerAuthorizationValid } from '../src/lib/locker-auth.js';
import {
  artifactContentType,
  hashLockerSubmissionPayload,
  hashPayload,
  mapCrmEventStatus,
  mapLockerEventStatus,
} from '../src/modules/integrations/locker-routes.js';

describe('Locker integration contract', () => {
  const token = 'locker-integration-token-that-is-long-enough';

  it('accepts only the exact bearer token', () => {
    expect(isLockerAuthorizationValid(`Bearer ${token}`, token)).toBe(true);
    expect(isLockerAuthorizationValid(`Bearer ${token}x`, token)).toBe(false);
    expect(isLockerAuthorizationValid(token, token)).toBe(false);
    expect(isLockerAuthorizationValid(undefined, token)).toBe(false);
  });

  it('hashes equivalent payloads independently of object key order', () => {
    expect(hashPayload({ b: 2, a: { d: 4, c: 3 } })).toBe(hashPayload({ a: { c: 3, d: 4 }, b: 2 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it('maps Locker event states to supported CRM states', () => {
    expect(mapLockerEventStatus('draft')).toBe('PLANNED');
    expect(mapLockerEventStatus('published')).toBe('PLANNED');
    expect(mapLockerEventStatus('running')).toBe('ACTIVE');
    expect(mapLockerEventStatus('finished')).toBe('COMPLETED');
    expect(mapLockerEventStatus('archived')).toBe('COMPLETED');
  });

  it('maps CRM event states to the Locker event contract', () => {
    expect(mapCrmEventStatus('UNKNOWN')).toBe('draft');
    expect(mapCrmEventStatus('PLANNED')).toBe('draft');
    expect(mapCrmEventStatus('ACTIVE')).toBe('running');
    expect(mapCrmEventStatus('COMPLETED')).toBe('finished');
    expect(mapCrmEventStatus('CANCELLED')).toBe('archived');
  });

  it('keeps retries idempotent when mutable profile data changes', () => {
    const base = {
      schemaVersion: 1 as const,
      user: {
        lockerUserId: '11111111-1111-4111-8111-111111111111',
        telegramUserId: '123456789',
        fullName: 'Иван Иванов',
      },
      event: {
        lockerEventId: '22222222-2222-4222-8222-222222222222',
        title: 'Demo Day',
        status: 'finished' as const,
        startsAt: '2026-08-01T03:00:00.000Z',
        endsAt: '2026-08-01T08:00:00.000Z',
      },
      submission: {
        lockerSubmissionId: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-08-01T07:00:00.000Z',
        submittedAt: '2026-08-01T07:30:00.000Z',
        files: [],
      },
    };
    expect(hashLockerSubmissionPayload(base)).toBe(
      hashLockerSubmissionPayload({
        ...base,
        user: { ...base.user, fullName: 'Иван Иванов (обновлено)' },
        event: { ...base.event, title: 'Demo Day — архив', status: 'archived' },
      }),
    );
    expect(
      hashLockerSubmissionPayload({
        ...base,
        submission: { ...base.submission, text: 'Изменённое содержимое' },
      }),
    ).not.toBe(hashLockerSubmissionPayload(base));
    expect(
      hashLockerSubmissionPayload({
        ...base,
        submission: { ...base.submission, sourceKind: 'event_request' },
      }),
    ).not.toBe(hashLockerSubmissionPayload(base));
  });

  it('derives the artifact content type without copying remote files', () => {
    expect(artifactContentType(false, false, true)).toBe('FILE');
    expect(artifactContentType(false, true, false)).toBe('EXTERNAL_URL');
    expect(artifactContentType(true, false, false)).toBe('TEXT');
    expect(artifactContentType(true, false, true)).toBe('MIXED');
  });
});
