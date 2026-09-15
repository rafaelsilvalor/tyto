import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

/**
 * The files this app has opened, newest first, in a JSON file beside the credential store.
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
 */

const entrySchema = z.object({ path: z.string().min(1), name: z.string().min(1) });
const fileSchema = z.object({ files: z.array(entrySchema).max(200) });

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
 * shortens what a person sees.
 */
export const RECENT_LIMIT = 10;

export interface RecentFiles {
  list(): Promise<readonly RecentEntry[]>;
  /** Moves `entry` to the front, or adds it. Returns the list as it now stands. */
  remember(entry: RecentEntry): Promise<readonly RecentEntry[]>;
  /** Whether this app ever offered that path, which is what makes reopening it safe. */
  knows(path: string): Promise<boolean>;
}

export function fileRecentFiles(file: string): RecentFiles {
  const read = async (): Promise<RecentEntry[]> => {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      return parsed.success ? [...parsed.data.files] : [];
    } catch {
      return [];
    }
  };

  return {
    list: read,

    remember: async (entry) => {
      // Compared by path and not by name: two campaigns both called `campanha.brief` in
      // different folders are two entries, and opening one must not evict the other.
      const kept = (await read()).filter((existing) => existing.path !== entry.path);
      const files = [entry, ...kept].slice(0, RECENT_LIMIT);

      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ files }, null, 2), 'utf8');
      } catch {
        // A disk that will not take the list is not a reason to refuse the file the person
        // just opened. They lose the memory of it, not the document.
      }

      return files;
    },

    knows: async (path) => (await read()).some((entry) => entry.path === path),
  };
}
