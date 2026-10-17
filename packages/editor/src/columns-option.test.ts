// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type BriefColumnStyle } from './columns.js';
import { type EditorHandle, createEditor } from './editor.js';

/**
 * The `briefColumns` option and `setBriefColumns` (TYTO-298): which marks each look puts on a
 * `|` line, in every pane and in a tab shown after the switch. Colours are the desktop suite's —
 * jsdom resolves no `var()`.
 */

const DOC = '::lamina\n  a | b | **c | d** | e\n';

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const mount = (briefColumns?: BriefColumnStyle, doc = DOC): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc, ...(briefColumns === undefined ? {} : { briefColumns }) });
  return handle;
};

/** Each mark in the pane as `class:text`, in document order. */
const marksIn = (root: ParentNode): string[] =>
  [
    ...root.querySelectorAll(
      '.cm-brief-column-separator, .cm-brief-column-even, [class*="cm-brief-column-cycle-"]',
    ),
  ].map((mark) => {
    const name = [...mark.classList].find((one) => one.startsWith('cm-brief-column'))!;
    return `${name.replace('cm-brief-column-', '')}:${(mark.textContent ?? '').trim()}`;
  });

describe('the briefColumns option', () => {
  it('marks the separators alone by default', () => {
    expect(marksIn(mount().view.dom)).toEqual(['separator:|', 'separator:|', 'separator:|']);
  });

  it('marks nothing when off', () => {
    expect(marksIn(mount('off').view.dom)).toEqual([]);
  });

  it('mutes the even columns in alternate, but not inside bold', () => {
    expect(marksIn(mount('alternate').view.dom)).toEqual([
      'separator:|',
      'even:b',
      'separator:|',
      'separator:|',
      'even:e',
    ]);
  });

  it('cycles three colours in perColumn, and leaves bold its own', () => {
    expect(marksIn(mount('perColumn').view.dom)).toEqual([
      'cycle-1:a',
      'separator:|',
      'cycle-2:b',
      'separator:|',
      'separator:|',
      'cycle-1:e',
    ]);
    // The bold's text sits under no column mark at all.
    const bold = [...handle!.view.dom.querySelectorAll('.cm-line span')].find((span) =>
      (span.textContent ?? '').includes('c | d'),
    );
    expect(bold?.closest('[class*="cm-brief-column-cycle-"]')).toBeNull();
  });

  it('marks nothing in a JSON tab', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    handle = createEditor(parent, {
      doc: '{ "a": "x | y" }',
      language: 'json',
      briefColumns: 'perColumn',
    });
    expect(marksIn(handle.view.dom)).toEqual([]);
  });

  it('switches the look in every pane, keeping the text', () => {
    const editor = mount();
    const second = document.createElement('div');
    document.body.append(second);
    const pane = editor.createPane(second);
    // A new pane starts empty; it shows a document of its own here, as a second tab would.
    pane.restore(editor.blank(DOC));
    expect(marksIn(pane.view.dom)).toContain('separator:|');
    editor.setBriefColumns('alternate');
    expect(marksIn(editor.view.dom)).toContain('even:b');
    expect(marksIn(pane.view.dom)).toContain('even:b');
    editor.setBriefColumns('off');
    expect(marksIn(editor.view.dom)).toEqual([]);
    expect(marksIn(pane.view.dom)).toEqual([]);
    expect(editor.getValue()).toBe(DOC);
  });

  it('brings a tab built before the switch up to it when the tab is shown', () => {
    const editor = mount();
    const tab = editor.blank('::a\n  x | y\n');
    editor.setBriefColumns('perColumn');
    editor.restore(tab);
    expect(marksIn(editor.view.dom)).toEqual(['cycle-1:x', 'separator:|', 'cycle-2:y']);
  });
});
