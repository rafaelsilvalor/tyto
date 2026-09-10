import { type RasterFormat, rasterExtension, rasterMimeType } from '@tyto/raster';

/**
 * What a job produces, and what it is called.
 *
 * One artifact is one file: a frame of one artwork in one format, encoded one way. The
 * name is derived rather than chosen, because ADR 0011 makes the output folder a contract
 * — Jacurutu reads `out/` and matches files to what it asked for, and a name that varied
 * with the machine or the order of a loop would break that without ever failing a test.
 */

/** The encodings a job can ask for. Three raster, one vector. */
export type ArtifactKind = RasterFormat | 'svg';

export interface Artifact {
  /** `<artwork>-<format>.<ext>`, the file name the sink writes. */
  readonly name: string;
  readonly artwork: string;
  readonly format: string;
  readonly kind: ArtifactKind;
  readonly mime: string;
  /**
   * The bytes, SVG included — UTF-8 encoded here rather than at the sink.
   *
   * A sink that took `string | Uint8Array` would have to decide the encoding, and two
   * sinks that decided differently would write two different files for one artifact.
   */
  readonly bytes: Uint8Array;
}

/**
 * Where finished artifacts go, if anywhere.
 *
 * The port is declared here and implemented in `io` (E6.2), because a job that reached
 * for `node:fs` itself could not run in a browser preview or against a bucket, and
 * because "cancelling leaves no partial files" is a promise about writing that only
 * whoever writes can keep. A job with no sink returns its artifacts in memory and touches
 * nothing.
 */
export interface ArtifactSink {
  /**
   * Called once per finished artifact, **in completion order rather than scene order**.
   *
   * Frames render in parallel and an SVG is finished long before the PNG of the same
   * frame, so a sink sees them interleaved. What is ordered is `JobReport.artifacts`,
   * which is what `result.json` is built from; forcing the writes into scene order would
   * mean holding finished bytes back to wait for an earlier frame, and no consumer of
   * ADR 0011's folder contract reads the order files appeared in.
   *
   * Rejects rather than returning a `Result`: a full disk is the operating system's
   * answer, the same category `core`'s `FileSystem` port deliberately rejects on. The job
   * catches at its own edge and turns it into a diagnostic.
   */
  write(artifact: Artifact): Promise<void>;
}

export function artifactExtension(kind: ArtifactKind): string {
  return kind === 'svg' ? 'svg' : rasterExtension(kind);
}

export function artifactMimeType(kind: ArtifactKind): string {
  return kind === 'svg' ? 'image/svg+xml' : rasterMimeType(kind);
}

/**
 * `<artwork>-<format>.<ext>` — the naming the card and ADR 0011 specify.
 *
 * Ids in a brief come from a repeatable slot and can hold anything the author typed, so
 * anything a filesystem or a URL would argue about is collapsed to `-`. It is done here,
 * once, rather than in each sink: two sinks that sanitized differently would answer
 * "which file is slide 2?" two ways.
 */
export function artifactName(artwork: string, format: string, kind: ArtifactKind): string {
  return `${fileSafe(artwork)}-${fileSafe(format)}.${artifactExtension(kind)}`;
}

const UNSAFE = /[^a-zA-Z0-9._-]+/gu;

function fileSafe(part: string): string {
  // Leading dots go too: `.slide` would be a hidden file on Unix, and an artwork nobody
  // can see in a folder listing is an artwork nobody knows was produced.
  return part.replace(UNSAFE, '-').replace(/^[.-]+/u, '') || 'untitled';
}
