import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import type { DocumentService } from './documents.js';
import type { SessionStore, StoredTab } from './session-store.js';

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
 */

export interface SessionServiceOptions {
  readonly store: SessionStore;
  readonly documents: Pick<DocumentService, 'openPath' | 'pathOf' | 'reset'>;
  /** The app's own two files, which the window opens by their commands and not by path. */
  readonly appFiles: { readonly settings: string; readonly keybindings: string };
  /** A file's text, for comparing a draft of one of the app's files against it. */
  readonly readText: (path: string) => Promise<string>;
  /**
   * The settings tab's life is ending without a save: the screens' changes it held go to
   * the file, as closing the tab does (ADR 0073 decision 8). `true` when the file was written.
   */
  readonly endSettingsTab: (documentId: string) => Promise<boolean>;
}

export interface SessionService {
  write(request: IpcRequest<'session:write'>): Promise<IpcResponse<'session:write'>>;
  read(): Promise<IpcResponse<'session:read'>>;
}

type RestoredTab = IpcResponse<'session:read'>['tabs'][number];

/**
 * A text's identity, line endings aside: CodeMirror reads CR LF as LF (TYTO-64), so a draft's
 * saved text never has CR in it, and the same file read off the disk may.
 */
export const savedHashOf = (text: string): string =>
  createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex');

export function createSessionService(options: SessionServiceOptions): SessionService {
  const { store, documents } = options;

  const appFileOf = (kind: 'settings' | 'keybindings'): string =>
    kind === 'settings' ? options.appFiles.settings : options.appFiles.keybindings;

  const restore = async (tab: StoredTab, index: number): Promise<RestoredTab> => {
    const nothing: RestoredTab = {
      kind: tab.kind,
      documentId: null,
      document: null,
      draft: tab.draft?.text ?? null,
      stale: false,
      missing: null,
    };
    const staleAgainst = (text: string): boolean =>
      tab.draft !== undefined && savedHashOf(text) !== tab.draft.savedHash;

    if (tab.kind !== 'brief') {
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

  return {
    async write({ tabs, active, final }) {
      const kept: StoredTab[] = [];
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
        const path = tab.kind === 'brief' ? documents.pathOf(tab.documentId) : undefined;
        // A brief in no file with nothing typed in it has nothing to bring back.
        if (tab.kind === 'brief' && path === undefined && draft === undefined) continue;

        if (index === active) keptActive = kept.length;
        kept.push({
          kind: tab.kind,
          ...(path === undefined ? {} : { path }),
          ...(draft === undefined ? {} : { draft }),
        });
      }
      return { written: await store.write({ version: 1, tabs: kept, active: keptActive }) };
    },

    async read() {
      // A new page: whatever the last one held is gone with it, and its ids will be reused.
      documents.reset();
      const stored = await store.read();
      const tabs: RestoredTab[] = [];
      for (const [index, tab] of stored.tabs.entries()) tabs.push(await restore(tab, index));
      return { tabs, active: stored.active };
    },
  };
}
