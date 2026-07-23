import { createHash } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';

export interface ClamAvOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly maxStreamBytes: number;
}

export interface CleanScanResult {
  readonly status: 'CLEAN';
  readonly raw: string;
}

export interface InfectedScanResult {
  readonly status: 'INFECTED';
  readonly signature: string;
  readonly raw: string;
}

export type ClamAvScanResult = CleanScanResult | InfectedScanResult;

export interface StreamScanResult {
  readonly antivirus: ClamAvScanResult;
  readonly bytes: number;
  readonly sha256: string;
  readonly header: Buffer;
}

const HEADER_BYTES = 8_192;

/**
 * Streams the S3 body to clamd using its length-prefixed INSTREAM protocol.
 * Hashing and header capture happen over exactly the same bytes that clamd saw.
 */
export async function scanWithClamAv(
  input: AsyncIterable<Uint8Array>,
  options: ClamAvOptions,
): Promise<StreamScanResult> {
  const socket = createConnection({ host: options.host, port: options.port });
  socket.setTimeout(options.timeoutMs, () => {
    socket.destroy(new Error(`ClamAV scan timed out after ${String(options.timeoutMs)}ms`));
  });

  const response = readResponse(socket);
  const hash = createHash('sha256');
  const headerChunks: Buffer[] = [];
  let headerLength = 0;
  let bytes = 0;

  try {
    await once(socket, 'connect');
    await write(socket, Buffer.from('zINSTREAM\0', 'ascii'));

    for await (const value of input) {
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (chunk.length === 0) continue;
      bytes += chunk.length;
      if (bytes > options.maxStreamBytes) {
        throw new Error(
          `File exceeds ClamAV stream limit of ${String(options.maxStreamBytes)} bytes`,
        );
      }

      hash.update(chunk);
      if (headerLength < HEADER_BYTES) {
        const remaining = HEADER_BYTES - headerLength;
        const part = chunk.subarray(0, remaining);
        headerChunks.push(Buffer.from(part));
        headerLength += part.length;
      }

      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length, 0);
      await write(socket, length);
      await write(socket, chunk);
    }

    socket.end(Buffer.alloc(4));
    const raw = await response;
    return {
      antivirus: parseClamAvResponse(raw),
      bytes,
      sha256: hash.digest('hex'),
      header: Buffer.concat(headerChunks, headerLength),
    };
  } catch (error) {
    socket.destroy();
    await response.catch(() => undefined);
    throw error;
  }
}

export function parseClamAvResponse(value: string): ClamAvScanResult {
  const raw = value.replaceAll('\0', '').trim();
  if (/:\s*OK$/iu.test(raw)) return { status: 'CLEAN', raw };

  const infected = /:\s*(.+)\s+FOUND$/iu.exec(raw);
  if (infected?.[1]) {
    return { status: 'INFECTED', signature: infected[1].trim(), raw };
  }

  if (/\bERROR$/iu.test(raw)) throw new Error(`ClamAV rejected the stream: ${raw}`);
  throw new Error(`Unrecognized ClamAV response: ${raw || '<empty>'}`);
}

function readResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      response += chunk;
      if (response.includes('\0') || response.includes('\n')) finish();
    });
    socket.once('end', finish);
    socket.once('close', finish);
    socket.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function write(socket: Socket, chunk: Buffer): Promise<void> {
  if (socket.destroyed) throw new Error('ClamAV connection closed during scan');
  if (!socket.write(chunk)) await once(socket, 'drain');
}
