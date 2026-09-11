import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import type { AssetRef } from '@tyto/core';
import type { ExportResources } from './export-resources.js';
import type { TemplateAssets } from '@tyto/template-lang';

import { hashOf } from './hash.js';
import { EMBEDDABLE_MIME, dataUri } from './mime.js';

/**
 * The files beside `template.html` that its `src=` attributes name.
 *
 * `template-lang` is pure and reads nothing (`docs/template-authoring.md`: *resolved by
 * whoever loaded the template*), and `markupTemplateSource` in `@tyto/pipeline` leaves the
 * job to whoever composes it. On a disk that is here — the same place the brief's assets
 * are read, for the same reason.
 *
 * ## Why this reads the folder up front
 *
 * `TemplateAssets.svg` and `TemplateAssets.image` are **synchronous**: the template
 * function runs inside `compile` and cannot await. So does `HtmlResources.asset`, which
 * needs the bytes of any `<image src="…">` the template drew. The folder is a template's
 * own — a logo, a badge, a background — so reading it is reading a handful of files. The
 * same caveat `file-resources.ts` records applies and for the same reason.
 *
 * ## Two answers about one file
 *
 * A `<vector src="logo.svg">` wants the markup and a `<image src="logo.png">` wants an
 * `AssetRef` plus, later, the bytes behind it. They are returned together because they are
 * one walk of one folder, and because handing back an `AssetRef` whose bytes nobody loaded
 * would produce `E_EXPORT_ASSET_UNRESOLVED` at the far end of the pipeline — a template
 * author's file, reported as if the brief had gone wrong.
 */

export interface FileTemplateAssetsOptions {
  /** The template's folder — what `src=` paths are relative to. */
  readonly base: string;
  /** Per-file ceiling, 32 MB by default. See {@link FileResourcesOptions.maxBytes}. */
  readonly maxBytes?: number;
  /** Descend into subfolders. On by default; `assets/logo.svg` is the documented layout. */
  readonly recursive?: boolean;
}

export interface FileTemplateAssets {
  /** Hand to `markupTemplateSource({ assets })`. */
  readonly assets: TemplateAssets;
  /**
   * Hand to the job so the exporters can embed what the template drew.
   *
   * Only covers this folder. A render also has the brief's assets, and composing the two
   * is the composition root's call — which of the two wins for a path they both answer is
   * not something either adapter can decide alone.
   */
  readonly resources: ExportResources;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * `assets\\logo.svg` and `./assets/logo.svg` both name what the template wrote as
 * `assets/logo.svg`. A template is text and always uses forward slashes; the filesystem
 * this ran on is the one with an opinion.
 */
function templatePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

interface Entry {
  readonly absolute: string;
  readonly bytes: Buffer;
  readonly mime: string;
}

async function collect(
  directory: string,
  base: string,
  recursive: boolean,
  maxBytes: number,
  into: Map<string, Entry>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // A template with no `src` needs no folder beside it, and a folder that is not there
    // is not a failure to report — an unresolved path is, and `template-lang` reports it.
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await collect(path, base, recursive, maxBytes, into);
      continue;
    }

    // `manifest.yaml`, `template.html`, `preview.png`'s neighbours — only what a document
    // can embed is worth holding in memory.
    const mime = EMBEDDABLE_MIME[extname(entry.name).toLowerCase()];
    if (mime === undefined) continue;

    const info = await stat(path).catch(() => undefined);
    if (info === undefined || info.size > maxBytes) continue;

    const bytes = await readFile(path).catch(() => undefined);
    if (bytes === undefined) continue;

    into.set(templatePath(relative(base, path)), { absolute: path, bytes, mime });
  }
}

export async function fileTemplateAssets(
  options: FileTemplateAssetsOptions,
): Promise<FileTemplateAssets> {
  const base = resolve(options.base);
  const byPath = new Map<string, Entry>();
  await collect(
    base,
    base,
    options.recursive ?? true,
    options.maxBytes ?? DEFAULT_MAX_BYTES,
    byPath,
  );

  const byAbsolute = new Map<string, Entry>();
  for (const entry of byPath.values()) byAbsolute.set(entry.absolute, entry);

  const assets: TemplateAssets = {
    svg: (path) => {
      const entry = byPath.get(templatePath(path));
      return entry?.mime === 'image/svg+xml' ? entry.bytes.toString('utf8') : undefined;
    },
    image: (path): AssetRef | undefined => {
      const entry = byPath.get(templatePath(path));
      if (entry === undefined) return undefined;
      return {
        // The path as the template wrote it, so a diagnostic and a `Scene.assets` entry
        // both say what the file says rather than an absolute path from this machine.
        id: templatePath(path),
        source: 'file',
        path: entry.absolute,
        hash: hashOf(entry.bytes),
      };
    },
  };

  const asset = (ref: AssetRef): string | undefined => {
    const entry =
      ref.path === undefined ? byPath.get(templatePath(ref.id)) : byAbsolute.get(resolve(ref.path));
    return entry === undefined ? undefined : dataUri(entry.mime, entry.bytes);
  };

  return { assets, resources: { html: { asset }, svg: { asset } } };
}
