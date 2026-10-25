// @vitest-environment jsdom
import { type EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorHandle, createEditor } from './editor.js';
import { type LineNumbersStyle, relativeLineNumber } from './line-numbers.js';

/**
 * The `lineNumbers` option and `setLineNumbers` (TYTO-415): absolute, relative to the cursor's
 * line, or none — in every pane and in a tab shown after the switch.
 */

const DOC = 'um\ndois\ntrês\nquatro\ncinco\n';

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const mount = (lineNumbers?: LineNumbersStyle): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc: DOC,
    ...(lineNumbers === undefined ? {} : { lineNumbers }),
  });
  return handle;
};

/** The numbers the gutter shows, top to bottom, without the hidden spacer. */
const numbers = (view: EditorView): string[] | null => {
  const gutter = view.dom.querySelector('.cm-lineNumbers');
  if (gutter === null) return null;
  return [...gutter.querySelectorAll<HTMLElement>('.cm-gutterElement')]
    .filter((element) => element.style.visibility !== 'hidden')
    .map((element) => element.textContent ?? '');
};

const toLine = (view: EditorView, line: number): void => {
  view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
};

describe('relativeLineNumber', () => {
  it("is the line's own number on the cursor's line and the distance elsewhere", () => {
    expect(relativeLineNumber(3, 3)).toBe(3);
    expect(relativeLineNumber(1, 3)).toBe(2);
    expect(relativeLineNumber(6, 3)).toBe(3);
  });
});

describe('the lineNumbers option', () => {
  it('numbers each line by default', () => {
    const { view } = mount();
    toLine(view, 3);
    expect(numbers(view)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('numbers lines by their distance to the cursor, following it', () => {
    const { view } = mount('relative');
    toLine(view, 3);
    expect(numbers(view)).toEqual(['2', '1', '3', '1', '2', '3']);
    toLine(view, 5);
    expect(numbers(view)).toEqual(['4', '3', '2', '1', '5', '1']);
  });

  it('follows the head of a selection', () => {
    const { view } = mount('relative');
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.line(2).from } });
    expect(numbers(view)).toEqual(['1', '2', '1', '2', '3', '4']);
  });

  it('shows no line numbers when off', () => {
    expect(numbers(mount('off').view)).toBeNull();
  });

  it('switches in every pane, keeping the text', () => {
    const editor = mount();
    const second = document.createElement('div');
    document.body.append(second);
    const pane = editor.createPane(second);
    editor.setLineNumbers('off');
    expect(numbers(editor.view)).toBeNull();
    expect(numbers(pane.view)).toBeNull();
    editor.setLineNumbers('relative');
    toLine(editor.view, 2);
    expect(numbers(editor.view)).toEqual(['1', '2', '1', '2', '3', '4']);
    expect(numbers(pane.view)).not.toBeNull();
    expect(editor.getValue()).toBe(DOC);
  });

  it('brings a tab built before the switch up to it when the tab is shown', () => {
    const editor = mount();
    const tab = editor.blank('a\nb\n');
    editor.setLineNumbers('off');
    editor.restore(tab);
    expect(numbers(editor.view)).toBeNull();
  });
});
