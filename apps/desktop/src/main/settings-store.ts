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
  /**
   * Changes the keys named and keeps the rest (TYTO-45).
   *
   * A patch rather than the whole record since the file holds more than one preference: the
   * templates folder and the queue folder are set from two different places, and a writer
   * that replaced the record would forget whatever the other one had chosen.
   */
  write(changes: Partial<Settings>): Promise<void>;
}

export function fileSettingsStore(file: string): SettingsStore {
  // One write at a time: two patches racing through read-then-write would each keep the
  // other's old value.
  let chain: Promise<void> = Promise.resolve();

  const read = async (): Promise<Settings> => {
    try {
      return settingsFrom(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      // No file on a first run, unparseable JSON on a hand-edited one. Both mean the same
      // thing here, and `settingsFrom(undefined)` is the built-in pack alone.
      return settingsFrom(undefined);
    }
  };

  const write = async (changes: Partial<Settings>): Promise<void> => {
    try {
      const next: Settings = { ...(await read()), ...changes };
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      // The folder is still searched for this session — `reload` has already happened by
      // the time this is called. What is lost is the memory of it, not the choice.
    }
  };

  return {
    read,
    write: (changes) => {
      const next = chain.then(() => write(changes));
      chain = next;
      return next;
    },
  };
}
