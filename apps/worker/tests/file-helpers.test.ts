import { describe, expect, it } from 'vitest';

import { buildPrivateObjectKey, encodeCopySource } from '../src/file-scanner.js';
import { detectMimeType } from '../src/mime.js';

describe('file helper logic', () => {
  it('uses an immutable id/hash destination key', () => {
    const hash = 'f'.repeat(64);
    expect(buildPrivateObjectKey('71a89421-0ac0-4938-aaf4-57e12e47a805', hash)).toBe(
      `files/71a89421-0ac0-4938-aaf4-57e12e47a805/${hash}`,
    );
  });

  it('URL-encodes every segment of an S3 copy source', () => {
    expect(encodeCopySource('cpi-quarantine', 'incoming/отчёт 1.pdf')).toBe(
      'cpi-quarantine/incoming/%D0%BE%D1%82%D1%87%D1%91%D1%82%201.pdf',
    );
  });

  it('detects PDF magic independently of the declaration', () => {
    expect(detectMimeType(Buffer.from('%PDF-1.7\n'), 'text/plain')).toBe('application/pdf');
  });
});
