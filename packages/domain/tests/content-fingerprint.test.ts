import { describe, expect, it } from 'vitest';

import {
  ContentFingerprintValidationError,
  createContentFingerprint,
  normalizeExternalUrl,
  normalizeFingerprintText,
} from '../src/content-fingerprint.js';

describe('content fingerprint', () => {
  it('normalizes NFKC and whitespace in text while preserving case', () => {
    expect(normalizeFingerprintText('  MVP\r\n\tплан  ')).toBe('MVP план');
    expect(normalizeFingerprintText('Ａ')).toBe('A');
    expect(normalizeFingerprintText('MVP')).not.toBe(normalizeFingerprintText('mvp'));
  });

  it('is deterministic and independent of URL/file ordering', () => {
    const fileA = 'a'.repeat(64);
    const fileB = 'b'.repeat(64);
    const first = createContentFingerprint({
      text: '  План\nMVP ',
      urls: ['https://example.com/b', 'HTTPS://EXAMPLE.COM/a'],
      fileSha256s: [fileB.toUpperCase(), fileA],
    });
    const second = createContentFingerprint({
      text: 'План MVP',
      urls: ['https://example.com/a', 'https://example.com/b'],
      fileSha256s: [fileA, fileB],
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('changes when meaningful text or a query parameter changes', () => {
    expect(createContentFingerprint({ text: 'MVP' })).not.toBe(
      createContentFingerprint({ text: 'mvp' }),
    );
    expect(createContentFingerprint({ urls: ['https://example.com/?v=1'] })).not.toBe(
      createContentFingerprint({ urls: ['https://example.com/?v=2'] }),
    );
  });

  it('canonicalizes valid HTTP URLs and rejects other protocols', () => {
    expect(normalizeExternalUrl(' HTTPS://EXAMPLE.COM:443/a ')).toBe('https://example.com/a');
    expect(() => normalizeExternalUrl('ftp://example.com/file')).toThrow(
      ContentFingerprintValidationError,
    );
    expect(() => createContentFingerprint({ fileSha256s: ['not-a-hash'] })).toThrow(
      ContentFingerprintValidationError,
    );
  });
});
