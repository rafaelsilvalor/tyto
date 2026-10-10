import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type Diagnostics, type Result, err, ok } from '@tyto/core';
import { type DeclaredSetting, declaredSetting, resolveSettings } from '@tyto/plugin-api';

import {
  DEFAULT_SETTINGS,
  SETTING_CONTRIBUTIONS,
  type Settings,
  settingsFrom,
} from '../../shared/settings.js';
import desktopManifest from './desktop.tyto-plugin.json';
import { editSettingsText, readSettingsText } from './settings-file.js';

/**
 * `settings.json`: a file the person owns and may edit by hand, which the app's own screens
 * also write (TYTO-122, TYTO-206, ADR 0073).
 *
 * A file and not a database (ADR 0009), in `app.getPath('userData')`, on the argument every
 * record here has: a person can read it, delete it, and see exactly what is remembered
 * about them. Since ADR 0073 it is JSON with comments, and three rules keep it theirs:
 *
 * - **Reading never fails**, and is tolerant one key at a time. A hand-broken value costs
 *   that key, which falls back to its default; every problem is a diagnostic with a range.
 * - **Writing edits in place.** Only the keys a screen changed are touched, a key set back
 *   to its default is removed, and every comment and blank line stays where it was.
 * - **A file that does not parse is never written.** The write is refused and answered with
 *   the syntax errors; overwriting it would throw away whatever the person was in the middle
 *   of typing.
 */

/** The settings, and everything reading them had to say. */
export interface SettingsReading {
  readonly settings: Settings;
  /** Every declared key, built-in or a plugin's, by the key the file uses. */
  readonly values: Readonly<Record<string, unknown>>;
  /** The same by plugin id — what `InProcessHost.configure` takes. */
  readonly config: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly diagnostics: Diagnostics;
}

export interface SettingsStore {
  read(): Promise<Settings>;
  /** {@link read}, with the diagnostics and the plugins' values. */
  load(): Promise<SettingsReading>;
  /**
   * Changes the keys named and keeps the rest (TYTO-45).
   *
   * An error, with the file untouched, when the file on disk does not parse. A disk that will
   * not take the write is still silent, as it always was: the choice holds for this session
   * and only the memory of it is lost.
   */
  write(changes: Partial<Settings>): Promise<Result<void, Diagnostics>>;
}

/** The built-in `desktop` plugin's four, for a store composed without a plugin host. */
export const BUILT_IN_SETTINGS: readonly DeclaredSetting[] = SETTING_CONTRIBUTIONS.map(
  (contribution) => declaredSetting(desktopManifest.name, false, contribution),
);

export function fileSettingsStore(
  file: string,
  declared: () => readonly DeclaredSetting[] = () => BUILT_IN_SETTINGS,
): SettingsStore {
  // One write at a time: two patches racing through read-then-write would each keep the
  // other's old value.
  let chain: Promise<unknown> = Promise.resolve();

  const text = async (): Promise<string> => {
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      // No file on a first run is an empty one. Anything else — a folder where the file
      // should be, a permission — is not known to be empty, so it must not be written over.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  };

  const load = async (): Promise<SettingsReading> => {
    let source = '';
    try {
      source = await text();
    } catch {
      // Unreadable reads as empty; reading never fails.
    }
    const { entries, syntax } = readSettingsText(source);
    const resolved = resolveSettings(declared(), entries);
    return {
      settings: settingsFrom(resolved.values),
      values: resolved.values,
      config: resolved.config,
      diagnostics: [...syntax, ...resolved.diagnostics],
    };
  };

  const write = async (changes: Partial<Settings>): Promise<Result<void, Diagnostics>> => {
    let source: string;
    try {
      source = await text();
    } catch {
      return ok(undefined);
    }
    const { syntax } = readSettingsText(source);
    if (syntax.length > 0) return err(syntax);

    const edits: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      const fallback = DEFAULT_SETTINGS[key as keyof Settings];
      // Only what differs from the default is written: the file is what the person chose,
      // not a dump of what the app assumes.
      edits[key] = JSON.stringify(value) === JSON.stringify(fallback) ? undefined : value;
    }
    const next = editSettingsText(source, edits);
    if (next === source || (source === '' && next.replace(/\s/gu, '') === '{}')) {
      return ok(undefined);
    }
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, next, 'utf8');
    } catch {
      // The folder is still searched for this session — `reload` has already happened by
      // the time this is called. What is lost is the memory of it, not the choice.
    }
    return ok(undefined);
  };

  return {
    read: async () => (await load()).settings,
    load,
    write: (changes) => {
      const next = chain.then(() => write(changes));
      chain = next;
      return next;
    },
  };
}
