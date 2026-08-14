import { describe, expect, it } from 'vitest';

import { abortableDelay } from '../src/worker.js';

describe('abortableDelay', () => {
  it('снимает подписку на отмену после срабатывания таймера', async () => {
    const controller = new AbortController();
    let listeners = 0;
    const signal = {
      aborted: false,
      addEventListener: () => {
        listeners += 1;
      },
      removeEventListener: () => {
        listeners -= 1;
      },
    } as unknown as AbortSignal;

    // Цикл воркера ждёт по секунде между опросами и живёт неделями, поэтому
    // подписки не должны накапливаться ни на один виток.
    for (let index = 0; index < 50; index += 1) await abortableDelay(0, signal);
    expect(listeners).toBe(0);

    controller.abort();
    await expect(abortableDelay(60_000, controller.signal)).resolves.toBeUndefined();
  });

  it('просыпается по отмене, не дожидаясь таймера', async () => {
    const controller = new AbortController();
    const waiting = abortableDelay(60_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
  });
});
