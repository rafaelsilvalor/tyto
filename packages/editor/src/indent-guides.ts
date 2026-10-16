import { getIndentUnit } from '@codemirror/language';
import { type EditorState, type Extension } from '@codemirror/state';
import { EditorView, layer, type LayerMarker, type ViewUpdate } from '@codemirror/view';

/**
 * Indent guides: one thin vertical line per indent level, VS Code's look (TYTO-293, ADR 0088).
 *
 * **Our own, not a package.** The one maintained-looking extension for CodeMirror 6 had not
 * published in 27 months when this was written, and the house adds no dependency for what a
 * hundred lines do (ADR 0075's reasoning, and `json-language.ts`'s). It is also simpler than
 * that package in the one way that matters here: **the levels come from the text**, each line's
 * leading whitespace measured in the editor's indent unit, and not from the syntax tree. A
 * brief's block is its indentation (`BodyLine` in `brief.grammar`), and a JSON tab and the
 * template mode's buffers get the same guides with no grammar asked anything.
 *
 * A blank line takes the lower of the levels of the nearest non-blank lines above and below
 * it, so a guide runs on through an empty line inside a block and stops at one between two
 * blocks. The guide of the block holding the cursor is drawn in a stronger colour (VS Code's
 * "active indent guide"): the block of the cursor's own level, or — on a line that opens a
 * block, like `::lamina` — the block it opens.
 *
 * Drawn as a layer behind the text, one element per guide per run of lines, so a guide is a
 * straight line through wrapped rows and blank lines, and a test can read where each one is.
 */

/** A guide: drawn at column `(level - 1) * unit`, through lines `first` to `last` (0-based). */
export interface GuideRun {
  readonly level: number;
  readonly first: number;
  readonly last: number;
}

/**
 * How many columns of leading whitespace `text` has, a tab reaching the next stop; `null` for
 * a line that is whitespace only, whose level its neighbours decide.
 */
export function indentColumns(text: string, tabSize: number): number | null {
  let columns = 0;
  for (const character of text) {
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += tabSize - (columns % tabSize);
    else return columns;
  }
  return null;
}

/**
 * Each line's indent level in units of `unit` columns. A blank line takes the lower of the
 * nearest non-blank levels above and below; with none on a side, that side counts as 0.
 */
export function indentLevels(
  lines: readonly string[],
  unit: number,
  tabSize: number,
): readonly number[] {
  const own = lines.map((line) => {
    const columns = indentColumns(line, tabSize);
    return columns === null ? null : Math.floor(columns / Math.max(unit, 1));
  });
  const levels = new Array<number>(lines.length).fill(0);
  let above = 0;
  for (let index = 0; index < own.length; index += 1) {
    const level = own[index];
    if (level !== null && level !== undefined) above = level;
    levels[index] = level ?? above;
  }
  let below = 0;
  for (let index = own.length - 1; index >= 0; index -= 1) {
    const level = own[index];
    if (level !== null && level !== undefined) below = level;
    else levels[index] = Math.min(levels[index]!, below);
  }
  return levels;
}

/** Every guide: for each level, each longest run of lines indented at least that deep. */
export function guideRuns(levels: readonly number[]): readonly GuideRun[] {
  const runs: GuideRun[] = [];
  const open: number[] = [];
  const close = (to: number, line: number): void => {
    while (open.length > to) {
      const level = open.length;
      runs.push({ level, first: open.pop()!, last: line - 1 });
    }
  };
  levels.forEach((level, line) => {
    close(level, line);
    while (open.length < level) open.push(line);
  });
  close(0, levels.length);
  return runs.sort((one, two) => one.first - two.first || one.level - two.level);
}

/**
 * The guide of the block holding line `cursor`, or `null` at the top level. A line followed by
 * a deeper one opens a block, and its active guide is the one of the block it opens.
 */
export function activeGuide(levels: readonly number[], cursor: number): GuideRun | null {
  const own = levels[cursor];
  if (own === undefined) return null;
  const opens = (levels[cursor + 1] ?? 0) > own;
  const level = opens ? own + 1 : own;
  const anchor = opens ? cursor + 1 : cursor;
  if (level === 0) return null;
  let first = anchor;
  while (first > 0 && levels[first - 1]! >= level) first -= 1;
  let last = anchor;
  while (last < levels.length - 1 && levels[last + 1]! >= level) last += 1;
  return { level, first, last };
}

/**
 * How many lines past the viewport are read on each side, so a guide entering the screen from
 * a block that starts above it is drawn, and a blank line at the edge finds its neighbours.
 */
const LOOKAROUND = 1000;

/** One guide on screen, in the layer's pixels. */
class GuideMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly height: number,
    readonly level: number,
    readonly active: boolean,
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof GuideMarker &&
      other.left === this.left &&
      other.top === this.top &&
      other.height === this.height &&
      other.level === this.level &&
      other.active === this.active
    );
  }

  draw(): HTMLElement {
    const element = document.createElement('div');
    this.paint(element);
    return element;
  }

  update(element: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof GuideMarker)) return false;
    this.paint(element);
    return true;
  }

  private paint(element: HTMLElement): void {
    element.className = this.active ? 'cm-indent-guide cm-indent-guide-active' : 'cm-indent-guide';
    element.dataset['level'] = String(this.level);
    element.style.left = `${this.left}px`;
    element.style.top = `${this.top}px`;
    element.style.height = `${this.height}px`;
  }
}

/** The lines read for one drawing: the viewport and `LOOKAROUND` lines either side. */
function linesAround(
  state: EditorState,
  from: number,
  to: number,
): { first: number; texts: string[] } {
  const first = Math.max(state.doc.lineAt(from).number - LOOKAROUND, 1);
  const last = Math.min(state.doc.lineAt(to).number + LOOKAROUND, state.doc.lines);
  const texts: string[] = [];
  for (let number = first; number <= last; number += 1) texts.push(state.doc.line(number).text);
  return { first, texts };
}

function markers(view: EditorView): readonly LayerMarker[] {
  const { state, viewport } = view;
  const { first, texts } = linesAround(state, viewport.from, viewport.to);
  const levels = indentLevels(texts, getIndentUnit(state), state.tabSize);
  const cursorLine = state.doc.lineAt(state.selection.main.head).number - first;
  const active =
    cursorLine >= 0 && cursorLine < levels.length ? activeGuide(levels, cursorLine) : null;

  // Where column 0 is: the start of the first line on screen, as RectangleMarker measures its
  // base — the scroller's corner, less how far it has scrolled.
  const start = view.coordsAtPos(state.doc.lineAt(viewport.from).from, 1);
  if (start === null) return [];
  const scroller = view.scrollDOM.getBoundingClientRect();
  const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
  const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
  const columnZero = (start.left - baseLeft) / view.scaleX;
  const documentTop = (view.documentTop - baseTop) / view.scaleY;
  const unit = getIndentUnit(state);
  const viewportFirst = state.doc.lineAt(viewport.from).number - first;
  const viewportLast = state.doc.lineAt(viewport.to).number - first;

  const drawn: GuideMarker[] = [];
  for (const run of guideRuns(levels)) {
    const from = Math.max(run.first, viewportFirst);
    const to = Math.min(run.last, viewportLast);
    if (from > to) continue;
    const top = view.lineBlockAt(state.doc.line(from + first).from).top;
    const bottom = view.lineBlockAt(state.doc.line(to + first).from).bottom;
    const isActive =
      active !== null &&
      run.level === active.level &&
      run.first === active.first &&
      run.last === active.last;
    drawn.push(
      new GuideMarker(
        columnZero + (run.level - 1) * unit * view.defaultCharacterWidth,
        documentTop + top,
        bottom - top,
        run.level,
        isActive,
      ),
    );
  }
  return drawn;
}

const guideLayer = layer({
  above: false,
  class: 'cm-indent-guides',
  markers,
  update: (update: ViewUpdate) =>
    update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged,
});

/**
 * The shape only: one pixel wide, like VS Code's. The colours are the host's tokens, which
 * `theme.ts` reads like every other (ADR 0075): `indent-guide` for a guide and
 * `indent-guide-active` for the guide of the block holding the cursor.
 */
const guideTheme = EditorView.baseTheme({
  '.cm-indent-guides': { pointerEvents: 'none' },
  '.cm-indent-guide': {
    position: 'absolute',
    width: '0',
    borderLeft: '1px solid',
  },
});

/** The guides, for a compartment the `indentGuides` setting turns on and off. */
export function indentGuides(): Extension {
  return [guideLayer, guideTheme];
}
