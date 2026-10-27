// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, type WidgetType } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type CellOutput,
  cellOutputs,
  cellOutputsOf,
  clearCellOutputs,
  setCellOutputs,
} from './cell-outputs.js';

/**
 * A notebook's outputs under their cells (TYTO-377), read from the DOM the view built: the
 * output is the element right after the `.cm-line` it belongs under.
 */

const DOC = ['recipe open-ads', 'where status != done', 'select key, title', 'show table'].join(
  '\n',
);

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

const open = (doc = DOC): EditorView => {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [cellOutputs()] }),
    parent: document.body,
  });
  return view;
};

let renders = 0;

const output = (lineNumber: number, key: string, on: EditorView): CellOutput => ({
  at: on.state.doc.line(lineNumber).from,
  key,
  render: () => {
    renders += 1;
    const element = document.createElement('div');
    element.textContent = `output ${key}`;
    return element;
  },
});

/** The text of the line each output sits under, in document order. */
const placement = (on: EditorView): [string, string][] =>
  [...on.contentDOM.querySelectorAll('.cm-cell-output')].map((element) => [
    element.previousElementSibling?.textContent ?? '(none)',
    element.textContent ?? '',
  ]);

const outputElement = (on: EditorView, key: string): Element | undefined =>
  [...on.contentDOM.querySelectorAll('.cm-cell-output')].find(
    (element) => element.textContent === `output ${key}`,
  );

describe('cell outputs', () => {
  it('places each output under the line holding its position', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(2, 'where', on), output(4, 'show', on)]) });

    expect(placement(on)).toEqual([
      ['where status != done', 'output where'],
      ['show table', 'output show'],
    ]);
    expect(cellOutputsOf(on.state)).toEqual([
      { key: 'where', line: 2 },
      { key: 'show', line: 4 },
    ]);
  });

  it('moves an output down with its line when a line is inserted above it', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(3, 'select', on)]) });

    // Typed at the very start of the output's line: the new line is above it, not it.
    on.dispatch({ changes: { from: on.state.doc.line(3).from, insert: 'sort points desc\n' } });

    expect(placement(on)).toEqual([['select key, title', 'output select']]);
    expect(cellOutputsOf(on.state)).toEqual([{ key: 'select', line: 4 }]);
  });

  it('keeps an output on its line while the line is typed in', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(2, 'where', on)]) });

    on.dispatch({ changes: { from: on.state.doc.line(2).from, insert: '  ' } });
    on.dispatch({ changes: { from: on.state.doc.line(2).to, insert: ' AND points > 1' } });

    expect(placement(on)).toEqual([['  where status != done AND points > 1', 'output where']]);
  });

  it("drops an output when its line is deleted, and keeps the others' places", () => {
    const on = open();
    on.dispatch({
      effects: setCellOutputs.of([output(2, 'where', on), output(3, 'select', on)]),
    });

    const line = on.state.doc.line(2);
    on.dispatch({ changes: { from: line.from, to: line.to + 1 } });

    expect(placement(on)).toEqual([['select key, title', 'output select']]);
    expect(cellOutputsOf(on.state)).toEqual([{ key: 'select', line: 2 }]);
  });

  it('drops the output of the last line when that line is deleted with the break before it', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(4, 'show', on)]) });

    const line = on.state.doc.line(4);
    on.dispatch({ changes: { from: line.from - 1, to: line.to } });

    expect(placement(on)).toEqual([]);
  });

  it('keeps the element of a key the editor already holds, through a re-send and an edit', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(3, 'select', on)]) });
    const first = outputElement(on, 'select');
    const rendersBefore = renders;

    on.dispatch({ effects: setCellOutputs.of([output(3, 'select', on)]) });
    on.dispatch({ changes: { from: 0, insert: '# a comment\n' } });

    expect(first).toBeDefined();
    expect(outputElement(on, 'select')).toBe(first);
    expect(renders).toBe(rendersBefore);
  });

  it('keeps the element while its own line is typed in and the output is re-sent', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(3, 'select', on)]) });
    const first = outputElement(on, 'select');
    const rendersBefore = renders;

    // The edit and the re-send together, as a host re-running a cell on each keystroke would.
    on.dispatch({
      changes: { from: on.state.doc.line(3).to, insert: ', status' },
      effects: setCellOutputs.of([output(3, 'select', on)]),
    });
    on.dispatch({
      changes: {
        from: on.state.doc.line(3).from,
        to: on.state.doc.line(3).to,
        insert: 'select key',
      },
    });

    expect(placement(on)).toEqual([['select key', 'output select']]);
    expect(outputElement(on, 'select')).toBe(first);
    expect(renders).toBe(rendersBefore);
  });

  it('hands back the element already built when the view asks for it again', () => {
    // A block widget scrolled out of the viewport is dropped from the DOM and asked for again
    // when it comes back. jsdom has no layout to scroll, so the test asks the way the view does.
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(3, 'select', on)]) });
    const widgets: WidgetType[] = [];
    for (const source of on.state.facet(EditorView.decorations)) {
      const set = typeof source === 'function' ? source(on) : source;
      set.between(0, on.state.doc.length, (_from, _to, decoration) => {
        const widget = decoration.spec.widget as WidgetType | undefined;
        if (widget !== undefined) widgets.push(widget);
      });
    }
    const rendersBefore = renders;

    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.toDOM(on)).toBe(outputElement(on, 'select'));
    expect(renders).toBe(rendersBefore);
  });

  it('builds a new element for a new key', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(3, 'select-1', on)]) });
    const first = outputElement(on, 'select-1');

    on.dispatch({ effects: setCellOutputs.of([output(3, 'select-2', on)]) });

    expect(placement(on)).toEqual([['select key, title', 'output select-2']]);
    expect(outputElement(on, 'select-2')).not.toBe(first);
  });

  it('clears every output', () => {
    const on = open();
    on.dispatch({ effects: setCellOutputs.of([output(2, 'where', on), output(4, 'show', on)]) });

    on.dispatch({ effects: clearCellOutputs() });

    expect(placement(on)).toEqual([]);
    expect(cellOutputsOf(on.state)).toEqual([]);
  });

  it('ignores an output whose position is outside the document', () => {
    const on = open();
    on.dispatch({
      effects: setCellOutputs.of([
        { at: 10_000, key: 'far', render: () => document.createElement('div') },
      ]),
    });

    expect(cellOutputsOf(on.state)).toEqual([]);
  });
});
