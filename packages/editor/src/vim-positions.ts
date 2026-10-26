import type { EditorView } from '@codemirror/view';

/** A position as the vim engine spells it: 0-based line and column, CodeMirror 5's shape. */
export interface VimPosition {
  readonly line: number;
  readonly ch: number;
}

/**
 * Clipped to the document, as CodeMirror 5's positions were: a linewise operator on the last
 * line is handed the start of the line after it, which this document does not have (TYTO-418).
 */
export const offsetOf = (view: EditorView, position: VimPosition): number => {
  const { doc } = view.state;
  if (position.line + 1 > doc.lines) return doc.length;
  const line = doc.line(position.line + 1);
  return Math.min(line.from + position.ch, line.to);
};

export const positionOf = (view: EditorView, offset: number): VimPosition => {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, ch: offset - line.from };
};
