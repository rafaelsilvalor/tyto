import { hasBeenEdited } from '@tyto/editor';

import type { IpcRequest } from '../../shared/ipc.js';
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
 */
export function sessionOf(workspace: Workspace): Omit<IpcRequest<'session:write'>, 'final'> {
  const kept = workspace.documents.filter(isKept);
  const at = kept.findIndex((document_) => document_.id === workspace.activeId);
  return {
    tabs: kept.map((document_) => ({
      documentId: document_.id,
      kind: document_.kind ?? 'brief',
      draft:
        isUnsaved(document_) || document_.name === undefined
          ? { text: contentOf(document_), savedText: document_.savedText }
          : null,
    })),
    active: Math.max(at, 0),
  };
}

const isKept = (document_: DocumentState): boolean =>
  document_.name !== undefined ||
  isUnsaved(document_) ||
  (document_.state !== undefined && hasBeenEdited(document_.state));
