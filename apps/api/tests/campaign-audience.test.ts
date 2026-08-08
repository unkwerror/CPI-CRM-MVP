import { describe, expect, it } from 'vitest';

import { buildAudienceQuery, renderCampaignBody } from '../src/modules/campaigns/audience.js';

const organizationId = '22222222-2222-4222-8222-222222222222';

/** Плейсхолдеры должны идти без пропусков: иначе pg отвергнет запрос. */
function placeholders(sql: string): number[] {
  return [...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
}

describe('building a campaign audience', () => {
  it('never writes to people who opted out', () => {
    const { sql, params } = buildAudienceQuery(organizationId, 'EMAIL', {});
    expect(sql).toContain("consent.status NOT IN ('WITHDRAWN', 'DENIED')");
    expect(params[1]).toBe('MARKETING_EMAIL');
  });

  it('reaches only participants with a Telegram id, not a username', () => {
    const { sql } = buildAudienceQuery(organizationId, 'TELEGRAM', {});
    expect(sql).toContain('contact.messenger_stable_id IS NOT NULL');
    expect(sql).toContain('address.telegram IS NOT NULL');
  });

  it('numbers every placeholder in order when all filters are on', () => {
    const { sql, params } = buildAudienceQuery(
      organizationId,
      'TELEGRAM',
      {
        hasArtifact: true,
        lastArtifactWithinDays: 180,
        incompleteProfile: false,
        eventIds: ['33333333-3333-4333-8333-333333333333'],
      },
      { excludeCampaignId: '44444444-4444-4444-8444-444444444444', limit: 200 },
    );
    const used = new Set(placeholders(sql));
    expect([...used].sort((a, b) => a - b)).toEqual(
      Array.from({ length: params.length }, (_, index) => index + 1),
    );
    expect(params.at(-1)).toBe(200);
  });

  it('skips the wave for people already queued in the same campaign', () => {
    const { sql } = buildAudienceQuery(
      organizationId,
      'EMAIL',
      {},
      { excludeCampaignId: '44444444-4444-4444-8444-444444444444' },
    );
    expect(sql).toContain('FROM campaign_recipients queued');
  });
});

describe('rendering a campaign message', () => {
  it('greets by first name', () => {
    const text = renderCampaignBody('Привет, {{имя}}!', {
      canonicalFullName: 'Глазырин Павел Андреевич',
      firstName: 'Павел',
    });
    expect(text).toBe('Привет, Павел!');
  });

  it('falls back to a neutral greeting when the name is unknown', () => {
    const text = renderCampaignBody('Привет, {{имя}}!', {
      canonicalFullName: 'Глазырин',
      firstName: null,
    });
    expect(text).toBe('Привет, коллега!');
  });
});
