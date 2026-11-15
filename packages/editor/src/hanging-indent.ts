import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

import { indentColumns, unitChanged } from './indent-guides.js';

/**
 * Hanging indent (TYTO-707): an indented line the editor wraps on screen keeps its indent on
 * every row it takes, so a long body line inside a block reads as part of that block instead
 * of running back to the margin on its second row.
 *
 * The usual CodeMirror technique: each indented line's left padding grows by `Nch` and its
 * `text-indent` is `-Nch`, N being its leading whitespace in columns (a tab reaching the next
 * stop, as the indent guides count it). The first row starts at column 0 as before, its
 * whitespace carrying it to the text; every continuation row starts N columns in, under the
 * first character of the text. `ch` follows the editor's face and size, so a font change needs
 * no recomputing here.
 *
 * The padding is CodeMirror's own 6px plus `Nch`: an inline `padding-left: Nch` replaced the
 * 6px, and in the window the first row of every indented line started 6px left of the others.
 *
 * Screen only: the document, the brief's meaning and the Scene do not change. A line at
 * column 0, or one that is whitespace only, gets no decoration and wraps as it always did.
 */

/**
 * CodeMirror's `.cm-line` left padding, which the hang is added to. Its base theme sets
 * `padding: 0 2px 0 6px` and no Tyto theme changes it; the e2e suite measures the first row of
 * an indented line against a line at column 0, so the day either moves it fails there.
 */
const LINE_PADDING_LEFT = '6px';

/** The style that hangs a line by `columns`. */
export function hangingStyle(columns: number): string {
  return `padding-left: calc(${LINE_PADDING_LEFT} + ${columns}ch); text-indent: -${columns}ch`;
}

/** The decoration for a line indented by `columns`, made once per width. */
const decorations = new Map<number, Decoration>();

function decorationFor(columns: number): Decoration {
  let decoration = decorations.get(columns);
  if (decoration === undefined) {
    decoration = Decoration.line({
      attributes: { style: hangingStyle(columns) },
      class: 'cm-hanging-indent',
    });
    decorations.set(columns, decoration);
  }
  return decoration;
}

/** How many columns line `text` hangs by, or 0 for one that gets no decoration. */
export function hangingColumns(text: string, tabSize: number): number {
  return indentColumns(text, tabSize) ?? 0;
}

/** The decorations for the lines in `ranges` — the visible ones, in practice. */
function build(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let previous = -1;
  for (const { from, to } of ranges) {
    for (let position = from; position <= to;) {
      const line = state.doc.lineAt(position);
      // Two visible ranges can share a line (a fold between them); a line takes one decoration.
      if (line.from > previous) {
        const columns = hangingColumns(line.text, state.tabSize);
        if (columns > 0) builder.add(line.from, line.from, decorationFor(columns));
        previous = line.from;
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * Rebuilt on an edit, a scroll that brings other lines into view, or a tab width change: the
 * three things that move a line's width. Not on the selection or the geometry.
 */
const hangingIndentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || unitChanged(update)) {
        this.decorations = build(update.state, update.view.visibleRanges);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const hangingIndentTheme = EditorView.baseTheme({
  // `text-indent` is inherited: an inline-block inside the line (a widget, a column cell)
  // would take the negative indent as its own and push its text out of its box.
  '.cm-hanging-indent *': { textIndent: '0' },
});

/** The hanging indent, for every document the editor shows: briefs, JSON, template buffers. */
export function hangingIndent(): Extension {
  return [hangingIndentPlugin, hangingIndentTheme];
}
