import { contextBridge, ipcRenderer } from 'electron';

import { type IpcChannelName } from '../../shared/ipc.js';
import { createBridge } from './bridge.js';

/**
 * The bridge, and the only thing the renderer can reach outside its own page.
 *
 * With `contextIsolation: true` this script runs in a world of its own: it can see Electron
 * and the page cannot see it, and what crosses is whatever `exposeInMainWorld` copies —
 * structured-cloned, so a function or a prototype cannot be smuggled across. That is the
 * mechanism ADR 0001 is buying. What `bridge.ts` adds is that the surface is *typed and
 * validated*, not just narrow.
 *
 * This file is the two lines that need Electron, and nothing else, so that everything that
 * does not need Electron can be tested without it.
 *
 * **The object is not frozen here.** `exposeInMainWorld` copies it into the page's world and
 * what lands there is already frozen — measured, by removing an `Object.freeze` that used to
 * be on this line and watching nothing change. Freezing the original would have looked like
 * the reason the copy is immutable, which is a comment the next reader would have believed.
 */

/**
 * The single global. One name, with nothing on it but the channels.
 *
 * Not `window.electron` or anything that hints at what is underneath. The reason used to be
 * portability to a browser tab; ADR 0024 says the renderer stays a desktop renderer. The
 * name stays anyway, and for a better reason: what the renderer programs against is the
 * channel table in `shared/ipc.ts`, and a global named after the transport would invite code
 * that reaches for Electron's API instead of for the contract.
 */
contextBridge.exposeInMainWorld(
  'tyto',
  createBridge((channel: IpcChannelName, request: unknown) => ipcRenderer.invoke(channel, request)),
);
