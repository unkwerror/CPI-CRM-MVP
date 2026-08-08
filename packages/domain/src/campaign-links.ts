import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ссылки в письме: пиксель открытия и отписка.
 *
 * Свой SMTP не присылает статусов, поэтому отклик собирается ссылками внутри
 * письма. Открывает их кто угодно из интернета, так что в адресе не может быть
 * голого идентификатора получателя: он подписывается общим секретом, а цель
 * входит в подпись — по ссылке отписки нельзя отметить открытие и наоборот.
 */

export type CampaignLinkPurpose = 'OPEN' | 'UNSUBSCRIBE';

const PURPOSE_CODE: Readonly<Record<CampaignLinkPurpose, string>> = {
  OPEN: 'o',
  UNSUBSCRIBE: 'u',
};

export function signCampaignLink(
  secret: string,
  purpose: CampaignLinkPurpose,
  recipientId: string,
): string {
  const payload = `${PURPOSE_CODE[purpose]}.${recipientId}`;
  return `${payload}.${digest(secret, payload)}`;
}

/** @returns идентификатор получателя или null, если подпись не совпала */
export function verifyCampaignLink(
  secret: string,
  purpose: CampaignLinkPurpose,
  token: string,
): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [code, recipientId, signature] = parts as [string, string, string];
  if (code !== PURPOSE_CODE[purpose]) return null;

  const expected = Buffer.from(digest(secret, `${code}.${recipientId}`), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return recipientId;
}

function digest(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 27);
}
