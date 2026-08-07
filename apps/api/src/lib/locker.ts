import type { FastifyInstance } from 'fastify';

import { HttpProblem } from './problem.js';

export interface LockerDownload {
  url: string;
  expiresInSeconds: number;
}

/**
 * Файлы Locker физически лежат в хранилище бота сбора артефактов.
 * CRM хранит только метаданные, а ссылку на скачивание запрашивает по
 * внешнему идентификатору перед каждой выдачей.
 */
export async function requestLockerDownloadUrl(
  app: FastifyInstance,
  lockerArtifactId: string,
): Promise<LockerDownload> {
  let response: Response;
  try {
    response = await fetch(
      `${app.config.locker.baseUrl}/api/v1/integrations/crm/artifacts/${encodeURIComponent(lockerArtifactId)}/download`,
      {
        headers: { authorization: `Bearer ${app.config.locker.integrationToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new HttpProblem(502, 'Locker временно недоступен');
  }
  if (!response.ok) throw new HttpProblem(502, 'Locker не выдал ссылку на файл');
  const payload = (await response.json()) as { url?: unknown; expiresInSeconds?: unknown };
  if (typeof payload.url !== 'string')
    throw new HttpProblem(502, 'Locker вернул некорректную ссылку на файл');
  let url: URL;
  try {
    url = new URL(payload.url);
  } catch {
    throw new HttpProblem(502, 'Locker вернул некорректную ссылку на файл');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new HttpProblem(502, 'Locker вернул небезопасную ссылку на файл');
  return {
    url: url.href,
    expiresInSeconds:
      typeof payload.expiresInSeconds === 'number' &&
      Number.isInteger(payload.expiresInSeconds) &&
      payload.expiresInSeconds > 0 &&
      payload.expiresInSeconds <= 3600
        ? payload.expiresInSeconds
        : 300,
  };
}
