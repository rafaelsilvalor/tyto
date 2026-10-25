import { type EditorState, type Extension, RangeSet } from '@codemirror/state';
import { GutterMarker, lineNumberMarkers, lineNumbers } from '@codemirror/view';

/**
 * How the gutter numbers the lines (TYTO-415), VS Code's `editor.lineNumbers`: each line's own
 * number (`on`, the default), the cursor's line its own number and every other line its distance
 * to it (`relative`), or no numbers at all (`off`).
 */
export type LineNumbersStyle = 'on' | 'relative' | 'off';

export const LINE_NUMBERS_STYLES: readonly LineNumbersStyle[] = ['on', 'relative', 'off'];

/** The number line `lineNumber` shows with the cursor on line `cursorLine`, both one-based. */
export function relativeLineNumber(lineNumber: number, cursorLine: number): number {
  return lineNumber === cursorLine ? lineNumber : Math.abs(lineNumber - cursorLine);
}

const cursorLineOf = (state: EditorState): number =>
  state.doc.lineAt(state.selection.main.head).number;

/**
 * Draws nothing: it is here so that the line number gutter **redraws when the cursor changes
 * line**. CodeMirror asks for a line's number again only when the gutter's markers or its
 * configuration change, and a cursor moving changes neither; a marker on the cursor's line moves
 * with it, so the markers change exactly when the relative numbers do.
 */
class CursorLineMarker extends GutterMarker {
  override eq(other: GutterMarker): boolean {
    return other instanceof CursorLineMarker;
  }
}

const cursorLineMarker = new CursorLineMarker();

const relativeLineNumbers = (): Extension => [
  lineNumbers({
    formatNumber: (lineNumber, state) =>
      // The gutter sizes itself by formatting a number past the last line (99 for a text of 42
      // lines); that one stays absolute, so the gutter is as wide as the widest number it shows.
      lineNumber > state.doc.lines
        ? String(lineNumber)
        : String(relativeLineNumber(lineNumber, cursorLineOf(state))),
  }),
  lineNumberMarkers.compute(['selection'], (state) =>
    RangeSet.of(cursorLineMarker.range(state.doc.lineAt(state.selection.main.head).from)),
  ),
];

/** Made once each, so the editor can compare what a tab's compartment holds with the setting. */
const extensions: Readonly<Record<LineNumbersStyle, Extension>> = {
  on: lineNumbers(),
  relative: relativeLineNumbers(),
  off: [],
};

export const lineNumbersExtension = (style: LineNumbersStyle): Extension => extensions[style];
