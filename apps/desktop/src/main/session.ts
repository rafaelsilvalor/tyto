import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import { prunedGroups } from '../../shared/session-groups.js';
import type { DocumentService } from './documents.js';
import { RECENT_LIMIT } from './recent-files.js';
import {
  NO_GROUPS,
  type SessionStore,
  type StoredFolderTabs,
  type StoredGroups,
  type StoredSession,
  type StoredTab,
  type StoredTemplate,
} from './session-store.js';
import type { OpenedTemplate } from './template-editor.js';

/**
 * Reopening the tabs where the person left them, drafts included (TYTO-113, ADR 0080).
 *
 * The window says what it has — ids, kinds, and the text of every tab that is in no file —
 * and main turns that into a record that names paths, because only main knows them. On the
 * next page, main decides each tab against the disk as it is **then**, and the window only
 * builds what main answered:
 *
 * - **A brief is reopened by the path main stored.** That is the containment: a session can
 *   name only files main itself had open, as `file:reopen` names only what the recent list
 *   holds. The window never sends a path, so it cannot invent one.
 * - **A draft goes over a file only if the file is still what it was written against**, by
 *   the hash of the saved text. Otherwise the tab shows the disk, and the draft comes back
 *   beside it, `stale` — the old text is never imposed over a newer file, and never dropped.
 * - **A file that is gone** loses its tab, and its draft, if there was one, comes back with
 *   no file. Either way the window says the file is missing.
 *
 * **The template mode is kept the same way** (TYTO-266): its folder is main's, filed by
 * `template:open` in a `TemplateFolder`, and the window sends only the buffers. On the next page
 * the folder is read again and each buffer's draft is decided against its file like a brief's.
 */

/**
 * The folder the template mode last opened, which main keeps so the window never has to name
 * it to the session (TYTO-266, ADR 0080 decision 3). `template:open` files it; reading a
 * session files it again for the page that restores the mode.
 */
export interface TemplateFolder {
  current(): string | undefined;
  set(directory: string | undefined): void;
}

export function createTemplateFolder(): TemplateFolder {
  let directory: string | undefined;
  return {
    current: () => directory,
    set: (next) => {
      directory = next;
    },
  };
}

export interface SessionServiceOptions {
  readonly store: SessionStore;
  readonly documents: Pick<DocumentService, 'openPath' | 'pathOf' | 'reset'>;
  /** The app's own files, which the window opens by their commands and not by path. */
  readonly appFiles: {
    readonly settings: string;
    readonly keybindings: string;
    readonly snippets: string;
  };
  /** A file's text, for comparing a draft of one of the app's files against it. */
  readonly readText: (path: string) => Promise<string>;
  /**
   * The settings tab's life is ending without a save: the screens' changes it held go to
   * the file, as closing the tab does (ADR 0073 decision 8). `true` when the file was written.
   */
  readonly endSettingsTab: (documentId: string) => Promise<boolean>;
  /** Which folder the template mode has open (TYTO-266). Shared with `template:open`. */
  readonly templateFolder: TemplateFolder;
  /** Reads a template folder as `template:open` does, to restore the mode against the disk. */
  readonly openTemplate: (directory: string) => Promise<OpenedTemplate>;
  /**
   * The workspace folder main has open (TYTO-278, ADR 0113): kept like the template mode's
   * folder, by main, and reopened through the same door File ▸ Open Folder uses, which asks
   * the trust store again. Absent, no workspace is kept.
   */
  readonly workspace?: {
    current(): string | undefined;
    reopen(folder: string | undefined): Promise<void>;
  };
  /**
   * What makes two folder paths one folder, for finding a folder's kept tabs (TYTO-513): the
   * recent list's own rule, case folded on Windows only. Absent, the paths are compared as
   * they are.
   */
  readonly folderKey?: (folder: string) => string;
}

export interface SessionService {
  write(request: IpcRequest<'session:write'>): Promise<IpcResponse<'session:write'>>;
  read(): Promise<IpcResponse<'session:read'>>;
  /**
   * The window left `from` for `to` (TYTO-513, ADR 0165): the tabs last written go under `from`,
   * and `to`'s tabs, or none, become the window's, for the page that reads them next. Until
   * that page reads, the leaving page's writes are dropped: they hold `from`'s tabs, and would
   * land on `to`'s. `undefined` is no folder. Says whether the record reached the disk.
   */
  switchFolder(from: string | undefined, to: string | undefined): Promise<boolean>;
}

/**
 * How many other folders keep their tabs (TYTO-513): as many as the recent list shows, so a
 * folder that can be chosen from it has its tabs, and the file does not grow without end.
 */
export const KEPT_FOLDERS = RECENT_LIMIT;

type RestoredTab = IpcResponse<'session:read'>['tabs'][number];
type RestoredTemplate = NonNullable<IpcResponse<'session:read'>['template']>;
type TemplateRequest = IpcRequest<'session:write'>['template'];

/**
 * A text's identity, line endings aside: CodeMirror reads CR LF as LF (TYTO-64), so a draft's
 * saved text never has CR in it, and the same file read off the disk may.
 */
export const savedHashOf = (text: string): string =>
  createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex');

/**
 * Whether a session tab of this kind is a file main holds by path — a brief or a text file
 * (TYTO-247, ADR 0132), a recipe among them (TYTO-377) — rather than one of the app's own files,
 * which main knows by name.
 */
export const hasPath = (
  kind: StoredTab['kind'],
): kind is 'brief' | 'text' | 'markdown' | 'recipe' =>
  kind === 'brief' || kind === 'text' || kind === 'markdown' || kind === 'recipe';

/**
 * The groups a folder with no tabs kept opens with (TYTO-513, ADR 0165): the window's own, less
 * every tab that names a document — so a following preview that was open stays open, and a
 * window that had none gets none. Never absent: no groups would read as a first launch.
 */
const arrangementOf = (groups: StoredGroups | undefined): StoredGroups =>
  (groups === undefined
    ? undefined
    : prunedGroups(groups, (tab) => ('tab' in tab ? undefined : tab))) ?? NO_GROUPS;

/** A brief that came back with something to show: its file, or its draft in no file. */
const isBriefBack = (tab: RestoredTab): boolean =>
  tab.kind === 'brief' && (tab.document !== null || tab.draft !== null);

export function createSessionService(options: SessionServiceOptions): SessionService {
  const { store, documents } = options;
  const keyOf = options.folderKey ?? ((folder: string) => folder);
  const sameFolder = (left: string | null, right: string | null): boolean =>
    left === null || right === null ? left === right : keyOf(left) === keyOf(right);

  /** The record as last read or written: what a folder switch files away (TYTO-513). */
  let last: StoredSession | undefined;
  /** True from a folder switch until the next page reads: the old page's writes are stale. */
  let leftBehind = false;
  /** One write at a time, in the order asked, so a switch never lands under a late write. */
  let writing: Promise<unknown> = Promise.resolve();
  const keep = (session: StoredSession): Promise<boolean> => {
    last = session;
    const written = writing.then(() => store.write(session));
    writing = written;
    return written;
  };

  const appFileOf = (kind: keyof SessionServiceOptions['appFiles']): string =>
    options.appFiles[kind];

  const restore = async (tab: StoredTab, index: number): Promise<RestoredTab> => {
    const nothing: RestoredTab = {
      kind: tab.kind,
      documentId: null,
      document: null,
      draft: tab.draft?.text ?? null,
      stale: false,
      missing: null,
      // As written: main does not hold the text the window will open, so the window clamps.
      place: tab.place ?? null,
    };
    const staleAgainst = (text: string): boolean =>
      tab.draft !== undefined && savedHashOf(text) !== tab.draft.savedHash;

    if (!hasPath(tab.kind)) {
      if (tab.draft === undefined) return nothing;
      const text = await options.readText(appFileOf(tab.kind)).catch(() => '');
      return { ...nothing, stale: staleAgainst(text) };
    }
    if (tab.path === undefined) return nothing;

    // An id of main's own, which cannot collide with the window's `document-<n>`.
    const opened = await documents.openPath(`session-${String(index + 1)}`, tab.path);
    if (opened.document === null || opened.documentId === null) {
      return { ...nothing, missing: basename(tab.path) };
    }
    return {
      ...nothing,
      documentId: opened.documentId,
      document: opened.document,
      stale: staleAgainst(opened.document.text),
    };
  };

  /** The mode as the record keeps it: main's folder, and each draft as a hash. */
  const keptTemplate = (template: TemplateRequest): StoredTemplate | undefined => {
    const directory = options.templateFolder.current();
    if (template === null || directory === undefined) return undefined;
    const drafts: StoredTemplate['drafts'] = {};
    for (const buffer of ['manifest', 'markup'] as const) {
      const draft = template[buffer];
      if (draft !== null) {
        drafts[buffer] = { text: draft.text, savedHash: savedHashOf(draft.savedText) };
      }
    }
    return { directory, visible: template.visible, drafts };
  };

  /** The mode decided against the folder as it is now, as `restore` decides a brief. */
  const restoreTemplate = async (stored: StoredTemplate): Promise<RestoredTemplate> => {
    const opened = await options.openTemplate(stored.directory).catch(() => undefined);
    const markup = opened?.kind === 'markup' ? opened : undefined;
    options.templateFolder.set(markup === undefined ? undefined : stored.directory);
    const buffer = (name: 'manifest' | 'markup'): RestoredTemplate['manifest'] => {
      const draft = stored.drafts[name];
      return {
        draft: draft?.text ?? null,
        // A folder that is gone has nothing a draft could be stale against: it comes back
        // with no file, as a brief's draft does.
        stale:
          draft !== undefined &&
          markup !== undefined &&
          savedHashOf(markup[name]) !== draft.savedHash,
      };
    };
    return {
      opened:
        markup === undefined
          ? null
          : { ...markup, examples: markup.examples.map((example) => ({ ...example })) },
      name: basename(stored.directory),
      visible: stored.visible,
      manifest: buffer('manifest'),
      markup: buffer('markup'),
    };
  };

  return {
    async write({ tabs, active, template, groups, final }) {
      const kept: StoredTab[] = [];
      /** A window tab's id to its index among the kept tabs, for the groups to name it by. */
      const keptIndex = new Map<string, number>();
      let keptActive = 0;
      for (const [index, tab] of tabs.entries()) {
        let savedText = tab.draft?.savedText;
        if (final && tab.kind === 'settings' && (await options.endSettingsTab(tab.documentId))) {
          // The screens' changes reached the file, and the draft already holds them (they were
          // moved into the buffer, TYTO-255): the draft is now written against the new file.
          savedText = await options.readText(options.appFiles.settings).catch(() => savedText);
        }
        const draft =
          tab.draft === null || savedText === undefined
            ? undefined
            : { text: tab.draft.text, savedHash: savedHashOf(savedText) };
        const path = hasPath(tab.kind) ? documents.pathOf(tab.documentId) : undefined;
        // A brief or a text tab in no file with nothing typed in it has nothing to bring back.
        if (hasPath(tab.kind) && path === undefined && draft === undefined) continue;

        if (index === active) keptActive = kept.length;
        keptIndex.set(tab.documentId, kept.length);
        kept.push({
          kind: tab.kind,
          ...(path === undefined ? {} : { path }),
          ...(draft === undefined ? {} : { draft }),
          ...(tab.place === null ? {} : { place: tab.place }),
        });
      }
      const keptMode = keptTemplate(template);
      const workspaceFolder = options.workspace?.current();
      // The groups name the kept tabs by index (TYTO-286); a tab that was not kept — a brief in
      // no file with nothing typed — leaves its groups, and a group left with none goes. A
      // following preview names no tab and stays; a locked one goes with its brief (TYTO-287).
      const keptGroups: StoredGroups | undefined =
        groups === undefined
          ? undefined
          : prunedGroups(groups, (tab) => {
              const strip = 'stripHidden' in tab && tab.stripHidden === true;
              const all = 'mode' in tab && tab.mode === 'all';
              const howShown = {
                ...(strip ? { stripHidden: true as const } : {}),
                ...(all ? { mode: 'all' as const } : {}),
              };
              if (!('documentId' in tab)) return { view: 'preview' as const, ...howShown };
              const at = keptIndex.get(tab.documentId);
              if (at === undefined) return undefined;
              if ('locked' in tab)
                return { tab: at, view: 'preview' as const, locked: true as const, ...howShown };
              return { tab: at, ...(tab.place === null ? {} : { place: tab.place }) };
            });
      if (leftBehind) return { written: false };
      // The other folders' tabs ride along unchanged; only a switch files or takes one.
      const folders = (last ?? (await store.read())).folders;
      return {
        written: await keep({
          version: 1,
          tabs: kept,
          active: keptActive,
          ...(keptMode === undefined ? {} : { template: keptMode }),
          ...(workspaceFolder === undefined ? {} : { workspace: { folder: workspaceFolder } }),
          // Always: a session without groups reads as a first launch (TYTO-287, NO_GROUPS).
          groups: keptGroups ?? NO_GROUPS,
          ...(folders === undefined ? {} : { folders }),
        }),
      };
    },

    async switchFolder(from, to) {
      // Settled first, so the tabs filed away are the last ones the leaving page wrote.
      leftBehind = true;
      await writing;
      const current = last ?? (await store.read());
      const leaving: StoredFolderTabs = {
        folder: from ?? null,
        tabs: current.tabs,
        active: current.active,
        groups: current.groups ?? NO_GROUPS,
      };
      const others = current.folders ?? [];
      const returning = others.find((entry) => sameFolder(entry.folder, to ?? null));
      const folders = [
        leaving,
        ...others.filter(
          (entry) =>
            !sameFolder(entry.folder, leaving.folder) && !sameFolder(entry.folder, to ?? null),
        ),
      ].slice(0, KEPT_FOLDERS);
      const {
        tabs: _tabs,
        active: _active,
        groups: _groups,
        workspace: _workspace,
        ...rest
      } = current;
      return keep({
        ...rest,
        tabs: returning?.tabs ?? [],
        active: returning?.active ?? 0,
        groups: returning?.groups ?? arrangementOf(current.groups),
        ...(to === undefined ? {} : { workspace: { folder: to } }),
        folders,
      });
    },

    async read() {
      // A new page: whatever the last one held is gone with it, and its ids will be reused.
      documents.reset();
      options.templateFolder.set(undefined);
      await writing;
      const stored = await store.read();
      last = stored;
      leftBehind = false;
      // Before the tabs, so a brief that comes back inside the folder previews with its places.
      // A folder that is gone, or no longer a workspace, simply is not open (ADR 0113).
      await options.workspace?.reopen(stored.workspace?.folder);
      const tabs: RestoredTab[] = [];
      for (const [index, tab] of stored.tabs.entries()) tabs.push(await restore(tab, index));
      const template =
        stored.template === undefined ? null : await restoreTemplate(stored.template);
      // Indices checked against the tabs read: a hand-edited file may name one that is not.
      // A locked preview whose brief did not come back goes with it (TYTO-287).
      const groups =
        stored.groups === undefined
          ? undefined
          : prunedGroups(stored.groups, (tab) => {
              if (!('tab' in tab)) return tab;
              const restored = tabs[tab.tab];
              if (restored === undefined) return undefined;
              if ('locked' in tab) return isBriefBack(restored) ? tab : undefined;
              return { tab: tab.tab, place: tab.place ?? null };
            });
      return {
        tabs,
        active: stored.active,
        template,
        groups: groups ?? null,
        // No groups is no session from a build that keeps them: a first launch, or the first
        // after the upgrade (ADR 0084 decision 8). A file that could not be read, or whose tree
        // did not parse, has groups by then (`UNREADABLE_SESSION`): somebody used the app.
        firstLaunch: stored.groups === undefined,
      };
    },
  };
}
