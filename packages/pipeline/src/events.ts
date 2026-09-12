import type { Diagnostics } from '@tyto/core';

import type { ArtifactKind } from './artifact.js';

/**
 * What a job says while it runs.
 *
 * A render is seconds of wall clock — Chromium launches, a carousel is six frames — and a
 * CLI with a progress bar and a desktop jobs panel both need to say what is happening
 * without either of them guessing. So the job emits events rather than returning only at
 * the end, and the events are a tagged union so a consumer that handles three of them
 * still compiles when a fourth is added.
 *
 * Events are notifications, never a channel back: `onEvent` returns nothing and a
 * listener that throws is a bug in the listener, not a reason to abandon a render half
 * done. Cancellation goes the other way, through the `AbortSignal`.
 */

/**
 * The stages of `docs/architecture.md`, in the order a job runs them.
 *
 * `resources` sits between `compile` and `render` because that is the only window in
 * which the question has an answer: a scene has to exist before anyone can say which
 * bytes it needs, and the bytes have to be in memory before the first synchronous export
 * walk. It is emitted only when a job was given a `loadResources` port.
 */
export type JobStage = 'parse' | 'template' | 'resolve' | 'compile' | 'resources' | 'render';

/** One unit of renderable work: one frame of one artwork, encoded one way. */
export interface FrameTarget {
  readonly artwork: string;
  readonly format: string;
  readonly kind: ArtifactKind;
}

export type JobEvent =
  | { readonly kind: 'stage-started'; readonly stage: JobStage }
  | { readonly kind: 'stage-finished'; readonly stage: JobStage }
  /**
   * How much work the job turned out to be, emitted once `compile` has produced a scene.
   *
   * It cannot be known earlier: the artwork count comes from the repeatable slot in the
   * brief, so a bar drawn before this event would be a bar drawn over a total nobody had
   * counted yet.
   */
  | { readonly kind: 'planned'; readonly total: number }
  | { readonly kind: 'frame-started'; readonly target: FrameTarget }
  | {
      readonly kind: 'frame-finished';
      readonly target: FrameTarget;
      /** The artifact's file name, so a log line can name what landed. */
      readonly artifact: string;
      readonly done: number;
      readonly total: number;
    }
  | {
      readonly kind: 'frame-failed';
      readonly target: FrameTarget;
      readonly problems: Diagnostics;
      readonly done: number;
      readonly total: number;
    }
  /** The signal fired. `done` frames had finished; the rest were never started. */
  | { readonly kind: 'cancelled'; readonly done: number; readonly total: number };

export type JobListener = (event: JobEvent) => void;

/**
 * Calls a listener without letting it take the job down.
 *
 * A progress bar that throws on its thousandth redraw would otherwise lose a render that
 * had already done all the work. The throw is not swallowed silently — it goes to
 * `console.error`, which is the one thing a listener bug can be reported through without
 * inventing a diagnostic about the brief, since the brief did nothing wrong.
 */
export function notify(listener: JobListener | undefined, event: JobEvent): void {
  if (listener === undefined) return;
  try {
    listener(event);
  } catch (cause) {
    console.error('A pipeline job listener threw; the job continued.', cause);
  }
}
