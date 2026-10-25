import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * The cursor's line, shaded — **only while nothing is selected** (TYTO-414), VS Code's look.
 *
 * CodeMirror's own `highlightActiveLine` shades the line of every range's head whatever the
 * range holds, so a word picked with vim's `v`, a block from `Ctrl+V` or a drag with the mouse
 * showed two shadings on one line: the selection and, over it, the line's. With text selected the
 * selection is the one thing worth seeing, so the line's shading goes until the selection is
 * empty again. The gutter's number keeps its own shading, as VS Code's does.
 *
 * Same class as CodeMirror's, so the theme's `.cm-activeLine` colour and every test that looks
 * for the class read it unchanged.
 */

const lineShade = Decoration.line({ class: 'cm-activeLine' });

/** One decoration per line holding a caret, or none when any range selects text. */
export function activeLineDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { ranges } = state.selection;
  if (ranges.some((range) => !range.empty)) return builder.finish();
  let lastLineStart = -1;
  for (const range of ranges) {
    const line = state.doc.lineAt(range.head);
    // Ranges are sorted, so two carets on one line are neighbours and the line is shaded once.
    if (line.from > lastLineStart) {
      builder.add(line.from, line.from, lineShade);
      lastLineStart = line.from;
    }
  }
  return builder.finish();
}

export function activeLine(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = activeLineDecorations(view.state);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet) {
          this.decorations = activeLineDecorations(update.state);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
