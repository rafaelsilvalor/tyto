// @vitest-environment jsdom
import { EditorSelection, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { createCommandRegistry } from './commands.js';
import { type EditorHandle, createEditor } from './editor.js';
import {
  type VimContribution,
  resetVimContributionsForTest,
  setVimContributions,
} from './vim-contributions.js';
import { exchangeEdit, pendingExchange } from './vim-exchange.js';
import { replacement } from './vim-replace-with-register.js';
import { blankLines, moveLine } from './vim-unimpaired.js';

/**
 * ReplaceWithRegister, exchange and the unimpaired subset (TYTO-419), mapped as a contribution
 * would map them. One file for the three: each mounts an editor, and jsdom costs seconds a file.
 */
const PLUGINS: readonly VimContribution[] = [
  { id: 'replaceWithRegister', mappings: [{ keys: 'gr', operation: 'replaceWithRegister' }] },
  {
    id: 'exchange',
    mappings: [
      { keys: 'x', context: 'operatorPending', operation: 'exchange.target' },
      { keys: 'c', context: 'operatorPending', operation: 'exchange.clear' },
      { keys: 'X', context: 'visual', operation: 'exchange' },
    ],
  },
  {
    id: 'unimpaired',
    mappings: [
      { keys: '[<Space>', context: 'normal', operation: 'unimpaired.blank', args: { up: true } },
      { keys: ']<Space>', context: 'normal', operation: 'unimpaired.blank' },
      { keys: '[e', context: 'normal', operation: 'unimpaired.move', args: { up: true } },
      { keys: ']e', context: 'normal', operation: 'unimpaired.move' },
    ],
  },
];

const handles: EditorHandle[] = [];

const closeAll = (): void => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
};

afterEach(() => {
  resetVimContributionsForTest();
  closeAll();
});

const open = (doc: string): EditorView => {
  const parent = document.body.appendChild(document.createElement('div'));
  const handle = createEditor(parent, {
    doc,
    language: 'brief',
    commands: createCommandRegistry(),
    vim: true,
    vimStatus: false,
  });
  handles.push(handle);
  return handle.view;
};

/** The window's key for each named key the cases type; a space is `' '`, as a browser sends. */
const NAMED: Readonly<Record<string, string>> = { '<Esc>': 'Escape', '<Space>': ' ' };

const type = (view: EditorView, sequence: string): void => {
  for (const key of sequence.match(/<[^<>]+>|[\s\S]/gu) ?? []) {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: NAMED[key] ?? key, bubbles: true, cancelable: true }),
    );
  }
};

const marked = (view: EditorView): string => {
  const doc = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
};

/** Text before with the cursor at `|`, keys, text after with the cursor at `|`. */
const after = (before: string, keys: string): string => {
  const view = open(before.replace('|', ''));
  view.dispatch({ selection: EditorSelection.cursor(before.indexOf('|')) });
  type(view, keys);
  return marked(view);
};

const on = (...ids: string[]): void => {
  const result = setVimContributions(PLUGINS, ids);
  expect(result.ok && result.diagnostics).toEqual([]);
};

describe('replaceWithRegister (TYTO-419)', () => {
  it('drops a linewise register’s last line break, and keeps a linewise target’s', () => {
    const word = { text: 'w', linewise: false };
    const lines = { text: 'a\nb\n', linewise: true };
    expect(replacement('x y', { from: 2, to: 3, linewise: false }, lines)).toEqual({
      from: 2,
      to: 3,
      insert: 'a\nb',
    });
    expect(replacement('x\ny\n', { from: 0, to: 2, linewise: true }, word)).toEqual({
      from: 0,
      to: 1,
      insert: 'w',
    });
  });

  it.each([
    ['|alpha beta', 'yiwwgriw', 'alpha |alpha'],
    ['|alpha beta gamma', 'yiwwgre', 'alpha |alpha gamma'],
    ['|w one\ntwo\nthree', 'yiw2Ggrr', 'w one\n|w\nthree'],
    ['|w one\ntwo\nthree\nfour', 'yiw2G2grr', 'w one\n|w\nfour'],
    ['|w one two', 'yiwwvegr', 'w |w two'],
    ['|top\nmid\nend', 'yy3Ggrr', 'top\nmid\n|top'],
    ['|top\nmid end', 'yy2Gwgriw', 'top\nmid |top'],
    ['|alpha beta gamma', 'yiwwgriww.', 'alpha alpha |alpha'],
  ])('%j then %j gives %j', (before, keys, expected) => {
    on('replaceWithRegister');
    expect(after(before, keys)).toBe(expected);
  });

  it('reads the register named before it, and leaves the registers as they were', () => {
    on('replaceWithRegister');
    // `"a` holds alpha, the unnamed register beta; gr over gamma reads `a`, then `p` still beta.
    expect(after('|alpha beta gamma end', '"ayiwwyiww"agriwwP')).toBe('alpha beta alpha beta|end');
  });

  it('switched off, gr is vim’s own again, which replaces nothing', () => {
    on('replaceWithRegister');
    on();
    expect(after('|alpha beta', 'yiwwgriw')).toBe('alpha |beta');
  });
});

describe('exchange (TYTO-419)', () => {
  it('swaps disjoint spans, replaces the outer with the inner, cancels other overlaps', () => {
    const span = (from: number, to: number) => ({ from, to, linewise: false });
    expect(exchangeEdit('ab cd', span(0, 2), span(3, 5))).toEqual([
      { from: 0, to: 2, insert: 'cd' },
      { from: 3, to: 5, insert: 'ab' },
    ]);
    expect(exchangeEdit('ab cd', span(0, 5), span(3, 5))).toEqual([
      { from: 0, to: 5, insert: 'cd' },
    ]);
    expect(exchangeEdit('ab cd', span(3, 5), span(0, 5))).toEqual([
      { from: 0, to: 5, insert: 'cd' },
    ]);
    expect(exchangeEdit('ab cd', span(0, 3), span(2, 5))).toEqual([]);
  });

  it.each([
    ['|one two', 'cxiwwcxiw', 'two |one'],
    ['|one two three', 'cxiwwwcxiw', 'three two |one'],
    ['one |two', 'cxiw0cxiw', '|two one'],
    ['|one\ntwo', 'cxx2Gcxx', 'two\n|one'],
    ['|a\nb\nc\nd', 'cxx3G2cxx', 'c\nd\nb\n|a'],
    ['|one two', 'cxiww.', 'two |one'],
    ['|one two', 'viwXwviwX', 'two |one'],
    ['|one two', 'cxiwcxaw', '|onetwo'],
    ['|one two', 'cxiwcxc', '|one two'],
  ])('%j then %j gives %j', (before, keys, expected) => {
    on('exchange');
    expect(after(before, keys)).toBe(expected);
  });

  it('marks the first span, maps it through edits, and cxc forgets it', () => {
    on('exchange');
    const view = open('one two');
    type(view, 'wcxiw');
    expect(pendingExchange(view)).toEqual({ from: 4, to: 7, linewise: false });
    expect(view.contentDOM.querySelector('.cm-tyto-exchange')?.textContent).toBe('two');
    view.dispatch({ changes: { from: 0, insert: '>> ' } });
    expect(pendingExchange(view)).toEqual({ from: 7, to: 10, linewise: false });
    type(view, 'cxc');
    expect(pendingExchange(view)).toBeNull();
    expect(view.contentDOM.querySelector('.cm-tyto-exchange')).toBeNull();
  });

  it('swaps in one undo step', () => {
    on('exchange');
    const view = open('one two');
    type(view, 'cxiwwcxiw');
    expect(view.state.doc.toString()).toBe('two one');
    type(view, 'u');
    expect(view.state.doc.toString()).toBe('one two');
  });

  // `c` after `c` is now exchange's motion; each case runs once without the plugin and once
  // with it, and the two must agree on the text and the cursor.
  it.each([
    ['one\n|two\nthree', 'ccX<Esc>'],
    ['one\n|two\nthree\nfour', '3ccX<Esc>'],
    ['one\n|two\nthree\nfour', 'c2cX<Esc>'],
    ['one\n    |two\nthree', 'ccX<Esc>'],
    ['    one\n    |two\n    three', 'ccX<Esc>3G.'],
    ['a\nb\n|c', 'cc<Esc>'],
    ['|one two', 'dcx'],
  ])('%j then %j is the same with exchange on as off', (before, keys) => {
    const off = after(before, keys);
    closeAll();
    on('exchange');
    expect(after(before, keys)).toBe(off);
  });

  it('switched off, visual X deletes the lines again and cx is what it was before', () => {
    const before = after('|one two', 'cxiwwcxiw');
    closeAll();
    on('exchange');
    on();
    expect(after('|one\ntwo', 'vX')).toBe('|two');
    expect(after('|one two', 'cxiwwcxiw')).toBe(before);
  });
});

describe('unimpaired (TYTO-419)', () => {
  it('moves a line past the ones between, and stops at either end', () => {
    const doc = Text.of(['a', 'b', 'c', 'd']);
    expect(moveLine(doc, 6, true, 2)).toEqual({ from: 2, to: 7, insert: 'd\nb\nc', cursor: 2 });
    expect(moveLine(doc, 0, false, 9)).toEqual({ from: 0, to: 7, insert: 'b\nc\nd\na', cursor: 6 });
    expect(moveLine(doc, 0, true, 1)).toBeUndefined();
    expect(blankLines(doc, 3, true, 2)).toEqual({ from: 2, to: 2, insert: '\n\n', cursor: 5 });
  });

  it.each([
    ['a\nb|b\nc', '[<Space>', 'a\n\nb|b\nc'],
    ['a\nb|b\nc', '2]<Space>', 'a\nb|b\n\n\nc'],
    ['a\nb|b\nc', '[e', 'b|b\na\nc'],
    ['a\nb|b\nc', ']e', 'a\nc\nb|b'],
    ['|a\nb\nc\nd', '2]e', 'b\nc\n|a\nd'],
    ['a\nb\nc\n|d', '9[e', '|d\na\nb\nc'],
    ['|a\nb\nc', ']e.', 'b\nc\n|a'],
  ])('%j then %j gives %j', (before, keys, expected) => {
    on('unimpaired');
    expect(after(before, keys)).toBe(expected);
  });

  it('moves the line by a count in one undo step', () => {
    on('unimpaired');
    const view = open('a\nb\nc\nd');
    type(view, '3]e');
    expect(view.state.doc.toString()).toBe('b\nc\nd\na');
    type(view, 'u');
    expect(view.state.doc.toString()).toBe('a\nb\nc\nd');
  });

  it('leaves the engine’s other bracket motions alone, on and switched off', () => {
    on('unimpaired');
    expect(after('f(a, |b)', '[(')).toBe('f|(a, b)');
    on();
    expect(after('f(a, |b)', '[(')).toBe('f|(a, b)');
    expect(after('a\nb|b\nc', '[e')).toBe('a\nb|b\nc');
    expect(after('a\nb|b\nc', ']<Space>')).toBe('a\nb|b\nc');
  });
});
