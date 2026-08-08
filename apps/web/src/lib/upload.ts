import { api } from './api';

/**
 * Загрузка файла в хранилище CRM.
 *
 * Три шага: намерение с подписанной ссылкой, отправка байтов прямо в S3 мимо
 * API, подтверждение. Байты не идут через API специально — иначе каждый файл
 * занимал бы его память и время на весь срок загрузки.
 *
 * Дальше файл проверяет антивирус, и до статуса `AVAILABLE` пользоваться им
 * нельзя, поэтому функция ждёт окончания проверки.
 */

interface UploadIntent {
  id: string;
  uploadUrl: string;
}

interface FileState {
  id: string;
  status: 'PENDING' | 'SCANNING' | 'AVAILABLE' | 'REJECTED' | 'QUARANTINED';
}

const SCAN_POLL_MS = 1_000;
const SCAN_TIMEOUT_MS = 90_000;

export async function uploadFile(file: File): Promise<string> {
  const mimeType = file.type || 'application/octet-stream';
  const intent = await api<UploadIntent>('/files/upload-intents', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, mimeType, sizeBytes: file.size }),
  });

  const stored = await fetch(intent.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': mimeType },
  });
  if (!stored.ok) throw new Error('Хранилище не приняло файл');

  await api(`/files/${intent.id}/complete`, { method: 'POST' });
  await waitForScan(intent.id);
  return intent.id;
}

async function waitForScan(fileObjectId: string): Promise<void> {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  for (;;) {
    const state = await api<FileState>(`/files/${fileObjectId}`);
    if (state.status === 'AVAILABLE') return;
    if (state.status === 'REJECTED' || state.status === 'QUARANTINED')
      throw new Error('Антивирус не пропустил файл');
    if (Date.now() > deadline) throw new Error('Проверка файла затянулась, попробуйте позже');
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
  }
}
