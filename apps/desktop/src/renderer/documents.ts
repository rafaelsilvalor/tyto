import { type EditorState, type ScrollPosition, textOf } from '@tyto/editor';

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
 * Nothing here touches the DOM, the bridge or CodeMirror. An `EditorState` is opaque —
 * `@tyto/editor` owns the dependency, hands the type back, and `textOf` is the one field
 * read anything outside that package is offered.
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
  /**
   * The text that is in the file — and the **empty string for a document that is in no
   * file at all** (ADR 0026, ratifying D3).
   *
   * It is what {@link isUnsaved} compares against, and it is the whole of the unsaved
   * marker: there is no flag anywhere that says a document has been typed in. It moves in
   * four places and no others. Three are a moment when this document and a disk agreed —
   * {@link newDocument} (nothing, in no file), a file arriving from `file:open` or
   * `file:reopen` — read back out of the buffer CodeMirror built from it, because CodeMirror
   * normalises line endings and a CR LF brief is a supported input (TYTO-64) — and the string
   * `file:save` reports having written. The fourth is
   * {@link releaseDocument}, which empties it, because the tab has stopped being in a file
   * at all.
   *
   * **A string and not CodeMirror's `Text`**, which is what D3 names. `textOf` is the only
   * read `@tyto/editor` offers and a `Text` is not reachable through it — and it is also not
   * wanted here, because both ends of the comparison cross the bridge as strings anyway:
   * `openDocument.text` in `shared/ipc.ts` is what main read off the disk and what main says
   * it wrote. The rule D3 states survives; the type it states does not.
   *
   * **The empty string is a real answer and not a placeholder.** A document with no file has
   * nothing on disk it could differ from, so the comparison reads it as unsaved the moment
   * it holds a character and as saved while it holds none — which is exactly the tab the
   * window opens on, and exactly what a released tab becomes (ADR 0026).
   */
  readonly savedText: string;
  /**
   * The text, the undo history and the cursor — the document itself, which this record owns
   * (D1, TYTO-115).
   *
   * **Live, not refreshed at a hand-off.** An update listener in `main.ts` writes the state
   * of every transaction here, so "what does this tab say right now" is a question the
   * workspace answers for *every* document rather than only for the one CodeMirror happens
   * to be showing. It used to be the opposite — written back when the document stopped being
   * active, and stale on purpose for exactly as long as it was in front — and that is what
   * made a derived unsaved marker (TYTO-112) and a session restore (TYTO-113) impossible to
   * write: both have to ask a question the editor was the only one who could answer.
   *
   * Absent only for the document the window opens on, before CodeMirror is mounted:
   * `main.ts` builds the workspace at module load and creates the editor after the dock has
   * arranged, which is one paint wide. Every later document is born from `editor.blank`.
   */
  readonly state: EditorState | undefined;

  /**
   * How far the pane showing this document was scrolled, or nothing for a document no pane
   * has shown yet.
   *
   * Apart from {@link state} because it is not the document's: scroll is a property of the
   * view, and two views on one document scroll independently (D7). So it is the one thing
   * that still has to be *captured* before a pane is pointed somewhere else — `captureScroll`
   * in `main.ts` — and reading it costs a layout flush, which is why it is not kept live the
   * way the state is.
   */
  readonly scroll: ScrollPosition | undefined;

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

  /**
   * The text {@link frames} were rendered from, which is not always {@link brief}.
   *
   * They part company when a compile fails: `brief:preview` answers with no frames, the
   * document keeps the artwork it had, and `brief` moves on to the text that failed because
   * the diagnostics' offsets index *that* (E9.13). So the two being different is exactly the
   * definition of "what you are looking at is older than what you are typing", and
   * {@link isStale} is that comparison and nothing else.
   *
   * **Stored rather than a boolean**, so the marker cannot be set by one code path and
   * cleared by another — the failure the unsaved dot had until TYTO-112, which made
   * {@link savedText} the same shape for the same reason.
   * Empty for a document that has never rendered, which is also when `frames` is empty, so
   * `isStale` answers `false` and the pane shows its empty state.
   */
  readonly renderedBrief: string;
}

/**
 * Whether the artwork on screen is older than the text in the editor.
 *
 * Derived on every read rather than kept: there is no state to get wrong, and a document
 * whose compile starts working again stops being stale on the answer that fixes it, without
 * anybody remembering to clear a flag.
 */
export const isStale = (document_: DocumentState): boolean =>
  document_.frames.length > 0 && document_.renderedBrief !== document_.brief;

/**
 * What this document says right now, which is a question the store answers (D1, TYTO-115).
 *
 * The empty string before CodeMirror is mounted, which is the one paint between module load
 * and `load()` in `main.ts` — the same window in which the old `editor?.getValue() ?? ''`
 * answered the same empty string. A document with no state has never been shown anything,
 * so there is nothing in it.
 */
export const contentOf = (document_: DocumentState): string =>
  document_.state === undefined ? '' : textOf(document_.state);

/**
 * Whether this document holds text that is not in a file — the unsaved dot, and the window
 * title's `(não salvo)` (ADR 0026, ratifying D3).
 *
 * **Compared on every read rather than remembered**, which is the whole card: a marker set
 * by one code path and cleared by another drifts, and the drift it had was visible — typing
 * a character and undoing it left the dot on, because the undo took the text back and
 * nothing took the flag back. There is no flag now, so there is nothing to take back.
 *
 * The comparison is total: {@link savedText} is the empty string for a document in no file,
 * so "unsaved against what?" has an answer for every document rather than for most of them.
 * The consequences are named in ADR 0026 and the one worth knowing here is that a tab that
 * lost its file (TYTO-104) is unsaved for as long as it holds a character, and clean when it
 * holds none.
 */
export const isUnsaved = (document_: DocumentState): boolean =>
  contentOf(document_) !== document_.savedText;

export interface Workspace {
  /** In tab order, left to right. **Never empty** — see {@link closeDocument}. */
  readonly documents: readonly DocumentState[];
  readonly activeId: string;
}

/** A document nobody has typed in and nobody has named, as the app opens on one. */
export function newDocument(id: string, state?: EditorState): DocumentState {
  return {
    id,
    name: undefined,
    // In no file, and holding nothing — so `isUnsaved` answers false and goes on answering
    // it until somebody types. The tab the window opens on is clean by comparison rather
    // than by a `dirty: false` anybody had to write here.
    savedText: '',
    state,
    // Nothing has shown it, so there is nowhere to put it back to but the top.
    scroll: undefined,
    frames: [],
    artworks: [],
    selection: { format: undefined, artwork: undefined },
    zoom: 'fit',
    errors: 0,
    problems: 0,
    diagnostics: [],
    brief: '',
    renderedBrief: '',
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
 * An empty tab in no file, and nothing else. Every editor does this — opening a file from a
 * blank window gives you one tab, not two — and the rule has to be exactly this narrow,
 * because getting it wrong throws away something a person wrote.
 *
 * **Two clauses where there were three, and the third stopped being true rather than being
 * dropped.** It used to also require `brief === ''`, because text restored into a buffer
 * notified nobody and a stored `dirty` could therefore be false with a whole brief in the
 * tab. A derived marker cannot be wrong about that: text in a document whose `savedText` is
 * empty *is* unsaved, whoever put it there and whether or not anything was notified.
 *
 * **"An empty tab in no file" now includes a released one** (TYTO-104), and one that was
 * typed into and then emptied — both of which a stored `dirty: true` used to keep out. It is
 * reached only for the document in front — `adopt` in `main.ts` asks about `active()` — and
 * an active, unnamed, empty tab is the scratch tab whatever it used to hold.
 *
 * **What that costs is the tab and its undo history**, which is worth saying because the
 * buffer being empty does not mean the `EditorState` is: the paragraph somebody typed and
 * deleted stops being recoverable when the next file replaces the document holding it. The
 * question this rule would rather ask is "has anything ever been typed here", which is
 * CodeMirror's `undoDepth` and a second read from `@tyto/editor` — a decision about that
 * package's surface rather than a line here (ADR 0026).
 */
export const isDisposable = (document: DocumentState): boolean =>
  document.name === undefined && !isUnsaved(document);

/**
 * Takes the file off a document, leaving every character of its text alone (TYTO-104).
 *
 * A save-as onto a file another tab has open gives the path to the tab that asked — moving
 * somebody away from the text they just wrote would be worse — so the other tab has to let
 * go, and main says which one in `file:save`'s `released` (`shared/ipc.ts`).
 *
 * What it loses is its name and the file its text was in, and the second half is the one
 * worth stating: the text is now in no file at all, so there is nothing on disk it could be
 * equal to, and the next save there has to ask where to put it. A tab still showing a name
 * would be claiming a file that a moment ago stopped being its.
 *
 * **It marks nothing.** It empties {@link DocumentState.savedText}, and being unsaved
 * follows from the comparison: a released tab holding characters differs from the empty
 * string, so the dot appears, and one holding none does not, so it stays clean. That is the
 * question TYTO-112 had to answer and ADR 0026 is where the two rejected answers are —
 * keeping the old saved text (a tab clean against a file another tab now owns) and a `null`
 * that reads as always unsaved (which would put the dot on the tab the window opens on).
 *
 * Here rather than inline in `main.ts` because this is the rule and `main.ts` is the wiring.
 */
export function releaseDocument(workspace: Workspace, id: string): Workspace {
  return updateDocument(workspace, id, (document) => ({
    ...document,
    name: undefined,
    savedText: '',
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
