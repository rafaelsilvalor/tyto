import { access, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { type DocumentFormat, documentFormatOf } from '../../shared/file-icons.js';
import { type Locale, translate } from '../../shared/i18n/index.js';
import { type IpcResponse } from '../../shared/ipc.js';
import { relativeUnder } from './explorer.js';
import { pathLabelOf } from './path-label.js';
import { type RecentEntry, type RecentFiles } from './recent-files.js';

/**
 * Opening and saving a `.brief`, and the folder that comes with it (E9.8, E9.11) — and a `.txt`
 * or `.md` since TYTO-247, which differ only in the format `describe` names (ADR 0132).
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

/**
 * As much of Electron's `dialog` as this needs, which is two calls. Open offers briefs and text
 * files (TYTO-247); save offers the format of the tab being saved first (ADR 0132).
 */
export interface FileDialogs {
  openBrief(): Promise<string | undefined>;
  saveBrief(suggested: string | undefined, format: DocumentFormat): Promise<string | undefined>;
}

export interface DocumentServiceOptions {
  readonly dialogs: FileDialogs;
  readonly recent: RecentFiles;
  /**
   * Paths opened and saved like any brief but never put in the recent list — the app's own
   * `settings.json` (TYTO-206), which has a command of its own and is not a document of work.
   */
  readonly unlisted?: readonly string[];
  /**
   * The home directory a tab's folder is shortened against (TYTO-288, ADR 0086), asked at every
   * open and save. Electron's `app.getPath('home')` in the app; the operating system's when
   * absent.
   */
  readonly home?: () => string;
  /**
   * The open workspace folder, which a label inside it is relative to (TYTO-274, ADR 0125): the
   * folder the explorer lists, asked at every open, save and relabel. None when absent.
   */
  readonly root?: () => string | undefined;
  /** Injected so a test can drive the whole service without touching a disk. */
  readonly disk?: {
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    /** Separate from `read`, because the recent list asks about ten files it will not open. */
    exists(path: string): Promise<boolean>;
  };
}

/** One filter of a file dialog, Electron's `FileFilter`. */
export interface DialogFilter {
  readonly name: string;
  readonly extensions: string[];
}

/**
 * File ▸ Open's filters, in this order (TYTO-247, ADR 0132): briefs first, which is what the
 * dialog opens on, then text files, then everything a tab opens. "Brief" is the format's name
 * and reads the same in both languages, as it did before.
 */
export const openFilters = (locale: Locale): DialogFilter[] => [
  { name: 'Brief', extensions: ['brief'] },
  { name: translate(locale, 'dialog.files.text'), extensions: ['txt', 'md'] },
  { name: translate(locale, 'dialog.files.supported'), extensions: ['brief', 'txt', 'md'] },
];

/**
 * Save As's filters: the tab's own format first, so the name it suggests ends in its extension
 * — a text tab is saved as `.txt` or `.md`, never turned into a `.brief` by the dialog.
 */
export const saveFilters = (locale: Locale, format: DocumentFormat): DialogFilter[] => {
  switch (format) {
    case 'brief':
      return [{ name: 'Brief', extensions: ['brief'] }];
    case 'text':
      return [{ name: translate(locale, 'dialog.files.text'), extensions: ['txt', 'md'] }];
    case 'markdown':
      return [{ name: translate(locale, 'dialog.files.text'), extensions: ['md', 'txt'] }];
  }
};

/** What opening produced, and which tab is holding it — see `file:open` in `shared/ipc.ts`. */
export interface AdoptedDocument {
  readonly document: OpenDocument | null;
  readonly documentId: string | null;
}

/** A tab whose file the explorer renamed, as the window shows it now — see `retargetUnder`. */
export interface MovedDocument {
  readonly documentId: string;
  readonly name: string;
  readonly pathLabel: string;
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
  /**
   * Opens a file main itself chose, with no picker and no recent-list check (TYTO-45).
   *
   * Not reachable by a path from the renderer, and that is the containment: the only caller
   * is the local queue's `queue:open-brief`, which sends a task id and gets the path main
   * listed for it. `reopen` checks its path against the recent list for the same reason.
   * A file that cannot be read answers with nothing, as a vanished recent entry does.
   *
   * `label` is what the tab and the title show in place of the file's own name. Every task's
   * brief is called `brief.brief`, so two of them open at once would be two identical tabs;
   * the queue passes `<id> · brief.brief`. It stays with the file across a save and a
   * `retarget`, and a save-as to another path drops it.
   */
  openPath(documentId: string, path: string, label?: string): Promise<AdoptedDocument>;
  /**
   * The file at `from` now lives at `to`; any tab holding it follows (TYTO-45).
   *
   * Main moved it — the local queue acknowledging a task renames `inbox/<id>/` to
   * `done/<id>/` — so main is the side that knows both paths. Without this, the tab a person
   * fixed a brief in would still point into a folder that no longer exists, and their next
   * save would fail. A path no tab holds is not an error.
   */
  retarget(from: string, to: string): void;
  /**
   * The explorer renamed `from` — a file, or a folder with files inside — to `to` (TYTO-352,
   * ADR 0121). Every tab at or under `from` follows by the same relative path, its label with
   * it, and the answer is each tab that moved with what it is called now, so the window can
   * rename its tab. A dirty tab keeps its text; what moves is only where it saves.
   */
  retargetUnder(from: string, to: string): MovedDocument[];
  /**
   * Every tab that holds a file, labelled again (TYTO-274, ADR 0125): the open folder changed,
   * and a label inside it is relative to it. The same answer `retargetUnder` gives, so the
   * window applies it the same way; nothing moves.
   */
  relabel(): MovedDocument[];
  /** Where `path` is, as a tooltip says it (ADR 0086, ADR 0125), for a file no tab holds. */
  labelOf(path: string): string;
  /**
   * The explorer sent `path` to the trash (TYTO-352): every tab at or under it lets go of its
   * file, as a save-as onto it would make it (TYTO-104), and the answer is those tabs' ids.
   */
  releaseUnder(path: string): string[];
  /** The tabs that hold a file at or under `path`, changing nothing (TYTO-352). */
  heldUnder(path: string): string[];
  /** `format` is the tab's (ADR 0132), for the dialog's filter; a brief when absent. */
  save(
    documentId: string,
    text: string,
    saveAs: boolean,
    format?: DocumentFormat,
  ): Promise<SavedDocument>;
  /** Forgets a tab's path. A tab main never heard of is not an error. */
  close(documentId: string): void;
  /**
   * The path a tab holds, for the session record only (TYTO-113, ADR 0080). Main keeps it;
   * it is never asked for by the window.
   */
  pathOf(documentId: string): string | undefined;
  /**
   * Forgets every tab, because a new page is starting: a reload keeps main and throws the
   * window's tabs away, and the ids the old page used will be used again (TYTO-113).
   */
  reset(): void;
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
  const remember = async (entry: RecentEntry): Promise<void> => {
    if (!(options.unlisted ?? []).includes(entry.path)) await recent.remember(entry);
  };
  const disk = options.disk ?? nodeDisk;

  /** Where each open tab's brief lives, which is the whole of this service's state. */
  const paths = new Map<string, string>();

  /** A display name some files carry instead of their own (see `openPath`), keyed by path. */
  const labels = new Map<string, string>();
  const nameFor = (path: string): string => labels.get(path) ?? basename(path);
  const home = options.home ?? homedir;
  const labelOf = (path: string): string => pathLabelOf(path, home(), options.root?.());
  const movedOf = (documentId: string, path: string): MovedDocument => ({
    documentId,
    name: nameFor(path),
    pathLabel: labelOf(path),
  });
  /**
   * What a document crosses the bridge as: its name, its folder to show, its text, and what it
   * opens as — named here from the path's extension, the one place every open passes (ADR 0132).
   */
  const describe = (path: string, text: string): OpenDocument => ({
    path,
    name: nameFor(path),
    pathLabel: labelOf(path),
    text,
    format: documentFormatOf(path),
  });

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

    const document = describe(path, text);
    await remember({ path, name: document.name });
    return { document, documentId: holder };
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

    async openPath(documentId, path, label) {
      try {
        const text = await disk.read(path);
        if (label !== undefined) labels.set(path, label);
        return await adopt(documentId, path, text);
      } catch {
        // Gone between the listing and the click — a task somebody else moved to done/.
        return nothing;
      }
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

    async save(documentId, text, saveAs, format = 'brief') {
      const current = paths.get(documentId);
      const path =
        current === undefined || saveAs ? await dialogs.saveBrief(current, format) : current;
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

      const document = describe(path, text);
      await remember({ path, name: document.name });
      return { document, released };
    },

    retarget(from, to) {
      for (const [id, held] of paths) if (held === from) paths.set(id, to);
      const label = labels.get(from);
      if (label !== undefined) {
        labels.delete(from);
        labels.set(to, label);
      }
    },

    retargetUnder(from, to) {
      const moved: string[] = [];
      for (const [id, held] of paths) {
        const rest = relativeUnder(from, held);
        if (rest === undefined) continue;
        const next = rest === '' ? to : join(to, rest);
        paths.set(id, next);
        moved.push(id);
      }
      for (const [held, label] of [...labels]) {
        const rest = relativeUnder(from, held);
        if (rest === undefined) continue;
        labels.delete(held);
        labels.set(rest === '' ? to : join(to, rest), label);
      }
      // Described after the labels have moved, so a tab that carries one keeps showing it.
      return moved.map((documentId) => movedOf(documentId, paths.get(documentId) ?? to));
    },

    relabel() {
      return [...paths].map(([documentId, path]) => movedOf(documentId, path));
    },

    labelOf,

    heldUnder(path) {
      return [...paths].flatMap(([id, held]) =>
        relativeUnder(path, held) === undefined ? [] : [id],
      );
    },

    releaseUnder(path) {
      const released: string[] = [];
      for (const [id, held] of paths) {
        if (relativeUnder(path, held) === undefined) continue;
        paths.delete(id);
        released.push(id);
      }
      for (const held of [...labels.keys()]) {
        if (relativeUnder(path, held) !== undefined) labels.delete(held);
      }
      return released;
    },

    close(documentId) {
      paths.delete(documentId);
    },

    pathOf: (documentId) => paths.get(documentId),

    reset() {
      paths.clear();
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
