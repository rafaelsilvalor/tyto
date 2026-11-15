// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createEditor, type EditorHandle } from './editor.js';
import { hangingColumns } from './hanging-indent.js';

/**
 * The hanging indent's width (TYTO-707). jsdom does no layout, so what is read here is the
 * style each line is given; that the continuation row lands under the first character is the
 * window's to show (`apps/desktop/e2e/hanging-indent.e2e.test.ts`).
 */

const BRIEF = [
  '::lamina', //        1: column 0
  '  dois: a', //       2
  '    quatro: b', //   3
  '      seis: c', //   4
  '\ttab: d', //        5
  '', //                6: blank
  '    ', //            7: whitespace only
  ' \tmisto: e', //     8: a space, then a tab to the next stop
].join('\n');

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
});

const mount = (doc: string, tabSize?: number): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc, ...(tabSize === undefined ? {} : { tabSize }) });
  return handle;
};

/**
 * Each line's hang in document order: its inline left padding and text indent, or `null` for a
 * line with no hanging-indent class (and then, the test requires, no inline style either).
 */
const lineStyles = (editor: EditorHandle): (string | null)[] =>
  [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')].map((line) => {
    const value = `${line.style.paddingLeft} | ${line.style.textIndent}`;
    const hung = line.classList.contains('cm-hanging-indent');
    if (hung !== (value !== ' | ')) throw new Error(`class and style disagree: '${value}'`);
    return hung ? value : null;
  });

/**
 * CodeMirror's own 6px of line padding plus the hang, the first row pulled back by it — read
 * back through an element, since jsdom writes a `calc()` in an order of its own.
 */
const hang = (columns: number): string => {
  const probe = document.createElement('div');
  probe.style.paddingLeft = `calc(6px + ${columns}ch)`;
  probe.style.textIndent = `-${columns}ch`;
  return `${probe.style.paddingLeft} | ${probe.style.textIndent}`;
};

describe('hangingColumns', () => {
  it('counts the leading spaces, and a tab to the next stop', () => {
    expect(hangingColumns('  a', 2)).toBe(2);
    expect(hangingColumns('\ta', 4)).toBe(4);
    expect(hangingColumns(' \ta', 4)).toBe(4);
  });

  it('is 0 for a line at column 0 and for one that is whitespace only', () => {
    expect(hangingColumns('a', 2)).toBe(0);
    expect(hangingColumns('', 2)).toBe(0);
    expect(hangingColumns('    ', 2)).toBe(0);
  });
});

describe('the hanging indent in the editor', () => {
  it('hangs each indented line by its own indent, and leaves the rest alone', () => {
    const editor = mount(BRIEF, 4);
    expect(lineStyles(editor)).toEqual([
      null,
      hang(2),
      hang(4),
      hang(6),
      hang(4),
      null,
      null,
      hang(4),
    ]);
  });

  it('counts a tab as tabSize columns, and follows a tabSize change without an edit', () => {
    const editor = mount('\ttab: d', 2);
    expect(lineStyles(editor)).toEqual([hang(2)]);
    editor.setTabSize(4);
    expect(lineStyles(editor)).toEqual([hang(4)]);
  });

  it('follows an edit to the indent', () => {
    const editor = mount('  a');
    editor.view.dispatch({ changes: { from: 0, insert: '    ' } });
    expect(lineStyles(editor)).toEqual([hang(6)]);
    editor.view.dispatch({ changes: { from: 0, to: 6 } });
    expect(lineStyles(editor)).toEqual([null]);
  });

  it('follows an edit that leaves the length, and so the viewport, where it was', () => {
    const editor = mount('  a\nb');
    editor.view.dispatch({ changes: { from: 0, to: 3, insert: 'a  ' } });
    expect(lineStyles(editor)).toEqual([null, null]);
    editor.view.dispatch({ changes: { from: 4, to: 5, insert: '\t' } });
    expect(lineStyles(editor)).toEqual([null, null]);
    editor.view.dispatch({ changes: { from: 0, to: 3, insert: ' \tb' } });
    expect(lineStyles(editor)).toEqual([hang(2), null]);
  });
});
