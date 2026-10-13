import { createHash } from 'node:crypto';

/**
 * A file the window reads while the app runs: `keybindings.json` (TYTO-207, ADR 0074) and
 * `snippets.json` (TYTO-277, ADR 0082). Main watches the file and tells the window what it now
 * says; the window parses it, because what it is checked against lives there.
 *
 * `settings-live.ts`'s pattern without its writers. The app writes this file once, when it
 * creates it, and never again — so there is no screen's change to merge, no dirty tab to route
 * one into and no refused write; `snippets.json` is the same. What is left is the watcher's half: read the file again after
 * a burst of events, and push it only when its text moved.
 */

export interface LiveTextFileOptions {
  /** The file's text as it is now, or `''` when there is none. */
  readonly readText: () => Promise<string>;
  /** The file's push to the window, `keybindings:changed` or `snippets:changed`. */
  readonly send: (payload: { readonly text: string }) => void;
  readonly log: {
    info(message: string, detail?: unknown): void;
  };
}

export interface LiveTextFile {
  /** The file's text for the window's first read; also what later events are compared with. */
  read(): Promise<string>;
  /** Called by whoever creates the file, so its own creation is not pushed as a change. */
  wrote(text: string): void;
  /** The watcher saw the file move. Reads it, and pushes it unless the text is the same. */
  changed(): Promise<void>;
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

export function createLiveTextFile(name: string, options: LiveTextFileOptions): LiveTextFile {
  // The text the window last heard, by hash. An editor's save is often two or three events
  // with the same bytes, and a push per event would make the window read the same file again.
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
    options.log.info(`${name} changed on disk and was sent to the window`);
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
