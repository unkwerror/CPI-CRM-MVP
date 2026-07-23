import { describe, expect, it } from 'vitest';

import { computeRetryDelayMs } from '../src/outbox.js';

describe('computeRetryDelayMs', () => {
  it('uses capped exponential retry delays', () => {
    expect(computeRetryDelayMs(1, 1_000, 10_000)).toBe(1_000);
    expect(computeRetryDelayMs(2, 1_000, 10_000)).toBe(2_000);
    expect(computeRetryDelayMs(4, 1_000, 10_000)).toBe(8_000);
    expect(computeRetryDelayMs(20, 1_000, 10_000)).toBe(10_000);
  });
});
