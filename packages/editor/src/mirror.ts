import { history } from '@codemirror/commands';
import { Annotation, Compartment, type EditorState, Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * One document in two panes (TYTO-286, ADR 0083).
 *
 * The document of record keeps the undo history and lives in one view, the **primary**; any
 * other pane showing the same document holds a **follower**: the same text and its own
 * selection, and no history of its own. A change made in either is copied into the other
 * under {@link mirrored}, which is how the copy is told apart from typing and is not copied
 * back. An undo asked of a follower runs in its primary, so there is one history and both
 * panes are editable.
 */

/** Marks a change copied from another pane showing the same document. */
export const mirrored = Annotation.define<boolean>();

/**
 * Where a follower's primary is. Absent from a record, which is how a state says it is one.
 *
 * The view and not a callback: the follower is rebuilt whenever its primary changes, so the
 * answer never goes stale while the state is on screen.
 */
export const primaryFacet = Facet.define<EditorView, EditorView | undefined>({
  combine: (values) => values[0],
});

/**
 * The history, in a compartment of its own so a follower can be the record without it.
 *
 * Module-level, so every editor's states agree on its identity — a compartment is a key, and
 * a state built by one handle is read by the same code whichever handle built it.
 */
export const historyCompartment = new Compartment();

export const historyExtension = () => historyCompartment.of(history());

/** The record's text and selection, with no history and pointing at `primary` for undo. */
export const followerState = (record: EditorState, primary: EditorView): EditorState =>
  record.update({
    effects: historyCompartment.reconfigure(primaryFacet.of(primary)),
  }).state;

/** Whether `state` is a follower: a pane's copy of a document whose record is elsewhere. */
export const isFollower = (state: EditorState): boolean => state.facet(primaryFacet) !== undefined;

/** The view an undo or a redo asked of `view` should run in: its primary when it has one. */
export const undoViewOf = (view: EditorView): EditorView => view.state.facet(primaryFacet) ?? view;
