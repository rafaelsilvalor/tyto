import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { type Diagnostics, diagnostic } from '@tyto/core';
import { GALLERY_INDEX_FILE } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The gallery on a disk (ADR 0162): fetching the index with the person's `git`, keeping the
 * copy fetched last, and the record of what the gallery wrote into the plugin files.
 *
 * ```
 * TYTO_HOME/cache/gallery/<sha256(index)>/index.yaml   the index as fetched last
 * TYTO_HOME/plugin-files/gallery.json                  what the gallery wrote, entry by entry
 * ```
 *
 * **The network is `git`'s** (ADR 0011, ADR 0127): any location the person's `git` reads,
 * with their credentials, and no provider named. `GIT_TERMINAL_PROMPT=0`, as a sync runs it,
 * so a missing credential fails rather than waiting on a prompt the window cannot show.
 */

export const GALLERY_CACHE = join('cache', 'gallery');
/** Beside the plugin files and not one of them: the reader takes `*.yaml` only. */
export const GALLERY_RECORD_FILE = 'gallery.json';

const run = promisify(execFile);

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', [...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** git's first line of complaint, which is the line that says what went wrong. */
function problemOf(cause: unknown): string {
  const stderr = (cause as { readonly stderr?: unknown } | undefined)?.stderr;
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    return stderr.trim().split('\n')[0]?.trim() ?? '';
  }
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause);
}

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

export interface FetchedGalleryIndex {
  /** The index's text; absent when it was never fetched and could not be now. */
  readonly text?: string;
  /** When this text was fetched: now, or the time of the copy kept from before. */
  readonly fetched?: Date;
  readonly diagnostics: Diagnostics;
}

/**
 * The index at `index`'s default branch, fetched now or, when that fails, as fetched last.
 *
 * The default branch and not a tag, because the list is what is meant to move; what is pinned
 * is each entry's tag in the plugin file. Only `index.yaml` is read out of the commit
 * (`git show`), so nothing of the index repository is checked out on the machine.
 */
export async function fetchGalleryIndex(home: string, index: string): Promise<FetchedGalleryIndex> {
  const cached = cachedIndexPath(home, index);
  await mkdir(dirname(cached), { recursive: true });
  const staging = await mkdtemp(join(dirname(cached), '.fetching-'));
  let problem: string;
  try {
    await git(['init', '--quiet'], staging);
    await git(['fetch', '--depth', '1', '--quiet', index, 'HEAD'], staging);
    const text = await git(['show', `FETCH_HEAD:${GALLERY_INDEX_FILE}`], staging);
    await writeFileAtomically(cached, text);
    return { text, fetched: new Date(), diagnostics: [] };
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
    return { diagnostics: [diagnostic('E_GALLERY_INDEX_FETCH', { index, problem })] };
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
