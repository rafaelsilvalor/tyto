import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

/**
 * A small square of the colour beside every hex colour in a brief's frontmatter (TYTO-835), so a
 * writer who sets \`destaque: '#e30613'\` (ADR 0226) sees the exam's colour without rendering.
 *
 * Only the frontmatter: in the body a word such as \`#bad\` or \`#face\` is a valid hex too, and a
 * square beside it would be a false alarm. The square is a widget before the code, not a
 * replacement: the text is untouched, the caret steps over it, and it follows every edit, gone as
 * soon as the code stops being a colour. A grey outline keeps it visible on a background of its
 * own colour, in the light and the dark theme alike.
 */

/** A hex colour as a declared value takes it (ADR 0153), standing alone as a word. */
const HEX = /(?<![\w#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/gu;

class Swatch extends WidgetType {
  constructor(readonly colour: string) {
    super();
  }

  override eq(other: Swatch): boolean {
    return other.colour === this.colour;
  }

  toDOM(): HTMLElement {
    const square = document.createElement('span');
    square.className = 'cm-colourSwatch';
    square.style.backgroundColor = this.colour;
    square.setAttribute('aria-hidden', 'true');
    square.title = this.colour;
    return square;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** The lines of the leading frontmatter, \`---\` to \`---\`, as a range; undefined when none. */
export function frontmatterRange(state: EditorState): { from: number; to: number } | undefined {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return undefined;
  for (let number = 2; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (line.text.trimEnd() === '---') return { from: doc.line(1).to, to: line.from };
  }
  return undefined;
}

/** A swatch before every hex colour in the frontmatter, sorted by position. */
export function swatchDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const range = frontmatterRange(state);
  if (range === undefined) return builder.finish();
  const text = state.doc.sliceString(range.from, range.to);
  for (const match of text.matchAll(HEX)) {
    const at = range.from + match.index;
    builder.add(at, at, Decoration.widget({ widget: new Swatch(match[0]), side: -1 }));
  }
  return builder.finish();
}

const swatchTheme = EditorView.baseTheme({
  '.cm-colourSwatch': {
    display: 'inline-block',
    width: '0.8em',
    height: '0.8em',
    marginRight: '0.25em',
    verticalAlign: 'middle',
    borderRadius: '2px',
    outline: '1px solid rgba(128, 128, 128, 0.6)',
    outlineOffset: '0',
  },
});

/** The swatches, recomputed on every change of the document. */
export function colourSwatches(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = swatchDecorations(view.state);
        }
        update(update: ViewUpdate): void {
          if (update.docChanged) this.decorations = swatchDecorations(update.state);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    swatchTheme,
  ];
}
