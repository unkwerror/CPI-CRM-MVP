import { describe, expect, it } from 'vitest';

import { encodeCopySource } from '../src/file-scanner.js';
import { detectMimeType } from '../src/mime.js';

describe('file helper logic', () => {
  it('URL-encodes every segment of an S3 copy source', () => {
    expect(encodeCopySource('cpi-artifacts', 'crm/incoming/отчёт 1.pdf')).toBe(
      'cpi-artifacts/crm/incoming/%D0%BE%D1%82%D1%87%D1%91%D1%82%201.pdf',
    );
  });

  it('detects PDF magic independently of the declaration', () => {
    expect(detectMimeType(Buffer.from('%PDF-1.7\n'), 'text/plain')).toBe('application/pdf');
  });
});
