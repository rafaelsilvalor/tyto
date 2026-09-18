import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type Settings, settingsFrom } from '../../shared/settings.js';

/**
 * The template folder, remembered across restarts, in a JSON file beside the other three
 * (TYTO-122).
 *
 * A file and not a database (ADR 0009), in `app.getPath('userData')`, for the fourth time in
 * this app and on the same argument every time: a person can read it, delete it, and see
 * exactly what is being remembered about them.
 *
 * A line-for-line sibling of `layout-store.ts`, deliberately. The two do the same job on two
 * records and the shape is the argument: **reading never fails** and **writing never
 * shouts**. A first run has no file; a hand-edited one may be nonsense; a read-only disk
 * costs a person the memory of a choice and must not cost them the session.
 */

export interface SettingsStore {
  read(): Promise<Settings>;
  write(settings: Settings): Promise<void>;
}

export function fileSettingsStore(file: string): SettingsStore {
  return {
    read: async () => {
      try {
        return settingsFrom(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        // No file on a first run, unparseable JSON on a hand-edited one. Both mean the same
        // thing here, and `settingsFrom(undefined)` is the built-in pack alone.
        return settingsFrom(undefined);
      }
    },

    write: async (settings) => {
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(settings, null, 2), 'utf8');
      } catch {
        // The folder is still searched for this session — `reload` has already happened by
        // the time this is called. What is lost is the memory of it, not the choice.
      }
    },
  };
}
