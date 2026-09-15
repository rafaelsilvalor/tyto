import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import type { AssetRef, SceneResources, Size } from '@tyto/core';
import type { ExportResources } from './export-resources.js';

import { imageSize } from './image-size.js';
import { EMBEDDABLE_MIME, dataUri } from './mime.js';

/**
 * Bytes for the images a scene draws, as the exporters want them: a data URI, synchronously.
 *
 * The exporters are pure and open no files (ADR 0018), and `resolve`'s `AssetResolver`
 * answers *whether a file exists and what it hashes to*, not what is in it. So somebody
 * has to read the bytes, and on a disk that somebody is here.
 *
 * ## Why the store is filled late
 *
 * `HtmlResources.asset` and `SvgResources.asset` are **synchronous** — an exporter walks a
 * scene and cannot await — so the bytes have to be in memory before the first walk. And
 * which assets a scene draws is only known after `compile`, which happens *inside* the job.
 *
 * This used to resolve the contradiction by reading the whole asset folder before the job
 * started: right for the shape ADR 0011 defines, where `assets/` is one issue's
 * attachments, and wrong for a shared library of thousands, where it read a thousand files
 * to use two. `runJob` now has a `loadResources` port that runs between `compile` and the
 * first export, so the question can be asked of the scene instead. `load` is what answers
 * it, and the store the resolvers read is filled by the time anything calls them.
 *
 * The resolvers are handed out before the store has anything in it, which is the one thing
 * to know about this file. That is not a race: nothing calls an exporter until the job has
 * awaited `load`, and the two ends are wired in the same composition root.
 */

export interface FileResourcesOptions {
  /** The folder to read — a task's `assets/`, normally `BriefTask.assetBase`. */
  readonly base: string;
  /**
   * Per-file ceiling, 32 MB by default.
   *
   * A file over it is left unresolved rather than loaded, so the exporter reports
   * `E_EXPORT_ASSET_UNRESOLVED` **naming the asset** — which tells an author which file to
   * shrink. Loading it instead would embed a 300 MB base64 string into a document and
   * fail somewhere far less legible.
   */
  readonly maxBytes?: number;
}

/** The resolvers an exporter is registered with, plus the call that fills what they read. */
export interface FileResources extends ExportResources {
  /**
   * Reads exactly the assets `needed` names, and nothing else in the folder.
   *
   * Safe to call more than once: a second call re-reads, which is what a `tyto watch`
   * rendering the same task twice should do.
   *
   * `needed.faces` is accepted and ignored, and that is now a statement about this folder
   * rather than about the repository. The faces Tyto ships are answered by `@tyto/fonts`,
   * which the composition root binds straight to the exporters' `font` port — they are the
   * same bytes for every task, so there is nothing for a per-task loader to do (ADR 0021).
   * What is left here is a `FontRef { source: 'file' }`, a font beside the brief, and
   * nothing loads one yet: such a scene still gets `E_EXPORT_FONT_UNRESOLVED` per frame,
   * which is the honest answer until something does.
   */
  readonly load: (needed: SceneResources) => Promise<void>;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Where an `AssetRef` points, absolute.
 *
 * `path` is what `fileAssetResolver` puts there, so the lookup is an identity rather than a
 * second guess at how a relative reference resolves. A ref without one — an `inline` or a
 * hand-built scene — is read relative to the folder, which is what its `id` means there.
 */
function pathOf(base: string, ref: AssetRef): string {
  return ref.path === undefined ? resolve(base, ref.id) : resolve(ref.path);
}

/** A file as the exporters want it: a URI to embed, and the size the picture really is. */
interface Loaded {
  readonly uri: string;
  readonly size: Size | undefined;
}

async function readOne(path: string, maxBytes: number): Promise<Loaded | undefined> {
  // Only what a document can embed. A `.psd` beside the logo is not an oversight to
  // report; it is a working file that has no business in an export.
  const mime = EMBEDDABLE_MIME[extname(path).toLowerCase()];
  if (mime === undefined) return undefined;

  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size > maxBytes) return undefined;

  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined) return undefined;
  // Measured here because the bytes are here. `export-svg` crops a `cover` image itself
  // rather than leaving it to `preserveAspectRatio`, which Figma drops (TYTO-60), and the
  // arithmetic needs the picture's own proportions. A header nothing parses is left
  // unmeasured rather than guessed, and that export falls back to the attribute.
  return { uri: dataUri(mime, bytes), size: imageSize(bytes) };
}

/**
 * Resolvers over a task's asset folder, filled by `load` once the scene is known.
 *
 * Not async any more, and that is the point: there is nothing to do until somebody says
 * what the scene needs.
 */
export function fileResources(options: FileResourcesOptions): FileResources {
  const base = resolve(options.base);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const byPath = new Map<string, Loaded>();

  const load = async (needed: SceneResources): Promise<void> => {
    // Sequential rather than in parallel: an asset list is a handful of files, and a
    // `Promise.all` over an unbounded one would open every descriptor at once — the
    // failure mode this card exists to remove, in a different disguise.
    for (const ref of needed.assets) {
      const path = pathOf(base, ref);
      const loaded = await readOne(path, maxBytes);
      // A miss is left out rather than stored as undefined, so the exporter reports
      // `E_EXPORT_ASSET_UNRESOLVED` naming it. No folder and no file are the same answer
      // here: a brief that references an image that is not there has one problem, and it
      // is the exporter's to name.
      if (loaded !== undefined) byPath.set(path, loaded);
    }
  };

  const asset = (ref: AssetRef): string | undefined => byPath.get(pathOf(base, ref))?.uri;
  const assetSize = (ref: AssetRef): Size | undefined => byPath.get(pathOf(base, ref))?.size;

  // `assetSize` goes to the SVG half only. HTML has `object-fit`, which is the browser
  // doing the same arithmetic correctly, so there is nothing for the number to fix there.
  return { html: { asset }, svg: { asset, assetSize }, load };
}
