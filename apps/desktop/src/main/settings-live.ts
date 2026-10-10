import { createHash } from 'node:crypto';

import type { Diagnostics } from '@tyto/core';
import type { DeclaredSetting } from '@tyto/plugin-api';

import type { IpcEventPayload } from '../../shared/ipc.js';
import type { Settings } from '../../shared/settings.js';
import {
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
  /** The tab with this id was closed. */
  closed(documentId: string): void;
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
  let tab: SettingsTab | undefined;
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
    known = hashOf(text);

    const reading = await store.load();
    options.configure(reading.config);
    const next = reading.settings;
    const moved = keysOf(next).filter((key) => !same(next[key], effective[key]));
    effective = next;
    await options.apply(next, moved);
    for (const problem of reading.diagnostics) log.warn(`settings.json: ${problem.message}`);
    log.info('settings.json changed on disk and was applied', { keys: moved });

    // A clean tab follows the disk, the way every editor reverts a file nobody is typing in.
    // A tab with unsaved typing keeps it: the person's next save is their answer.
    if (tab !== undefined && !tab.dirty && tab.text !== text) {
      tab.text = text;
      send({ text, saved: true, refused: false });
    } else {
      send({ saved: false, refused: false });
    }
  };

  return {
    wrote(text) {
      known = hashOf(text);
    },

    validate(documentId, text, dirty) {
      tab = { documentId, text, dirty };
      return validateSettingsText(text, options.declared());
    },

    closed(documentId) {
      if (tab?.documentId === documentId) tab = undefined;
    },

    async remember(changes) {
      if (tab?.dirty === true) {
        const edited = applySettingsChanges(tab.text, changes);
        if (!edited.ok) return refuse(changes, edited.error);
        const base = tab.text;
        tab.text = edited.value;
        effective = { ...effective, ...changes };
        send({ text: edited.value, base, saved: false, refused: false });
        return true;
      }
      const written = await store.write(changes);
      if (!written.ok) return refuse(changes, written.error);
      effective = { ...effective, ...changes };
      if (tab !== undefined) {
        // A clean tab shows what the screen just wrote, and stays clean.
        const text = await options.readText().catch(() => undefined);
        if (text !== undefined && text !== tab.text) {
          tab.text = text;
          send({ text, saved: true, refused: false });
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
