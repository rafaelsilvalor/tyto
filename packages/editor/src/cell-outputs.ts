import {
  type ChangeDesc,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

/**
 * Block widgets under a line — a notebook's output under its cell (TYTO-377).
 *
 * The host says what goes under which line; this keeps it there while the person types. It
 * knows nothing about what an output shows: the host hands over a `render()` that builds the
 * element, and a `key` that names its content.
 *
 * **A key is a promise that the content has not changed.** An entry whose key the editor
 * already holds keeps the element it built the first time, and its `render` is not called
 * again: a table re-sent with the same key does not flicker, and the scroll inside it, a
 * selection in it, survive. New content takes a new key.
 *
 * The output follows its line through edits: a line inserted above moves it down, typing in
 * the line keeps it there, and deleting the line — its text and a line break with it — drops
 * the output, since the cell it showed the result of is gone.
 */

export interface CellOutput {
  /** A position in the document; the output goes under the line holding it. */
  readonly at: number;
  /** Names the content: the same key keeps the element already built. */
  readonly key: string;
  /** Builds the element, once per key and pane. */
  readonly render: () => HTMLElement;
}

/** Replaces every output with these. An empty list clears them. */
export const setCellOutputs = StateEffect.define<readonly CellOutput[]>();

/** Removes every output. */
export const clearCellOutputs = (): StateEffect<readonly CellOutput[]> => setCellOutputs.of([]);

/** An output with its line's start, which is what maps through an edit. */
interface Placed {
  readonly lineStart: number;
  readonly key: string;
  readonly render: () => HTMLElement;
}

function place(doc: Text, outputs: readonly CellOutput[]): readonly Placed[] {
  const placed: Placed[] = [];
  for (const output of outputs) {
    if (!Number.isInteger(output.at) || output.at < 0 || output.at > doc.length) continue;
    placed.push({ lineStart: doc.lineAt(output.at).from, key: output.key, render: output.render });
  }
  return placed;
}

/**
 * Whether an edit deleted the whole line `[from, to]` together with a line break next to it —
 * the line is gone, and not just emptied or joined with its neighbour.
 */
function lineDeleted(changes: ChangeDesc, from: number, to: number): boolean {
  let deleted = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= from && toA >= to && (fromA < from || toA > to)) deleted = true;
  });
  return deleted;
}

/**
 * Maps each output's line start through the edit. Association to the right, so a line
 * inserted at the very start of this one (`text\n` typed before it) pushes the output down
 * with its line instead of leaving it on the new one.
 */
function mapPlaced(
  placed: readonly Placed[],
  before: Text,
  changes: ChangeDesc,
  after: Text,
): Placed[] {
  const mapped: Placed[] = [];
  for (const output of placed) {
    const line = before.lineAt(output.lineStart);
    if (lineDeleted(changes, line.from, line.to)) continue;
    const moved = changes.mapPos(output.lineStart, 1);
    mapped.push({ ...output, lineStart: after.lineAt(moved).from });
  }
  return mapped;
}

/** The elements already built, per pane and key: one element can only be in one pane. */
const built = new WeakMap<EditorView, Map<string, HTMLElement>>();

function elementsOf(view: EditorView): Map<string, HTMLElement> {
  let elements = built.get(view);
  if (elements === undefined) {
    elements = new Map();
    built.set(view, elements);
  }
  return elements;
}

class OutputWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly render: () => HTMLElement,
  ) {
    super();
  }

  override eq(other: OutputWidget): boolean {
    return other.key === this.key;
  }

  override toDOM(view: EditorView): HTMLElement {
    const elements = elementsOf(view);
    const known = elements.get(this.key);
    if (known !== undefined) return known;
    const element = this.render();
    element.classList.add('cm-cell-output');
    elements.set(this.key, element);
    return element;
  }

  // The output is the host's: clicks, selection and keys inside it are not the editor's.
  override ignoreEvent(): boolean {
    return true;
  }
}

function decorate(doc: Text, placed: readonly Placed[]): DecorationSet {
  return Decoration.set(
    placed.map((output) =>
      Decoration.widget({
        widget: new OutputWidget(output.key, output.render),
        block: true,
        side: 1,
      }).range(doc.lineAt(output.lineStart).to),
    ),
    true,
  );
}

interface Outputs {
  readonly placed: readonly Placed[];
  readonly decorations: DecorationSet;
}

const outputsField = StateField.define<Outputs>({
  create: () => ({ placed: [], decorations: Decoration.none }),
  update(value, transaction) {
    let placed = value.placed;
    if (!transaction.changes.empty) {
      placed = mapPlaced(
        placed,
        transaction.startState.doc,
        transaction.changes,
        transaction.newDoc,
      );
    }
    for (const effect of transaction.effects) {
      if (effect.is(setCellOutputs)) placed = place(transaction.newDoc, effect.value);
    }
    if (placed === value.placed) return value;
    return { placed, decorations: decorate(transaction.newDoc, placed) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Forgets the elements of keys no longer shown, so a dropped output is not held forever. */
const forgetDropped = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      const before = update.startState.field(outputsField);
      const after = update.state.field(outputsField);
      if (before === after) return;
      const kept = new Set(after.placed.map((output) => output.key));
      const elements = elementsOf(update.view);
      for (const key of elements.keys()) if (!kept.has(key)) elements.delete(key);
    }
  },
);

/** Mount once; the host then dispatches `setCellOutputs` to say what goes where. */
export function cellOutputs(): Extension {
  return [outputsField, forgetDropped];
}

/** The outputs as they stand: each key and the line (1-based) it sits under. */
export function cellOutputsOf(
  state: EditorState,
): readonly { readonly key: string; readonly line: number }[] {
  const value = state.field(outputsField, false);
  if (value === undefined) return [];
  return value.placed.map((output) => ({
    key: output.key,
    line: state.doc.lineAt(output.lineStart).number,
  }));
}
