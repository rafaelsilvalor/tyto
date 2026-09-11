import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import type { AssetRef } from '@tyto/core';
import type { JobResources } from '@tyto/pipeline';

/**
 * Bytes for the images a scene draws, as the exporters want them: a data URI, synchronously.
 *
 * The exporters are pure and open no files (ADR 0018), and `resolve`'s `AssetResolver`
 * answers *whether a file exists and what it hashes to*, not what is in it. So somebody
 * has to read the bytes, and on a disk that somebody is here.
 *
 * ## Why this reads the folder up front
 *
 * `HtmlResources.asset` and `SvgResources.asset` are **synchronous** — an exporter walks a
 * scene and cannot await. So the bytes have to be in memory before the job starts. And
 * which assets a scene draws is only known after `compile`, which happens *inside* the
 * job. The two facts do not meet, so this reads the asset folder eagerly instead.
 *
 * That is right for the shape ADR 0011 actually defines — `assets/` is one issue's
 * attachments, a handful of files — and wrong for a shared library of thousands. The
 * proper fix is for the job to resolve resources after `compile`, which is a change to
 * `@tyto/pipeline`'s API and belongs to its own card. Recorded here rather than worked
 * around silently.
 */

/** What a browser needs in the `data:` URI to decode the bytes. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

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
  /** Descend into subfolders. On by default; `assets/logos/x.png` is an ordinary layout. */
  readonly recursive?: boolean;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

async function collect(
  directory: string,
  recursive: boolean,
  maxBytes: number,
  into: Map<string, string>,
): Promise<void> {
  // Annotated rather than inferred: `readdir` is overloaded, and `ReturnType` picks the
  // last overload — the one that returns `Buffer[]` — so an inferred `entry` has no
  // `name`.
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // No folder is not an error: a brief that references no image needs none, and the
    // exporter will name any asset that turns out to be missing.
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await collect(path, recursive, maxBytes, into);
      continue;
    }

    const mime = MIME_BY_EXTENSION[extname(entry.name).toLowerCase()];
    // Only what a document can embed. A `.psd` beside the logo is not an oversight to
    // report; it is a working file that has no business in an export.
    if (mime === undefined) continue;

    const info = await stat(path).catch(() => undefined);
    if (info === undefined || info.size > maxBytes) continue;

    const bytes = await readFile(path).catch(() => undefined);
    if (bytes === undefined) continue;

    into.set(resolve(path), `data:${mime};base64,${bytes.toString('base64')}`);
  }
}

/**
 * Reads the asset folder once and returns resolvers over what it found.
 *
 * Keyed on the absolute path, which is what `fileAssetResolver` puts in `AssetRef.path` —
 * so the lookup is an identity, not a second guess at how a relative reference resolves.
 */
export async function fileResources(options: FileResourcesOptions): Promise<JobResources> {
  const base = resolve(options.base);
  const byPath = new Map<string, string>();
  await collect(base, options.recursive ?? true, options.maxBytes ?? DEFAULT_MAX_BYTES, byPath);

  const asset = (ref: AssetRef): string | undefined =>
    byPath.get(ref.path === undefined ? resolve(base, ref.id) : resolve(ref.path));

  // No `font` resolver: the repo bundles no font yet, so a scene that draws text gets
  // `E_EXPORT_FONT_UNRESOLVED` per frame — which is the honest answer until TYTO-61.
  return { html: { asset }, svg: { asset } };
}
