import { type DocumentSnapshot } from '@tyto/editor';

import { type Artwork, type Diagnostic, type Frame, type Selection, type Zoom } from './preview.js';

/**
 * What the window has open, as a value (E9.11).
 *
 * **This is the card.** Until now `main.ts` held one `editor`, one `preview` object and one
 * `panel` object as module-level singletons, and every painter read them; a tab means each
 * open brief owns that state and the panels read whichever one is active. So the state stops
 * being module-level and becomes this record, and every operation on it is a pure function
 * returning a new one — the same arrangement `shared/layout.ts` makes for the panels, and
 * for the same reason: what is on screen and what is remembered cannot be two things that
 * have to be kept in step.
 *
 * Nothing here touches the DOM, the bridge or CodeMirror. A `DocumentSnapshot` is opaque —
 * `@tyto/editor` says what is in one and nothing outside that package reads a field.
 */

export interface DocumentState {
  /**
   * The renderer's own id for this tab, which is also the key main files its path under.
   *
   * Not the path and not the name: a document has neither until it is saved, and both change
   * under it when it is. The id is what does not.
   */
  readonly id: string;
  /** The file's name, or nothing for a brief that has never been saved. */
  readonly name: string | undefined;
  readonly dirty: boolean;
  /**
   * The text, the undo history, the cursor and the scroll.
   *
   * Refreshed from the editor whenever this document stops being the active one, and stale
   * for exactly as long as it *is* active — which is safe because the editor is then the
   * truth and nothing reads this. `captureActive` in `main.ts` is the one place that
   * matters.
   *
   * Absent only for the document the window opens on, which exists before the editor does:
   * `main.ts` builds the workspace at module load and mounts CodeMirror after the dock has
   * arranged. Every later document is born from `editor.blank`, and this one is snapshotted
   * the first time anything takes it out of the editor — which is always before anything
   * puts it back.
   */
  readonly snapshot: DocumentSnapshot | undefined;

  /** Everything the preview pane shows, which is per document because the frames are. */
  readonly frames: readonly Frame[];
  readonly artworks: readonly Artwork[];
  readonly selection: Selection;
  readonly zoom: Zoom;
  readonly errors: number;
  readonly problems: number;

  /** What the stages said about this brief, and the text their offsets index. */
  readonly diagnostics: readonly Diagnostic[];
  readonly brief: string;
}

export interface Workspace {
  /** In tab order, left to right. **Never empty** — see {@link closeDocument}. */
  readonly documents: readonly DocumentState[];
  readonly activeId: string;
}

/** A document nobody has typed in and nobody has named, as the app opens on one. */
export function newDocument(id: string, snapshot?: DocumentSnapshot): DocumentState {
  return {
    id,
    name: undefined,
    dirty: false,
    snapshot,
    frames: [],
    artworks: [],
    selection: { format: undefined, artwork: undefined },
    zoom: 'fit',
    errors: 0,
    problems: 0,
    diagnostics: [],
    brief: '',
  };
}

export const workspaceOf = (first: DocumentState): Workspace => ({
  documents: [first],
  activeId: first.id,
});

/**
 * The document the panels are showing.
 *
 * Total rather than partial: a workspace always holds at least one document, so every caller
 * that would have had to handle `undefined` handles nothing instead. The fallback is the
 * first document and it is unreachable — an `activeId` naming nothing would be a bug in this
 * file, not a state a caller should be writing code for.
 */
export function activeOf(workspace: Workspace): DocumentState {
  const found = workspace.documents.find((document) => document.id === workspace.activeId);
  return found ?? (workspace.documents[0] as DocumentState);
}

export const documentOf = (workspace: Workspace, id: string): DocumentState | undefined =>
  workspace.documents.find((document) => document.id === id);

/** Replaces one document with the result of `change`, leaving every other one alone. */
export function updateDocument(
  workspace: Workspace,
  id: string,
  change: (document: DocumentState) => DocumentState,
): Workspace {
  return {
    ...workspace,
    documents: workspace.documents.map((document) =>
      document.id === id ? change(document) : document,
    ),
  };
}

/** Puts a document in front. An id nobody has is ignored rather than refused. */
export function selectDocument(workspace: Workspace, id: string): Workspace {
  return documentOf(workspace, id) === undefined ? workspace : { ...workspace, activeId: id };
}

/** Adds a document at the end of the strip and makes it the active one. */
export function addDocument(workspace: Workspace, document: DocumentState): Workspace {
  return { documents: [...workspace.documents, document], activeId: document.id };
}

/**
 * Whether a document can be replaced rather than pushed aside when a file is opened.
 *
 * The empty tab the window starts on, and nothing else: no name, nothing typed, no text.
 * Every editor does this — opening a file from a blank window gives you one tab, not two —
 * and the rule has to be exactly this narrow, because getting it wrong throws away something
 * a person wrote.
 */
export const isDisposable = (document: DocumentState): boolean =>
  document.name === undefined && !document.dirty && document.brief === '';

/**
 * Takes the file off a document, leaving every character of its text alone (TYTO-104).
 *
 * A save-as onto a file another tab has open gives the path to the tab that asked — moving
 * somebody away from the text they just wrote would be worse — so the other tab has to let
 * go, and main says which one in `file:save`'s `released` (`shared/ipc.ts`).
 *
 * What it loses is its name and its clean marker, and the marker is the half worth stating:
 * the text is now in no file at all, so there is nothing on disk it could be equal to, and
 * the next save there has to ask where to put it. A tab still showing a name would be
 * claiming a file that a moment ago stopped being its.
 *
 * Here rather than inline in `main.ts` because this is the rule and `main.ts` is the wiring.
 * `dirty` is a stored boolean today and the exploration in
 * `docs/explorations/2026-09-16-document-buffer-model.md` (D3) wants it derived from the
 * saved text instead; when that lands, this function is one of the four places that decide
 * it, and the only one a unit test can reach.
 */
export function releaseDocument(workspace: Workspace, id: string): Workspace {
  return updateDocument(workspace, id, (document) => ({
    ...document,
    name: undefined,
    dirty: true,
  }));
}

/**
 * Closes a tab, and says which document the window is left looking at.
 *
 * `fresh` is called only when the tab being closed is the last one. Closing everything leaves
 * an empty buffer rather than an empty window: a window with no document has no editor to
 * put text in, and "start typing" is the state the app opens in.
 *
 * The neighbour that takes over is the one that moved into the closed tab's place — the tab
 * to its right — and the one on the left when it was the last in the strip. That is what
 * every editor does and it is the only choice that keeps the pointer under the mouse.
 */
export function closeDocument(
  workspace: Workspace,
  id: string,
  fresh: () => DocumentState,
): Workspace {
  const at = workspace.documents.findIndex((document) => document.id === id);
  if (at === -1) return workspace;

  const remaining = workspace.documents.filter((document) => document.id !== id);
  if (remaining.length === 0) return workspaceOf(fresh());

  if (workspace.activeId !== id) return { ...workspace, documents: remaining };

  const next = remaining[Math.min(at, remaining.length - 1)] as DocumentState;
  return { documents: remaining, activeId: next.id };
}

/**
 * The tab one step along, wrapping at both ends.
 *
 * Wrapping and not stopping, for the reason `cycle` in `main.ts` gives about formats: a
 * "next tab" that refuses at the end is a key that does nothing every other press.
 */
export function stepDocument(workspace: Workspace, direction: 1 | -1): string {
  const { documents } = workspace;
  const at = documents.findIndex((document) => document.id === workspace.activeId);
  const next = (at + direction + documents.length) % documents.length;
  return (documents[next] ?? (documents[0] as DocumentState)).id;
}

/** The document `Mod-<slot>` selects, counting from one. Nothing, past the last tab. */
export const documentAtSlot = (workspace: Workspace, slot: number): DocumentState | undefined =>
  workspace.documents[slot - 1];
