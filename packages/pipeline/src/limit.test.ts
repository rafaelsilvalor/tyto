import { describe, expect, it } from 'vitest';

import { limiter } from './limit.js';

/** A task that reports when it starts and finishes only when told to. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => {
      settle();
    };
  });
  return { promise, resolve };
}

describe('limiter', () => {
  it('runs up to the limit at once and queues the rest', async () => {
    const gate = limiter(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const runs = gates.map(async (task, index) =>
      gate.run(async () => {
        started.push(index);
        await task.promise;
      }),
    );

    // Two slots, three tasks: the third has not been given one yet.
    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    gates[0]?.resolve();
    await Promise.all([runs[0]]);
    expect(started).toEqual([0, 1, 2]);

    gates[1]?.resolve();
    gates[2]?.resolve();
    await Promise.all(runs);
  });

  it('hands freed slots out in the order they were asked for', async () => {
    const gate = limiter(1);
    const order: string[] = [];

    await Promise.all(
      ['a', 'b', 'c'].map(async (name) =>
        gate.run(async () => {
          order.push(name);
          await Promise.resolve();
        }),
      ),
    );

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('frees the slot when a task throws', async () => {
    const gate = limiter(1);

    await expect(gate.run(() => Promise.reject(new Error('the tab crashed')))).rejects.toThrow(
      'the tab crashed',
    );

    // Without the `finally` this second task would wait for a slot nobody will ever
    // return, and the test would time out instead of failing.
    await expect(gate.run(() => Promise.resolve('after'))).resolves.toBe('after');
  });

  it('runs everything when the limit is larger than the work', async () => {
    const gate = limiter(10);
    const results = await Promise.all(
      [1, 2, 3].map(async (n) => gate.run(() => Promise.resolve(n))),
    );

    expect(results).toEqual([1, 2, 3]);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses a limit of %s', (concurrency) => {
    expect(() => limiter(concurrency)).toThrow(TypeError);
  });
});
