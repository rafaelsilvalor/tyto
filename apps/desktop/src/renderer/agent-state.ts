import type { IpcRequest } from '../../shared/ipc.js';

/**
 * What the window answers an agent's `agent:state` (TYTO-566, ADR 0180): the document in front
 * and the editor's selection, lines and columns from 1 as the problems panel counts them. A
 * pure function of the two, so the shape is tested without a window.
 */

type AgentState = Extract<IpcRequest<'agent:reply'>['answer'], { state: unknown }>['state'];

/** The selection's ranges an answer carries at most; the schema's ceiling. */
export const MAX_RANGES = 100;

/** The part of CodeMirror's `EditorState` this reads; the editor's own state is one. */
export interface SelectionSource {
  readonly doc: { lineAt(offset: number): { readonly number: number; readonly from: number } };
  readonly selection: {
    readonly ranges: readonly { readonly from: number; readonly to: number }[];
  };
  sliceDoc(from: number, to: number): string;
}

export interface FrontDocument {
  readonly id: string;
  readonly name: string | undefined;
  /** Absent for a brief, as `DocumentState.kind` is. */
  readonly kind: string | undefined;
  readonly text: string;
  readonly unsaved: boolean;
  /** The format the preview shows; a brief's only. */
  readonly format: string | undefined;
}

function position(state: SelectionSource, offset: number): { line: number; column: number } {
  const line = state.doc.lineAt(offset);
  return { line: line.number, column: offset - line.from + 1 };
}

export function agentStateOf(
  front: FrontDocument | undefined,
  editor: SelectionSource | undefined,
): AgentState {
  if (front === undefined) return null;
  const ranges =
    editor === undefined
      ? null
      : editor.selection.ranges.slice(0, MAX_RANGES).map((range) => ({
          from: position(editor, range.from),
          to: position(editor, range.to),
          text: editor.sliceDoc(range.from, range.to),
        }));
  return {
    documentId: front.id,
    name: front.name ?? null,
    kind: front.kind ?? 'brief',
    text: front.text,
    unsaved: front.unsaved,
    format: front.format ?? null,
    ranges,
  };
}
