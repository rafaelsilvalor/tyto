import type { Diagnostics, FontFace, Result } from '@tyto/core';

import type { Contribution } from './contributions.js';

/**
 * `asset-source` and `font-source`: images and faces a plugin fetches from somewhere that
 * is not this machine (TYTO-280, ADR 0117).
 *
 * The ports that read bytes are synchronous — an exporter walks a scene and `compile`
 * measures text while it builds one — and a network answer never is. So a source is never
 * asked from inside those ports. It is asked once, before them, and what it answers is
 * written to a cache on the host's disk that the synchronous ports read like any other
 * file. A second render reads the cache and asks the plugin nothing.
 *
 * Both are data plus one function, so an installed plugin registers them from its own
 * process: the function stays there and the bytes cross back (ADR 0041).
 */

/**
 * What a source call carries besides the thing asked for.
 *
 * `section` is the plugin's own section of the folder's `.tyto/project.json`, resolved with
 * its work profile (ADR 0112, ADR 0114) — where a Drive-like source learns which folder to
 * read. It rides on every call rather than on activation, because a plugin's process
 * outlives the folder that was open when it started. **Absent when the folder has none or
 * withheld it**: a restricted source never hands a plugin its section (ADR 0111).
 */
export interface SourceRequest {
  readonly section?: unknown;
}

/** An image a source answered: its bytes, and the type they are, which names the cached file. */
export interface SourcedAsset {
  readonly bytes: Uint8Array;
  /** `image/png`, `image/jpeg`, `image/webp`, `image/gif` or `image/svg+xml`. */
  readonly mime: string;
}

/**
 * The most one asset may weigh: the ceiling a file beside a brief already has
 * (`fileResources`). Checked on the wire and again by whatever caches the answer, because
 * an in-process source crosses no wire.
 */
export const ASSET_SOURCE_MAX_BYTES = 32 * 1024 * 1024;

/** The most one face may weigh. A full CJK family's heaviest face is well under it. */
export const FONT_SOURCE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * A scheme as a source declares it and a reference spells it: `drive` in `drive:1AbC`.
 * Two letters at least, so that `C:` in a Windows path is never mistaken for one.
 */
export const SOURCE_SCHEME = /^[a-z][a-z0-9+.-]+$/;

/**
 * The scheme a reference names, or `undefined` for a path.
 *
 * Lowercased, as RFC 3986 compares schemes. `C:\logo.png` and `./logo.png` have none, so a
 * reference that never meant a source is never sent to one.
 */
export function schemeOf(reference: string): string | undefined {
  const colon = reference.indexOf(':');
  if (colon < 2) return undefined;
  const scheme = reference.slice(0, colon).toLowerCase();
  return SOURCE_SCHEME.test(scheme) ? scheme : undefined;
}

/**
 * `asset-source` — the images behind one or more URI schemes.
 *
 * `id` names the contribution and `schemes` what it answers for; a scheme two sources claim
 * goes to the one registered first, as a template name does (ADR 0020).
 */
export interface AssetSourceContribution extends Contribution {
  readonly schemes: readonly string[];
  /**
   * The asset at `reference`, the whole reference, scheme included. An error is the
   * plugin's own explanation and reaches the author as `E_ASSET_SOURCE_FAILED`.
   */
  fetch(
    reference: string,
    request: SourceRequest,
  ): Result<SourcedAsset, Diagnostics> | Promise<Result<SourcedAsset, Diagnostics>>;
}

/**
 * `font-source` — faces of the families it names.
 *
 * Asked only for a face nothing on this machine has (ADR 0117): a face installed locally or
 * in a workspace font folder is always the one drawn, so a render offline is the render
 * online.
 */
export interface FontSourceContribution extends Contribution {
  readonly families: readonly string[];
  /** The face's `.ttf`/`.otf` bytes, the encoding `FontSource.outlines` answers in. */
  fetch(
    face: FontFace,
    request: SourceRequest,
  ): Result<Uint8Array, Diagnostics> | Promise<Result<Uint8Array, Diagnostics>>;
}

/** A source and the plugin that registered it — the cache is kept per plugin. */
export interface OwnedSource<T> {
  readonly plugin: string;
  readonly source: T;
}
