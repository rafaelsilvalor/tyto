import { createHash } from 'node:crypto';

import type { Diagnostics } from '@tyto/core';
import type { DeclaredSetting } from '@tyto/plugin-api';

import type { IpcEventPayload } from '../../shared/ipc.js';
import type { Settings } from '../../shared/settings.js';
import {
  type SettingsAdvice,
  type SettingsReading,
  type SettingsStore,
  applySettingsChanges,
  validateSettingsText,
} from './settings-store.js';

/**
 * `settings.json` while the app runs: the settings tab, the screens and the file on disk as
 * three writers of one file (TYTO-206, ADR 0073 decision 8).
 *
 * - **A save applies with no restart.** Whatever wrote the file — the tab, another editor — the
 *   watcher reads it again, hands the plugins their values and applies only the keys whose
 *   effective value moved.
 * - **The app's own write is not a change.** The hash of the text the app last knew to be on
 *   disk is kept, and a watcher event that finds that text is ignored, so a screen's write
 *   never comes back as a reload.
 * - **An open tab with unsaved typing takes a screen's change instead of the disk**, so neither
 *   the typing nor the screen's choice is lost when the tab is saved.
 * - **No edit is lost to the gaps between the writers (TYTO-255).** Text that reaches the disk
 *   while the window may hold typing — a screen's write to a tab main still thinks clean, or
 *   another editor's save under a dirty tab — travels with the `base` it was made from, and
 *   the window moves the typing onto it. A screen's change put into a dirty tab is also kept
 *   here, and written to the file if the tab closes without saving.
 * - **A refused write is said and undone.** A file (or buffer) that does not parse refuses a
 *   screen's change; the screens go back to the effective value and the window is told, which
 *   opens the tab where the syntax error is shown.
 */

/** What main last heard from the settings tab, if one is open. */
interface SettingsTab {
  readonly documentId: string;
  text: string;
  dirty: boolean;
}

export interface LiveSettingsOptions {
  readonly store: SettingsStore;
  readonly declared: () => readonly DeclaredSetting[];
  /** What the tab is told about accepted values beyond their schemas (TYTO-301). */
  readonly advise?: SettingsAdvice;
  /** The settings in effect when the app started. */
  readonly initial: Settings;
  /** The file's text as it is now, or `''` when there is none. */
  readonly readText: () => Promise<string>;
  /** Puts the named keys of `next` into effect: the folder searched, the queue. */
  readonly apply: (next: Settings, keys: readonly (keyof Settings)[]) => Promise<void>;
  /** Hands the plugins their values (`InProcessHost.configure`). */
  readonly configure: (config: SettingsReading['config']) => void;
  /** The `settings:changed` push to the window. */
  readonly send: (payload: IpcEventPayload<'settings:changed'>) => void;
  readonly log: {
    info(message: string, detail?: unknown): void;
    warn(message: string, detail?: unknown): void;
  };
}

export interface LiveSettings {
  /** Called by the store before every write it makes, and by whoever creates the file. */
  wrote(text: string): void;
  /** The tab's buffer, checked against what the plugins declared; also records its state. */
  validate(documentId: string, text: string, dirty: boolean): Diagnostics;
  /**
   * The tab with this id was closed. A screen's changes it held unsaved are written to the
   * file then, so closing without saving discards only the person's typing. The same holds
   * for a session that ends with the tab open (TYTO-113). `true` when the file was written.
   */
  closed(documentId: string): Promise<boolean>;
  /** A screen's change. `false` when it was refused, after the screens went back. */
  remember(changes: Partial<Settings>): Promise<boolean>;
  /** The watcher saw the file move. Reads it, and applies it unless it was the app's write. */
  changed(): Promise<void>;
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

const keysOf = (changes: Partial<Settings>): (keyof Settings)[] =>
  Object.keys(changes) as (keyof Settings)[];

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export function createLiveSettings(options: LiveSettingsOptions): LiveSettings {
  const { store, log, send } = options;
  let effective = options.initial;
  // The text the app knows is on disk: what it wrote, or what it last applied. Undefined until
  // either happens, so the first event after launch is read and applied like any other.
  let known: string | undefined;
  // That text itself: the base the window moves its typing from when the disk changes under
  // it. Undefined for the same reason as the hash; the window then uses its own saved text.
  let disk: string | undefined;
  let tab: SettingsTab | undefined;
  // A screen's changes put into the tab's unsaved buffer since it was last clean. They are in
  // effect already; the file gets them when the tab is saved, or when it closes without that.
  let pendingFromScreens: Partial<Settings> = {};
  // One reaction at a time: a burst of watcher events must not apply two readings at once.
  let chain: Promise<void> = Promise.resolve();

  const refuse = async (changes: Partial<Settings>, problems: Diagnostics): Promise<false> => {
    log.warn('settings.json was not written, because it does not parse', {
      changes,
      problems: problems.map((problem) => problem.message),
    });
    // The screen already showed the new value; the session goes back to the one in effect, so
    // nothing on screen claims a value that was not saved.
    await options.apply(effective, keysOf(changes));
    send({ saved: false, refused: true });
    return false;
  };

  const react = async (): Promise<void> => {
    let text: string;
    try {
      text = await options.readText();
    } catch {
      return;
    }
    if (known !== undefined && hashOf(text) === known) return;
    const before = disk;
    known = hashOf(text);
    disk = text;

    const reading = await store.load();
    options.configure(reading.config);
    const next = reading.settings;
    const moved = keysOf(next).filter((key) => !same(next[key], effective[key]));
    effective = next;
    await options.apply(next, moved);
    for (const problem of reading.diagnostics) log.warn(`settings.json: ${problem.message}`);
    log.info('settings.json changed on disk and was applied', { keys: moved });

    if (tab === undefined || tab.text === text) {
      // The tab's own save (the buffer main last heard is what is on disk now): whatever a
      // screen had put into it has reached the file.
      if (tab !== undefined) pendingFromScreens = {};
      send({ saved: false, refused: false });
    } else if (!tab.dirty) {
      // A clean tab follows the disk, the way every editor reverts a file nobody is typing in.
      tab.text = text;
      send({ text, saved: true, refused: false });
    } else {
      // A tab with unsaved typing gets the new text with the one it replaced, and moves the
      // typing onto it: the next save keeps both, with no conflict to answer (TYTO-255).
      send({
        text,
        ...(before === undefined ? {} : { base: before }),
        saved: true,
        refused: false,
      });
    }
  };

  return {
    wrote(text) {
      known = hashOf(text);
      disk = text;
    },

    validate(documentId, text, dirty) {
      tab = { documentId, text, dirty };
      // Clean means saved or reverted: either way the buffer no longer holds a screen's change
      // the file lacks, and writing one on close would undo the person's own choice.
      if (!dirty) pendingFromScreens = {};
      return validateSettingsText(text, options.declared(), options.advise);
    },

    async closed(documentId) {
      if (tab?.documentId !== documentId) return false;
      tab = undefined;
      const pending = pendingFromScreens;
      pendingFromScreens = {};
      if (keysOf(pending).length === 0) return false;
      // Closing without saving discards the typing, never a screen's choice: that is in effect
      // already, and here it reaches the file, in place, comments kept.
      const written = await store.write(pending);
      if (!written.ok) {
        log.warn("settings.json was not given the screens' changes on close: it does not parse", {
          changes: pending,
        });
      }
      return written.ok;
    },

    async remember(changes) {
      if (tab?.dirty === true) {
        const edited = applySettingsChanges(tab.text, changes);
        if (!edited.ok) return refuse(changes, edited.error);
        const base = tab.text;
        tab.text = edited.value;
        effective = { ...effective, ...changes };
        pendingFromScreens = { ...pendingFromScreens, ...changes };
        send({ text: edited.value, base, saved: false, refused: false });
        return true;
      }
      const written = await store.write(changes);
      if (!written.ok) return refuse(changes, written.error);
      effective = { ...effective, ...changes };
      if (tab !== undefined) {
        // A clean tab shows what the screen just wrote, and stays clean. Clean as far as main
        // knows: the window says it is dirty only on the preview's pause, so it may already
        // hold typing. The base is the buffer this was written from, which the window moves
        // that typing past instead of dropping the screen's change (TYTO-255).
        const text = await options.readText().catch(() => undefined);
        if (text !== undefined && text !== tab.text) {
          const base = tab.text;
          tab.text = text;
          send({ text, base, saved: true, refused: false });
        }
      }
      return true;
    },

    changed() {
      const next = chain.then(react, react);
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
