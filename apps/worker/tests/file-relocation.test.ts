import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { FileRelocator } from '../src/file-relocation.js';

const fileObjectId = '71a89421-0ac0-4938-aaf4-57e12e47a805';
const versionId = '2c1d0f3e-1111-4111-8111-111111111111';

interface StoredFile {
  status: string;
  bucket: string;
  object_key: string;
  original_filename: string | null;
  storage_provider: 'CRM' | 'LOCKER';
  scan_result: Record<string, unknown> | null;
  event_name: string | null;
  person_name: string | null;
}

function baseFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    status: 'AVAILABLE',
    bucket: 'cpi-artifacts',
    object_key: `crm/checked/${fileObjectId}/презентация.pdf`,
    original_filename: 'презентация.pdf',
    storage_provider: 'CRM',
    scan_result: null,
    event_name: 'Инвест-питч 04.2026',
    person_name: 'Базарбаев Акмалжон Хуррамович',
    ...overrides,
  };
}

/** Пул отдаёт одну строку файла и запоминает изменения ключа. */
function fakePool(file: StoredFile) {
  const updates: unknown[][] = [];
  const client = {
    query: (_text: string, values?: unknown[]) => {
      if (values) updates.push(values);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    release: () => undefined,
  };
  const pool = {
    query: () => Promise.resolve({ rows: [file], rowCount: 1 }),
    connect: () => Promise.resolve(client),
  };
  return { pool: pool as unknown as Pool, updates };
}

/** Хранилище: помнит существующие ключи и записывает выполненные команды. */
function fakeS3(existingKeys: string[] = []) {
  const keys = new Set(existingKeys);
  const calls: { copiedTo?: string | undefined; deleted?: string | undefined }[] = [];
  const s3 = {
    send: (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        if (keys.has(command.input.Key!)) return Promise.resolve({});
        const error = Object.assign(new Error('Not Found'), { name: 'NotFound' });
        return Promise.reject(error);
      }
      if (command instanceof CopyObjectCommand) {
        calls.push({ copiedTo: command.input.Key });
        return Promise.resolve({});
      }
      if (command instanceof DeleteObjectCommand) {
        calls.push({ deleted: command.input.Key });
        return Promise.resolve({});
      }
      throw new Error('Unexpected S3 command');
    },
  };
  return { s3: s3 as unknown as S3Client, calls };
}

const options = { bucket: 'cpi-artifacts', prefix: 'crm/' };

describe('переезд файла в читаемую папку', () => {
  it('кладёт файл в папку мероприятия и участника и убирает служебную копию', async () => {
    const file = baseFile();
    const { pool, updates } = fakePool(file);
    const { s3, calls } = fakeS3();
    await new FileRelocator(pool, s3, options).relocateArtifactFile(fileObjectId, versionId);

    const target =
      'crm/artifacts/Инвест-питч 04.2026/Базарбаев Акмалжон Хуррамович/презентация.pdf';
    expect(calls).toEqual([{ copiedTo: target }, { deleted: file.object_key }]);
    expect(updates[0]?.[1]).toBe(target);
  });

  it('разводит одноимённые файлы суффиксом', async () => {
    const taken = 'crm/artifacts/Инвест-питч 04.2026/Базарбаев Акмалжон Хуррамович/презентация.pdf';
    const { pool } = fakePool(baseFile());
    const { s3, calls } = fakeS3([taken]);
    await new FileRelocator(pool, s3, options).relocateArtifactFile(fileObjectId, versionId);

    expect(calls[0]?.copiedTo).toBe(
      'crm/artifacts/Инвест-питч 04.2026/Базарбаев Акмалжон Хуррамович/презентация (2).pdf',
    );
  });

  it('ждёт антивирус, а не переносит непроверенные байты', async () => {
    const { pool } = fakePool(baseFile({ status: 'SCANNING' }));
    const { s3, calls } = fakeS3();
    await expect(
      new FileRelocator(pool, s3, options).relocateArtifactFile(fileObjectId, versionId),
    ).rejects.toThrow(/SCANNING/u);
    expect(calls).toEqual([]);
  });

  it('не трогает заражённый файл: артефакт с ним всё равно не засчитан', async () => {
    const { pool } = fakePool(baseFile({ status: 'REJECTED' }));
    const { s3, calls } = fakeS3();
    await new FileRelocator(pool, s3, options).relocateArtifactFile(fileObjectId, versionId);
    expect(calls).toEqual([]);
  });

  it('не трогает файлы бота: CRM читает их по ссылке', async () => {
    const { pool } = fakePool(
      baseFile({ storage_provider: 'LOCKER', object_key: 'locker/artifacts/1.pdf' }),
    );
    const { s3, calls } = fakeS3();
    await new FileRelocator(pool, s3, options).relocateArtifactFile(fileObjectId, versionId);
    expect(calls).toEqual([]);
  });

  it('после повтора события доудаляет исходник, а не копирует заново', async () => {
    const moved = 'crm/artifacts/Инвест-питч 04.2026/Базарбаев Акмалжон Хуррамович/презентация.pdf';
    const source = `crm/checked/${fileObjectId}/презентация.pdf`;
    const { pool } = fakePool(
      baseFile({
        object_key: moved,
        scan_result: { relocatedFrom: { bucket: 'cpi-artifacts', objectKey: source } },
      }),
    );
    const { s3, calls } = fakeS3([moved]);
    await new FileRelocator(pool, s3, options).relocateArtifactFile(fileObjectId, versionId);
    expect(calls).toEqual([{ deleted: source }]);
  });
});
