/**
 * A concurrency limit, because rastering is a browser tab per frame.
 *
 * Six frames started at once are six Chromium contexts holding six full-size bitmaps, and
 * a 1080×1920 export at 2x is 16 MB of pixels before anything is encoded. Unbounded
 * parallelism on a carousel is how a render turns into a swap storm; two at a time is
 * most of the speedup for a fraction of the peak.
 *
 * It is a queue, not a pool: tasks keep their submission order, so a job's events arrive
 * in the order a reader expects even though the work overlaps.
 */

export interface Limiter {
  /** Runs `task` when a slot frees up. Rejections propagate to the caller of `run`. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function limiter(concurrency: number): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError(
      `Concurrency must be a positive integer, got ${String(concurrency)}. ` +
        'A limit of zero would accept work and never run it.',
    );
  }

  let active = 0;
  const waiting: (() => void)[] = [];

  function release(): void {
    active -= 1;
    // Shift, not pop: the first task to ask is the first to run, which is what keeps a
    // job's frame events in the order the scene lists its frames.
    waiting.shift()?.();
  }

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        // In `finally`, so a task that throws still frees its slot. Without it one
        // failing frame would shrink the limit for every frame after it, and a job with
        // as many failures as slots would hang instead of reporting them.
        release();
      }
    },
  };
}
