import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { type IpcResponse } from '../../shared/ipc.js';
import { type RecentEntry, type RecentFiles } from './recent-files.js';

/**
 * Opening and saving a `.brief`, and the folder that comes with it (E9.8, E9.11).
 *
 * **Main holds the path and the renderer never does.** The renderer asks to open something,
 * gets text and a name back, and paints a title; where the file is stays here, because here
 * is the only side with a disk (ADR 0010). That is not ceremony — it is what lets the
 * preview resolve `assets/logo.png` without the renderer ever learning a folder, and it is
 * why {@link DocumentService.folderOf} exists at all.
 *
 * **One path per tab, not one path.** E9.8 had a single `let current`, which was the whole
 * of this service's state and was right while the window held one buffer. E9.11 opens
 * several, so the state is a map from the renderer's document id to a path — and every call
 * below names the tab it is about. The ids are the renderer's (`shared/ipc.ts` says why);
 * main treats them as opaque keys and never as paths or indices.
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

/** What opening produced, and which tab is holding it — see `file:open` in `shared/ipc.ts`. */
export interface AdoptedDocument {
  readonly document: OpenDocument | null;
  readonly documentId: string | null;
}

/** What saving produced, and which other tab lost the path to it — see `file:save`. */
export interface SavedDocument {
  readonly document: OpenDocument | null;
  readonly released: string | null;
}

export interface DocumentService {
  open(documentId: string): Promise<AdoptedDocument>;
  /** Reopens a path the recent list handed out. `missing` when the entry is gone. */
  reopen(documentId: string, path: string): Promise<AdoptedDocument & { missing: boolean }>;
  save(documentId: string, text: string, saveAs: boolean): Promise<SavedDocument>;
  /** Forgets a tab's path. A tab main never heard of is not an error. */
  close(documentId: string): void;
  recent(): Promise<IpcResponse<'files:recent'>>;
  /**
   * The folder that tab's brief lives in, for the preview to resolve assets against.
   *
   * `undefined` for a tab that has never been opened or saved, which is the state the window
   * starts in: a brief typed into an empty window has no folder beside it and the preview
   * says so rather than guessing (`preview.ts`).
   */
  folderOf(documentId: string): string | undefined;
  /**
   * The brief's own name, without folder or extension — what the artifacts are named after.
   *
   * `tyto render` names a run after the brief file, and an export from the window has to
   * agree or the two produce differently-named folders from the same document. `undefined`
   * for a tab that was never saved, and the caller decides what an unsaved brief is called.
   */
  nameOf(documentId: string): string | undefined;
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

  /** Where each open tab's brief lives, which is the whole of this service's state. */
  const paths = new Map<string, string>();

  /** The tab already holding `path`, if any. See `file:open` in `shared/ipc.ts`. */
  const holderOf = (path: string): string | undefined => {
    for (const [id, held] of paths) if (held === path) return id;
    return undefined;
  };

  const adopt = async (
    documentId: string,
    path: string,
    text: string,
  ): Promise<AdoptedDocument> => {
    // The tab that already has this file wins, and the one that was offered is left with no
    // path at all — the renderer throws it away and shows the tab that was already open.
    const holder = holderOf(path) ?? documentId;
    paths.set(holder, path);

    const entry: RecentEntry = { path, name: basename(path) };
    await recent.remember(entry);
    return { document: { path, name: entry.name, text }, documentId: holder };
  };

  const nothing: AdoptedDocument = { document: null, documentId: null };

  return {
    async open(documentId) {
      const path = await dialogs.openBrief();
      // A dismissed dialog is not a failure and must not look like one: nothing travels
      // back and the renderer leaves the buffer exactly as it was.
      if (path === undefined) return nothing;
      return adopt(documentId, path, await disk.read(path));
    },

    async reopen(documentId, path) {
      // Checked against the list this app wrote, before anything is read. A renderer asking
      // for a path nobody offered gets the same answer as one asking for a deleted file,
      // which is also the answer that tells a hostile caller nothing about what exists.
      if (!(await recent.knows(path))) return { ...nothing, missing: false };

      try {
        const text = await disk.read(path);
        return { ...(await adopt(documentId, path, text)), missing: false };
      } catch {
        // Reported rather than dropped: a person who moved a file wants to be told, and an
        // entry that vanished from the list on the one click that would have explained it
        // is the worst version of this.
        return { ...nothing, missing: true };
      }
    },

    async save(documentId, text, saveAs) {
      const current = paths.get(documentId);
      const path = current === undefined || saveAs ? await dialogs.saveBrief(current) : current;
      if (path === undefined) return { document: null, released: null };

      await disk.write(path, text);

      // Asked before the claim below, because afterwards both tabs hold it and there is no
      // longer anything to find. A save-as onto a file another tab has open is the only way
      // to get here with an answer.
      const previous = holderOf(path);

      // Set directly rather than through `adopt`: saving is the one call that must answer
      // with the tab that asked. `adopt` hands a file to whichever tab already had it, which
      // is right for opening and would, on a save-as onto an open file, move the person away
      // from the text they just wrote.
      paths.set(documentId, path);

      // And the tab that had it lets go, so exactly one tab holds a path (TYTO-104). Both
      // holding it was a map `holderOf` could answer two ways — the next `open` of this file
      // would land on whichever came first in insertion order — and a strip showing the name
      // twice with nothing to tell them apart. The other tab keeps its text; what it loses is
      // the claim that the text is in a file, which stopped being true when this write
      // landed.
      const released = previous !== undefined && previous !== documentId ? previous : null;
      if (released !== null) paths.delete(released);

      const entry: RecentEntry = { path, name: basename(path) };
      await recent.remember(entry);
      return { document: { path, name: entry.name, text }, released };
    },

    close(documentId) {
      paths.delete(documentId);
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

    folderOf: (documentId) => {
      const path = paths.get(documentId);
      return path === undefined ? undefined : dirname(path);
    },

    nameOf: (documentId) => {
      const path = paths.get(documentId);
      // `.brief` stripped, and nothing else: `tyto render promo.brief` names its run
      // `promo`, and an export from the window has to agree or one document produces two
      // differently-named folders depending on which program rendered it.
      return path === undefined ? undefined : basename(path).replace(/\.brief$/iu, '');
    },
  };
}
