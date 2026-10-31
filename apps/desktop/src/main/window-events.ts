import { type IpcEventName, type IpcEventPayload, parseIpcEvent } from '../../shared/ipc.js';

/**
 * The one door from main to the window (ADR 0029): every push goes through here.
 *
 * **The window is asked whether it is destroyed before its `webContents` is read**, because
 * Electron throws on reading anything off a destroyed `BrowserWindow`, and the read used to come
 * first (`mainWindow?.webContents`, then `isDestroyed()` on what came back). Most pushes never
 * fire that late; a shell's exit does, on Linux, while the app quits, and the throw reached the
 * crash box nobody could answer (TYTO-497). One guarded door instead of a copy of the guard per
 * push, so the next push cannot leave it out.
 *
 * Validated before it is sent, the mirror of `guard`'s reason in `ipc.ts`: main is the side that
 * can refuse a bad push before the process boundary, and a payload the preload rejects would
 * otherwise be a listener that silently never fires. `send` and not `invoke`: a push carries no
 * reply.
 */

/** The part of a `BrowserWindow` this reads: the seam the tests replace. */
export interface EventWindow {
  isDestroyed(): boolean;
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
  };
}

/** Pushes `name` to the window `current` answers; `false` when there is no live window to tell. */
export type WindowEvents = <Name extends IpcEventName>(
  name: Name,
  payload: IpcEventPayload<Name>,
) => boolean;

export function windowEvents(current: () => EventWindow | undefined): WindowEvents {
  return (name, payload) => {
    const window = current();
    if (window === undefined || window.isDestroyed()) return false;
    const contents = window.webContents;
    if (contents.isDestroyed()) return false;
    contents.send(name, parseIpcEvent(name, payload));
    return true;
  };
}
