import { describe, expect, it } from 'vitest';

import { signCampaignLink, verifyCampaignLink } from '../src/campaign-links.js';

const secret = 'campaign-link-secret';
const recipientId = '11111111-1111-4111-8111-111111111111';

describe('signed links inside a campaign email', () => {
  it('returns the recipient when the signature matches', () => {
    const token = signCampaignLink(secret, 'UNSUBSCRIBE', recipientId);
    expect(verifyCampaignLink(secret, 'UNSUBSCRIBE', token)).toBe(recipientId);
  });

  it('survives being carried in a URL path', () => {
    const token = signCampaignLink(secret, 'OPEN', recipientId);
    expect(token).toBe(encodeURIComponent(token));
  });

  it('refuses a token issued for another purpose', () => {
    const token = signCampaignLink(secret, 'OPEN', recipientId);
    expect(verifyCampaignLink(secret, 'UNSUBSCRIBE', token)).toBeNull();
  });

  it('refuses a recipient swapped inside the token', () => {
    const token = signCampaignLink(secret, 'UNSUBSCRIBE', recipientId);
    const forged = token.replace(recipientId, '22222222-2222-4222-8222-222222222222');
    expect(verifyCampaignLink(secret, 'UNSUBSCRIBE', forged)).toBeNull();
  });

  it('refuses a token signed with another secret', () => {
    const token = signCampaignLink('other-secret', 'UNSUBSCRIBE', recipientId);
    expect(verifyCampaignLink(secret, 'UNSUBSCRIBE', token)).toBeNull();
  });

  it('refuses malformed input instead of throwing', () => {
    expect(verifyCampaignLink(secret, 'OPEN', 'nonsense')).toBeNull();
  });
});
