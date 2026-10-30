import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

/**
 * The files and the workspace folders this app has opened, newest first, each list in a JSON
 * file beside the credential store.
 *
 * A file and not a database (ADR 0009), and the same folder the ciphertext goes in —
 * `app.getPath('userData')`. A person can read it, delete it, and see what the app
 * remembers about them, which is the whole argument ADR 0009 makes.
 *
 * **Nothing here fails loudly.** A recent list is a convenience: an unreadable file, a file
 * somebody hand-edited into nonsense, a folder that cannot be written — every one of them
 * is answered with "then there are no recent files" rather than with a dialog in front of
 * an app that has not opened yet. The one thing that would be worse than forgetting the
 * list is refusing to start because of it.
 *
 * One list and two files (TYTO-487): the folders are the files' rules exactly, with their own
 * key so `recent-files.json` from an older release still reads.
 */

const entrySchema = z.object({ path: z.string().min(1), name: z.string().min(1) });

export interface RecentEntry {
  readonly path: string;
  readonly name: string;
}

/**
 * How many are kept.
 *
 * Ten, because the list is shown in the command bar next to every other command, and a
 * palette where two thirds of the rows are files somebody opened last month is a worse
 * palette. The cap is applied on write, so shortening it in a later release actually
 * shortens what a person sees. The folders' popover keeps the same ten (TYTO-487).
 */
export const RECENT_LIMIT = 10;

export interface RecentFiles {
  list(): Promise<readonly RecentEntry[]>;
  /** Moves `entry` to the front, or adds it. Returns the list as it now stands. */
  remember(entry: RecentEntry): Promise<readonly RecentEntry[]>;
  /** Whether this app ever offered that path, which is what makes reopening it safe. */
  knows(path: string): Promise<boolean>;
}

/** The workspace folders opened, by the same rules (TYTO-487). */
export type RecentFolders = RecentFiles;

interface RecentListOptions {
  /** The key the entries sit under in the file: `files` or `folders`. */
  readonly key: string;
  /** Whether two paths are one entry. */
  readonly samePath: (left: string, right: string) => boolean;
}

function recentList(file: string, options: RecentListOptions): RecentFiles {
  const fileSchema = z.object({ [options.key]: z.array(entrySchema).max(200) });

  const read = async (): Promise<RecentEntry[]> => {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      return parsed.success ? [...(parsed.data[options.key] ?? [])] : [];
    } catch {
      return [];
    }
  };

  return {
    list: read,

    remember: async (entry) => {
      // Compared by path and not by name: two campaigns both called `campanha.brief` in
      // different folders are two entries, and opening one must not evict the other.
      const kept = (await read()).filter(
        (existing) => !options.samePath(existing.path, entry.path),
      );
      const entries = [entry, ...kept].slice(0, RECENT_LIMIT);

      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ [options.key]: entries }, null, 2), 'utf8');
      } catch {
        // A disk that will not take the list is not a reason to refuse the file the person
        // just opened. They lose the memory of it, not the document.
      }

      return entries;
    },

    knows: async (path) => (await read()).some((entry) => options.samePath(entry.path, path)),
  };
}

export function fileRecentFiles(file: string): RecentFiles {
  return recentList(file, { key: 'files', samePath: (left, right) => left === right });
}

/**
 * The folders, in `recent-folders.json`. **On Windows two spellings of one folder are one
 * entry** — a picker may answer `C:\x` and a restored session `c:\X` — so the comparison ignores
 * case there, as `pathLabelOf` does; elsewhere case is part of the name.
 */
export function fileRecentFolders(
  file: string,
  platform: NodeJS.Platform = process.platform,
): RecentFolders {
  const windows = platform === 'win32';
  return recentList(file, {
    key: 'folders',
    samePath: (left, right) =>
      windows ? left.toLowerCase() === right.toLowerCase() : left === right,
  });
}
