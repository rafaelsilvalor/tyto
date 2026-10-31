import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { type Diagnostics, diagnostic } from '@tyto/core';
import { GALLERY_INDEX_FILE, parseGalleryIndex } from '@tyto/plugin-api';
import { z } from 'zod';

import { git, problemOf } from './plugin-files.js';

/**
 * The gallery on a disk (ADR 0162): fetching the index with the person's `git`, keeping the
 * copy fetched last, and the record of what the gallery wrote into the plugin files.
 *
 * ```
 * TYTO_HOME/cache/gallery/<sha256(index)>/index.yaml   the index as fetched last
 * TYTO_HOME/cache/gallery/<sha256(index)>/previews/    its entries' pictures, when asked for
 * TYTO_HOME/plugin-files/gallery.json                  what the gallery wrote, entry by entry
 * ```
 *
 * **The network is `git`'s** (ADR 0011, ADR 0127): any location the person's `git` reads,
 * with their credentials, and no provider named. It runs through the plugin files' own `git`
 * (`plugin-files.ts`), so the gallery adds no process path (ADR 0159) and a missing credential
 * fails rather than waiting on a prompt the window cannot show.
 */

export const GALLERY_CACHE = join('cache', 'gallery');
/** Beside the plugin files and not one of them: the reader takes `*.yaml` only. */
export const GALLERY_RECORD_FILE = 'gallery.json';

/** Writes beside the name and renames into place, so a reader never sees half a file. */
export async function writeFileAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.${Date.now()}.writing`;
  await writeFile(staging, text, 'utf8');
  try {
    await rename(staging, path);
  } catch (cause) {
    await rm(staging, { force: true });
    throw cause;
  }
}

function cachedIndexPath(home: string, index: string): string {
  return join(
    home,
    GALLERY_CACHE,
    createHash('sha256').update(index).digest('hex'),
    GALLERY_INDEX_FILE,
  );
}

/** Beside the cached index: the entries' pictures, at their paths in the index repository. */
const PREVIEWS = 'previews';

export interface FetchedGalleryIndex {
  /** The index's text; absent when it was never fetched and could not be now. */
  readonly text?: string;
  /** When this text was fetched: now, or the time of the copy kept from before. */
  readonly fetched?: Date;
  /**
   * The pictures kept, by `preview` as the index writes it, to the file on the machine. Only
   * when asked for; an entry whose picture is not in the index's commit has none.
   */
  readonly previews: ReadonlyMap<string, string>;
  readonly diagnostics: Diagnostics;
}

export interface FetchGalleryIndexOptions {
  /** Also keep each entry's `preview` out of the fetched commit, for the window to show. */
  readonly previews?: boolean;
}

/**
 * A `preview` that names a file inside the index repository and nothing else: relative,
 * forward slashes, no `..`, no dash first. It reaches `git` as a path after `--`, read
 * literally, so these rules are what keeps a curator's typo from reading outside the commit.
 */
export function safePreviewPath(preview: string): boolean {
  if (preview.startsWith('-') || preview.startsWith('/') || preview.includes('\\')) return false;
  if (/^[a-z]:/iu.test(preview)) return false;
  return preview.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function previewPaths(text: string, index: string): string[] {
  const entries = parseGalleryIndex(text, index).value?.entries ?? [];
  const paths = entries.flatMap((entry) => (entry.preview === undefined ? [] : [entry.preview]));
  return [...new Set(paths)].filter(safePreviewPath);
}

/**
 * Checks each picture out of FETCH_HEAD in `staging` and replaces the kept pictures with
 * them. One `git checkout` per path, so a picture the commit lacks costs that picture alone.
 * Bytes as committed (`core.autocrlf=false`): a picture is not text.
 */
async function keepPreviews(
  staging: string,
  folder: string,
  paths: readonly string[],
): Promise<void> {
  const next = `${folder}.${process.pid}.${Date.now()}.writing`;
  await mkdir(next, { recursive: true });
  for (const path of paths) {
    try {
      await git(
        [
          '--literal-pathspecs',
          '-c',
          'core.autocrlf=false',
          'checkout',
          '--quiet',
          'FETCH_HEAD',
          '--',
          path,
        ],
        staging,
      );
      await mkdir(dirname(join(next, path)), { recursive: true });
      await copyFile(join(staging, path), join(next, path));
    } catch {
      // Not in the commit: the entry is listed without a picture.
    }
  }
  await rm(folder, { recursive: true, force: true });
  await rename(next, folder);
}

/** The kept pictures that exist, by `preview` as written. */
async function keptPreviews(
  folder: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const kept = new Map<string, string>();
  for (const path of paths) {
    const file = join(folder, path);
    const found = await stat(file).catch(() => undefined);
    if (found?.isFile() === true) kept.set(path, file);
  }
  return kept;
}

/**
 * The index at `index`'s default branch, fetched now or, when that fails, as fetched last.
 *
 * The default branch and not a tag, because the list is what is meant to move; what is pinned
 * is each entry's tag in the plugin file. Only `index.yaml` is read out of the commit
 * (`git show`), and with `previews` the entries' pictures (TYTO-504), so nothing else of the
 * index repository is checked out on the machine.
 */
export async function fetchGalleryIndex(
  home: string,
  index: string,
  options: FetchGalleryIndexOptions = {},
): Promise<FetchedGalleryIndex> {
  const cached = cachedIndexPath(home, index);
  const pictures = join(dirname(cached), PREVIEWS);
  const previewsOf = async (text: string): Promise<ReadonlyMap<string, string>> =>
    options.previews === true ? keptPreviews(pictures, previewPaths(text, index)) : new Map();
  await mkdir(dirname(cached), { recursive: true });
  const staging = await mkdtemp(join(dirname(cached), '.fetching-'));
  let problem: string;
  try {
    await git(['init', '--quiet'], staging);
    await git(['fetch', '--depth', '1', '--quiet', index, 'HEAD'], staging);
    const text = await git(['show', `FETCH_HEAD:${GALLERY_INDEX_FILE}`], staging);
    await writeFileAtomically(cached, text);
    if (options.previews === true) {
      await keepPreviews(staging, pictures, previewPaths(text, index));
    }
    return { text, fetched: new Date(), previews: await previewsOf(text), diagnostics: [] };
  } catch (cause) {
    problem = problemOf(cause);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  try {
    const [text, info] = await Promise.all([readFile(cached, 'utf8'), stat(cached)]);
    return {
      text,
      fetched: info.mtime,
      previews: await previewsOf(text),
      diagnostics: [
        diagnostic('W_GALLERY_INDEX_OFFLINE', {
          index,
          problem,
          fetched: info.mtime.toISOString(),
        }),
      ],
    };
  } catch {
    // Never fetched: there is no earlier copy, and no other list stands in for it.
    return {
      previews: new Map(),
      diagnostics: [diagnostic('E_GALLERY_INDEX_FETCH', { index, problem })],
    };
  }
}

/* -------------------------------------------------------------------------- record -- */

/** One place the gallery wrote: a template in a file of templates, or a file's plugin. */
export interface GalleryWrite {
  /** The plugin file's name inside its folder. */
  readonly file: string;
  readonly template?: string;
  readonly git: string;
  readonly ref: string;
}

/** By entry id, every place the gallery wrote for it, as it wrote it. */
export type GalleryRecord = Readonly<Record<string, readonly GalleryWrite[]>>;

const recordSchema = z.object({
  version: z.literal(1),
  entries: z.record(
    z.string(),
    z.array(
      z.object({
        file: z.string().min(1),
        template: z.string().min(1).optional(),
        git: z.string().min(1),
        ref: z.string().min(1),
      }),
    ),
  ),
});

/**
 * What the gallery wrote into `directory`'s plugin files.
 *
 * A record that is missing or cannot be read is empty: every entry then reads as written by
 * hand, which is the side that says so before it moves anything.
 */
export async function readGalleryRecord(directory: string): Promise<GalleryRecord> {
  try {
    const parsed = recordSchema.safeParse(
      JSON.parse(await readFile(join(directory, GALLERY_RECORD_FILE), 'utf8')),
    );
    if (!parsed.success) return {};
    const record: Record<string, GalleryWrite[]> = {};
    for (const [id, writes] of Object.entries(parsed.data.entries)) {
      record[id] = writes.map(({ file, template, git: location, ref }) => ({
        file,
        ...(template === undefined ? {} : { template }),
        git: location,
        ref,
      }));
    }
    return record;
  } catch {
    return {};
  }
}

/** Sorted by id, so two machines that wrote the same entries write the same bytes. */
export async function writeGalleryRecord(directory: string, record: GalleryRecord): Promise<void> {
  const entries = Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((id) => [id, record[id]]),
  );
  await writeFileAtomically(
    join(directory, GALLERY_RECORD_FILE),
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
  );
}
