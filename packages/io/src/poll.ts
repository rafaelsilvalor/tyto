import type { BriefSource, BriefTask } from './ports.js';

/**
 * The local watcher of ADR 0008: ask the source, handle what it has, wait, ask again.
 *
 * Polling rather than filesystem events. `fs.watch` reports a folder as it is being
 * copied into, so a task would be picked up with half its assets on disk; the shape of
 * the contract has no "complete" marker, and `brief.brief` is often written first. A poll
 * that reads a folder a second after it stopped changing is both simpler and less wrong,
 * and it is the only option at all on a network share, which is exactly where a shared
 * inbox ends up.
 *
 * It never acks. Acknowledging is a decision about whether the work succeeded, and this
 * loop does not know — the handler does (ADR 0008: never ack on error).
 */

export interface PollOptions {
  /** Between the end of one sweep and the start of the next. Defaults to 1000 ms. */
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
  /**
   * A task that threw. Without this the loop would end on the first broken brief, and one
   * unreadable folder would stop a queue that has nine good ones behind it.
   */
  readonly onError?: (task: BriefTask, cause: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 1000;

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      // Cleared, or the process would stay alive for up to one interval after an abort —
      // which on a CLI is a command that looks hung after Ctrl-C.
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs until the signal fires. Tasks within one sweep are handled in the order the source
 * listed them, one at a time — a render saturates a machine on its own, and two at once
 * would just make both slower.
 */
export async function pollSource(
  source: BriefSource,
  handle: (task: BriefTask) => Promise<void>,
  options: PollOptions = {},
): Promise<void> {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const { signal } = options;

  // Read through a call, never as `signal?.aborted`. The property changes under the loop —
  // that is what a signal is — and TypeScript narrows a property access after the first
  // check and keeps the narrowing across an `await`, so a later check written that way
  // compiles to a comparison it believes can never be true. `job.ts` in `pipeline` reads
  // its signal the same way, for the same reason.
  const aborted = (): boolean => signal?.aborted === true;

  while (!aborted()) {
    // A source that cannot be listed at all — the folder was deleted under us — is not a
    // reason to stop watching; the folder may come back.
    const tasks = await source.pull().catch(() => [] as readonly BriefTask[]);

    for (const task of tasks) {
      if (aborted()) return;
      try {
        await handle(task);
      } catch (cause) {
        options.onError?.(task, cause);
      }
    }

    if (aborted()) return;
    await sleep(interval, signal);
  }
}
