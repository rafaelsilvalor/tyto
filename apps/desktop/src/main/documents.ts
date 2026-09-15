import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { type IpcResponse } from '../../shared/ipc.js';
import { type RecentEntry, type RecentFiles } from './recent-files.js';

/**
 * Opening and saving a `.brief`, and the folder that comes with it (E9.8).
 *
 * **Main holds the path and the renderer never does.** The renderer asks to open something,
 * gets text and a name back, and paints a title; where the file is stays here, because here
 * is the only side with a disk (ADR 0010). That is not ceremony — it is what lets the
 * preview resolve `assets/logo.png` without the renderer ever learning a folder, and it is
 * why {@link DocumentService.baseDirectory} exists at all.
 *
 * `dialog` is injected rather than imported. Electron's `dialog` is a main-process API and
 * naming it here would make this module unloadable outside a running Electron — the same
 * call `credentials.ts` makes about `safeStorage`, and what lets `pnpm check` drive open
 * and save with no window on the screen.
 */

export type OpenDocument = NonNullable<IpcResponse<'file:open'>['document']>;

/** As much of Electron's `dialog` as this needs, which is two calls. */
export interface FileDialogs {
  openBrief(): Promise<string | undefined>;
  saveBrief(suggested: string | undefined): Promise<string | undefined>;
}

export interface DocumentServiceOptions {
  readonly dialogs: FileDialogs;
  readonly recent: RecentFiles;
  /** Injected so a test can drive the whole service without touching a disk. */
  readonly disk?: {
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    /** Separate from `read`, because the recent list asks about ten files it will not open. */
    exists(path: string): Promise<boolean>;
  };
}

export interface DocumentService {
  open(): Promise<OpenDocument | null>;
  /** Reopens a path the recent list handed out. `missing` when the entry is gone. */
  reopen(path: string): Promise<{ document: OpenDocument | null; missing: boolean }>;
  save(text: string, saveAs: boolean): Promise<OpenDocument | null>;
  recent(): Promise<IpcResponse<'files:recent'>>;
  /**
   * The folder the open brief lives in, for the preview to resolve assets against.
   *
   * `undefined` until something has been opened or saved, which is the state the window
   * starts in: a brief typed into an empty window has no folder beside it and the preview
   * says so rather than guessing (`preview.ts`).
   */
  baseDirectory(): string | undefined;
}

const nodeDisk = {
  read: (path: string): Promise<string> => readFile(path, 'utf8'),
  write: (path: string, text: string): Promise<void> => writeFile(path, text, 'utf8'),
  exists: (path: string): Promise<boolean> =>
    access(path).then(
      () => true,
      () => false,
    ),
};

export function createDocumentService(options: DocumentServiceOptions): DocumentService {
  const { dialogs, recent } = options;
  const disk = options.disk ?? nodeDisk;

  /** The path of what is open, which is the whole of this service's state. */
  let current: string | undefined;

  const adopt = async (path: string, text: string): Promise<OpenDocument> => {
    current = path;
    const entry: RecentEntry = { path, name: basename(path) };
    await recent.remember(entry);
    return { path, name: entry.name, text };
  };

  return {
    async open() {
      const path = await dialogs.openBrief();
      // A dismissed dialog is not a failure and must not look like one: `null` travels back
      // and the renderer leaves the buffer exactly as it was.
      if (path === undefined) return null;
      return adopt(path, await disk.read(path));
    },

    async reopen(path) {
      // Checked against the list this app wrote, before anything is read. A renderer asking
      // for a path nobody offered gets the same answer as one asking for a deleted file,
      // which is also the answer that tells a hostile caller nothing about what exists.
      if (!(await recent.knows(path))) return { document: null, missing: false };

      try {
        const text = await disk.read(path);
        return { document: await adopt(path, text), missing: false };
      } catch {
        // Reported rather than dropped: a person who moved a file wants to be told, and an
        // entry that vanished from the list on the one click that would have explained it
        // is the worst version of this.
        return { document: null, missing: true };
      }
    },

    async save(text, saveAs) {
      const path = current === undefined || saveAs ? await dialogs.saveBrief(current) : current;
      if (path === undefined) return null;

      await disk.write(path, text);
      return adopt(path, text);
    },

    async recent() {
      const entries = await recent.list();
      const files = await Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          // Checked on every listing rather than by a watcher: the list is read when the
          // command bar opens, which is exactly the moment a stale entry would be clicked.
          missing: !(await disk.exists(entry.path)),
        })),
      );
      return { files };
    },

    baseDirectory: () => (current === undefined ? undefined : dirname(current)),
  };
}
