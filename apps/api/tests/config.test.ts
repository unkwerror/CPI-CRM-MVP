import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const original = {
  ARTIFACT_BASELINE_AT: process.env.ARTIFACT_BASELINE_AT,
  AUTH_REQUIRED: process.env.AUTH_REQUIRED,
  SESSION_KEY_BASE64: process.env.SESSION_KEY_BASE64,
};

afterEach(() => {
  restore('ARTIFACT_BASELINE_AT', original.ARTIFACT_BASELINE_AT);
  restore('AUTH_REQUIRED', original.AUTH_REQUIRED);
  restore('SESSION_KEY_BASE64', original.SESSION_KEY_BASE64);
});

describe('API configuration', () => {
  it('supports the explicit local no-OIDC mode', () => {
    process.env.AUTH_REQUIRED = 'false';
    expect(loadConfig().authRequired).toBe(false);
  });

  it('rejects a session key that is not exactly 32 bytes', () => {
    process.env.SESSION_KEY_BASE64 = Buffer.from('too short').toString('base64');
    expect(() => loadConfig()).toThrow(/32 bytes/);
  });

  it('rejects an invalid artifact baseline', () => {
    process.env.ARTIFACT_BASELINE_AT = 'not-a-date';
    expect(() => loadConfig()).toThrow(/ARTIFACT_BASELINE_AT is invalid/);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
