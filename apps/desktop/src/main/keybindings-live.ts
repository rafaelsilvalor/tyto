import { createHash } from 'node:crypto';

import type { IpcEventPayload } from '../../shared/ipc.js';

/**
 * `keybindings.json` while the app runs (TYTO-207, ADR 0074): main watches the file and tells
 * the window what it now says; the window parses it and resolves the table.
 *
 * `settings-live.ts`'s pattern without its writers. The app writes this file once, when it
 * creates it, and never again — so there is no screen's change to merge, no dirty tab to route
 * one into and no refused write. What is left is the watcher's half: read the file again after
 * a burst of events, and push it only when its text moved.
 */

export interface LiveKeybindingsOptions {
  /** The file's text as it is now, or `''` when there is none. */
  readonly readText: () => Promise<string>;
  /** The `keybindings:changed` push to the window. */
  readonly send: (payload: IpcEventPayload<'keybindings:changed'>) => void;
  readonly log: {
    info(message: string, detail?: unknown): void;
  };
}

export interface LiveKeybindings {
  /** The file's text for the window's first read; also what later events are compared with. */
  read(): Promise<string>;
  /** Called by whoever creates the file, so its own creation is not pushed as a change. */
  wrote(text: string): void;
  /** The watcher saw the file move. Reads it, and pushes it unless the text is the same. */
  changed(): Promise<void>;
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

export function createLiveKeybindings(options: LiveKeybindingsOptions): LiveKeybindings {
  // The text the window last heard, by hash. An editor's save is often two or three events
  // with the same bytes, and a push per event would resolve the same table each time.
  let known: string | undefined;
  // One reaction at a time, so two readings never cross on their way to the window.
  let chain: Promise<void> = Promise.resolve();

  const react = async (): Promise<void> => {
    let text: string;
    try {
      text = await options.readText();
    } catch {
      return;
    }
    if (known !== undefined && hashOf(text) === known) return;
    known = hashOf(text);
    options.log.info('keybindings.json changed on disk and was sent to the window');
    options.send({ text });
  };

  return {
    async read() {
      const text = await options.readText();
      known = hashOf(text);
      return text;
    },

    wrote(text) {
      known = hashOf(text);
    },

    changed() {
      const next = chain.then(react, react);
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
