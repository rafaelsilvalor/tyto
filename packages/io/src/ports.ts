import type { ArtifactSink } from '@tyto/pipeline';

import type { RenderResult } from './result.js';

/**
 * The local queue as a contract (ADR 0008).
 *
 * A task arrives from somewhere, is rendered, and its output goes somewhere. Which
 * somewheres those are is the adapter's business: a folder today, an HTTP endpoint and a
 * bucket in the cloud later, with no change to the two interfaces below. That is the whole
 * claim of ADR 0008, and it only holds because nothing here mentions a disk.
 */

/** One unit of work: a brief, and whatever a renderer needs to resolve its paths. */
export interface BriefTask {
  /** Stable and unique within the source — the folder name, for `fs-inbox`. */
  readonly id: string;
  /** The brief's text. Already read, because a source that handed back a path would be a
   * source that only a filesystem could implement. */
  readonly brief: string;
  /**
   * What relative paths in the brief resolve against.
   *
   * A location rather than bytes, because a brief may reference any number of assets and
   * reading all of them up front would load a folder of photographs to render one.
   */
  readonly assetBase: string;
  /** For a diagnostic that wants to name the file the author should open. */
  readonly briefPath: string;
}

export interface BriefSource {
  /**
   * Every task waiting right now.
   *
   * A list rather than a stream: a folder listing is a list, and a caller that wants one
   * at a time can take the first. It is a snapshot and says nothing about what arrives a
   * second later — that is what `pollSource` is for.
   */
  pull(): Promise<readonly BriefTask[]>;

  /**
   * This task is finished and should not come back.
   *
   * **Never call it after an error** (ADR 0008). A task that failed has to stay where it
   * is so that a person can look at it, fix the brief and let it run again; a queue that
   * acknowledges failures quietly loses work and tells nobody.
   */
  ack(id: string): Promise<void>;
}

/**
 * Where one task's output goes, opened before the render and closed by `finish`.
 *
 * It extends `ArtifactSink` because that is what the job in E6.1 writes into, one artifact
 * at a time as each frame completes. A port that took the finished set instead would mean
 * holding a whole carousel's PNGs in memory to hand them over at the end.
 */
export interface TaskOutput extends ArtifactSink {
  /** Writes `result.json` and releases anything the output was holding. */
  finish(result: RenderResult): Promise<void>;
}

export interface OutputSink {
  /**
   * `open` rather than the `push` the spec sketches, for the streaming reason above. What
   * is pushed is each artifact, into what this returns.
   */
  open(id: string): Promise<TaskOutput>;
}
