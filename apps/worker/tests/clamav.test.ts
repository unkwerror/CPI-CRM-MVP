import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import { parseClamAvResponse, scanWithClamAv } from '../src/clamav.js';

describe('parseClamAvResponse', () => {
  it('accepts a clean INSTREAM result', () => {
    expect(parseClamAvResponse('stream: OK\0')).toEqual({
      status: 'CLEAN',
      raw: 'stream: OK',
    });
  });

  it('extracts the malware signature', () => {
    expect(parseClamAvResponse('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      status: 'INFECTED',
      signature: 'Win.Test.EICAR_HDB-1',
      raw: 'stream: Win.Test.EICAR_HDB-1 FOUND',
    });
  });

  it('does not turn scanner errors into clean results', () => {
    expect(() => parseClamAvResponse('stream: INSTREAM size limit exceeded. ERROR\0')).toThrow(
      /rejected the stream/iu,
    );
  });

  it('frames INSTREAM chunks and hashes exactly the scanned bytes', async () => {
    const received: Buffer[] = [];
    const server = createServer((socket) => {
      let input = Buffer.alloc(0);
      let commandRead = false;
      socket.on('data', (chunk: Buffer) => {
        input = Buffer.concat([input, chunk]);
        if (!commandRead) {
          if (input.length < 10) return;
          expect(input.subarray(0, 10).toString('ascii')).toBe('zINSTREAM\0');
          input = input.subarray(10);
          commandRead = true;
        }
        while (input.length >= 4) {
          const length = input.readUInt32BE(0);
          if (input.length < 4 + length) return;
          input = input.subarray(4);
          if (length === 0) {
            socket.end('stream: OK\0');
            return;
          }
          received.push(Buffer.from(input.subarray(0, length)));
          input = input.subarray(length);
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');

    try {
      const chunks = [Buffer.from('hello '), Buffer.from('world')];
      const scan = await scanWithClamAv(
        (async function* () {
          yield* chunks;
        })(),
        {
          host: '127.0.0.1',
          port: address.port,
          timeoutMs: 2_000,
          maxStreamBytes: 1_024,
        },
      );
      expect(Buffer.concat(received).toString('utf8')).toBe('hello world');
      expect(scan.bytes).toBe(11);
      expect(scan.sha256).toBe(createHash('sha256').update('hello world').digest('hex'));
      expect(scan.antivirus.status).toBe('CLEAN');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
