import { type Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

/**
 * A notebook's blocks as frames over the one editor (TYTO-676, ADR 0195): each block's lines
 * framed, and a toolbar on its first line.
 *
 * The editor stays one editor: the text, the caret, vim, search and undo are untouched, and a
 * block is only a reading of the text. The host says where the blocks are, from the text as
 * it is now ({@link NotebookFramesOptions.framesOf}), and builds each toolbar; this draws them
 * and reads them again on every edit, since a block is wherever its lines are.
 *
 * A toolbar is built once per key, as a cell's output is (`cell-outputs.ts`): the host's key
 * names everything the toolbar shows, and a new key builds a new one. A host whose own state
 * changes what a toolbar shows (a result folded) dispatches {@link refreshNotebookFrames}.
 */

export interface NotebookFrame {
  /** The offset of the block's first character; its first line holds the toolbar. */
  readonly from: number;
  /** An offset on its last line. */
  readonly to: number;
  /** A word the frame's class carries: `cm-notebook-frame--<kind>`. */
  readonly kind: string;
  /** Names what the toolbar shows: the same key keeps the toolbar already built. */
  readonly key: string;
  /** Builds the toolbar; `undefined` draws the frame with none. */
  readonly toolbar?: () => HTMLElement;
}

export interface NotebookFramesOptions {
  /** The frames of the text this view shows now, in order. */
  readonly framesOf: (view: EditorView) => readonly NotebookFrame[];
}

/** Reads the frames again: the host's own state changed what a toolbar shows. */
export const refreshNotebookFrames = StateEffect.define<null>();

class ToolbarWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly build: () => HTMLElement,
  ) {
    super();
  }

  override eq(other: ToolbarWidget): boolean {
    return other.key === this.key;
  }

  override toDOM(): HTMLElement {
    const toolbar = this.build();
    toolbar.classList.add('cm-notebook-toolbar');
    return toolbar;
  }

  // The toolbar is the host's: a click on it is not a click in the text.
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The frames' line classes and toolbars, with the frame holding the caret marked. */
function decorate(view: EditorView, frames: readonly NotebookFrame[]): DecorationSet {
  const { doc, selection } = view.state;
  const caret = doc.lineAt(selection.main.head).number;
  const builder = new RangeSetBuilder<Decoration>();
  for (const frame of frames) {
    if (frame.from < 0 || frame.to > doc.length || frame.from > frame.to) continue;
    const first = doc.lineAt(frame.from);
    const last = doc.lineAt(frame.to);
    const active = caret >= first.number && caret <= last.number;
    for (let number = first.number; number <= last.number; number += 1) {
      const classes = ['cm-notebook-frame', `cm-notebook-frame--${frame.kind}`];
      if (number === first.number) classes.push('cm-notebook-frame--first');
      if (number === last.number) classes.push('cm-notebook-frame--last');
      if (active) classes.push('cm-notebook-frame--active');
      const line = doc.line(number);
      builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }));
      if (number === first.number && frame.toolbar !== undefined) {
        builder.add(
          line.from,
          line.from,
          Decoration.widget({ widget: new ToolbarWidget(frame.key, frame.toolbar), side: -1 }),
        );
      }
    }
  }
  return builder.finish();
}

/** Mount once per editor that shows a notebook. */
export function notebookFrames(options: NotebookFramesOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorate(view, options.framesOf(view));
      }

      update(update: ViewUpdate): void {
        const refreshed = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(refreshNotebookFrames)),
        );
        if (update.docChanged || update.selectionSet || refreshed) {
          this.decorations = decorate(update.view, options.framesOf(update.view));
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
