import { hasBeenEdited, selectionOf } from '@tyto/editor';

import type { IpcRequest } from '../../shared/ipc.js';
import { prunedGroups } from '../../shared/session-groups.js';
import { type DocumentState, type Workspace, contentOf, isUnsaved } from './documents.js';

/**
 * What the window tells main to keep for the next launch (TYTO-113, ADR 0080).
 *
 * Ids, kinds and drafts — never a path: main files the paths itself and looks them up. A tab
 * carries a draft only when it holds text that is in no file, and the draft is the text and
 * the saved text it differs from, so main can tell later whether the file moved under it.
 *
 * **A tab in no file is kept only if somebody typed in it** (`hasBeenEdited`, TYTO-120): the
 * untouched tab the window opens on is not a session, and reopening one would be clutter. One
 * typed in and emptied is kept, as it is kept beside the next file opened, though what made it
 * worth keeping — its undo history — does not survive the restart (ADR 0080).
 *
 * Every tab also says where it was looking — its selection and its scroll, `place` (TYTO-265).
 *
 * `template` is the template mode's snapshot (TYTO-266), null while the mode is closed or was
 * never opened: its buffers and which one is in front, and no folder, which main keeps.
 */
export function sessionOf(
  workspace: Workspace,
  template: TemplateSnapshot = null,
  groups?: SessionGroups,
): Omit<IpcRequest<'session:write'>, 'final'> {
  const kept = workspace.documents.filter(isKept);
  const at = kept.findIndex((document_) => document_.id === workspace.activeId);
  const keptIds = new Set(kept.map((document_) => document_.id));
  // Only the kept documents' tabs (TYTO-286): main would drop the rest, and a tree that names
  // nothing but kept tabs is one a reader can check against the list beside it.
  const keptGroups =
    groups === undefined
      ? undefined
      : prunedGroups(groups, (tab) => (keptIds.has(tab.documentId) ? tab : undefined));
  return {
    ...(keptGroups === undefined ? {} : { groups: keptGroups }),
    tabs: kept.map((document_) => ({
      documentId: document_.id,
      kind: document_.kind ?? 'brief',
      draft:
        isUnsaved(document_) || document_.name === undefined
          ? { text: contentOf(document_), savedText: document_.savedText }
          : null,
      place: placeOf(document_),
    })),
    active: Math.max(at, 0),
    template,
  };
}

/**
 * The editor groups as the window sends them (TYTO-286): each tab names its document and says
 * where **that** tab was looking, since one document in two groups has a cursor in each.
 */
export type SessionGroups = NonNullable<IpcRequest<'session:write'>['groups']>;

/** What the template mode hands the session: `TemplateMode.snapshot()`'s answer. */
export type TemplateSnapshot = IpcRequest<'session:write'>['template'];

/**
 * Where a tab was looking (TYTO-265): the selection, off the state the workspace holds live,
 * and the scroll the pane last measured for it. For a tab in the background that is where it
 * was when it was last in front, which is where it still is; the one in front is measured
 * fresh by the caller, since its pane may have moved since. A tab never shown has scrolled
 * nowhere, and says the top.
 */
const placeOf = (document_: DocumentState): IpcRequest<'session:write'>['tabs'][number]['place'] =>
  document_.state === undefined
    ? null
    : { ...selectionOf(document_.state), top: document_.scroll?.top ?? 0 };

const isKept = (document_: DocumentState): boolean =>
  document_.name !== undefined ||
  isUnsaved(document_) ||
  (document_.state !== undefined && hasBeenEdited(document_.state));
