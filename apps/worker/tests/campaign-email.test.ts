import { describe, expect, it } from 'vitest';

import { buildReplyLink } from '../src/campaign-email-sender.js';

const botLink = 'https://t.me/cpi_artifacts_bot';
const recipientId = '11111111-1111-4111-8111-111111111111';

describe('reply links in an email campaign', () => {
  it('sends the reply through the bot so the answer reaches CRM', () => {
    const link = buildReplyLink(botLink, { text: 'Интересно', action: 'INTERESTED' }, recipientId);
    expect(link).toBe(`${botLink}?start=cmp_${recipientId}_INTERESTED`);
  });

  it('keeps an explicit URL button as is', () => {
    const link = buildReplyLink(
      botLink,
      { text: 'Конкурс', action: 'URL', url: 'https://cpi.example/contest' },
      recipientId,
    );
    expect(link).toBe('https://cpi.example/contest');
  });

  it('carries the underscore inside MORE_INFO into the start payload', () => {
    const link = buildReplyLink(botLink, { text: 'Подробнее', action: 'MORE_INFO' }, recipientId);
    expect(new URL(link).searchParams.get('start')).toBe(`cmp_${recipientId}_MORE_INFO`);
  });
});
