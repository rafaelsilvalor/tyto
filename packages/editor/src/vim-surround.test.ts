// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { createCommandRegistry } from './commands.js';
import { type EditorHandle, createEditor } from './editor.js';
import {
  type VimContribution,
  resetVimContributionsForTest,
  setVimContributions,
} from './vim-contributions.js';
import { isReadingVimKeys } from './vim-key-reader.js';
import { addSurround, changeSurround, deleteSurround } from './vim-surround.js';

/** vim-surround, as the desktop's built-in contribution maps it (TYTO-418). */
const SURROUND: VimContribution = {
  id: 'surround',
  mappings: [
    { keys: 's', context: 'operatorPending', operation: 'surround.target' },
    { keys: 'S', context: 'visual', operation: 'surround.add' },
  ],
};

const handles: EditorHandle[] = [];

afterEach(() => {
  resetVimContributionsForTest();
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
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

const NAMED: Readonly<Record<string, string>> = { '<Esc>': 'Escape' };

/**
 * Every key as the window types it, a keydown on the editor, so the keys surround reads after
 * the engine's go through the same door. `<Esc>` is the one named key the cases need.
 */
const type = (view: EditorView, sequence: string): void => {
  for (const key of sequence.match(/<[^<>]+>|[\s\S]/gu) ?? []) {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: NAMED[key] ?? key, bubbles: true, cancelable: true }),
    );
  }
};

const on = (): void => {
  const result = setVimContributions([SURROUND], ['surround']);
  expect(result.ok && result.diagnostics).toEqual([]);
};

/** Text before with the cursor at `|`, keys, text after: the shape every case below has. */
const after = (marked: string, sequence: string): string => {
  const view = open(marked.replace('|', ''));
  view.dispatch({ selection: EditorSelection.cursor(marked.indexOf('|')) });
  type(view, sequence);
  return view.state.doc.toString();
};

describe('the pair arithmetic (TYTO-418)', () => {
  const apply = (text: string, edit: ReturnType<typeof deleteSurround>): string => {
    if (edit === undefined) return text;
    let out = text;
    for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) {
      out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    }
    return out;
  };

  it.each([
    ['say "hi" now', 5, '"', 'say hi now'],
    ['f( x )', 3, '(', 'fx'],
    ['f( x )', 3, ')', 'f x '],
    ['f( x )', 1, 'b', 'f x '],
    ['(a (b) c)', 1, ')', 'a (b) c'],
    ['(a (b) c)', 4, ')', '(a b c)'],
    ['(a (b) c)', 5, ')', '(a b c)'],
    ['(a\n b)', 4, ')', 'a\n b'],
    ['"a" "b"', 5, '"', '"a" b'],
    ['x "a"', 0, '"', 'x a'],
  ])('ds on %j at %i with %j gives %j', (text, head, target, expected) => {
    expect(apply(text, deleteSurround(text, head, target))).toBe(expected);
  });

  it('finds nothing to delete where the pair is not, or the key is not one', () => {
    expect(deleteSurround('no pair', 2, '(')).toBeUndefined();
    expect(deleteSurround('(a)', 1, 'x')).toBeUndefined();
    expect(deleteSurround('a "b', 3, '"')).toBeUndefined();
  });

  it.each([
    ['say "hi" now', 5, '"', "'", "say 'hi' now"],
    ['[a, b]', 1, ']', ')', '(a, b)'],
    ['[a, b]', 1, ']', '{', '{ a, b }'],
    ['( a )', 2, '(', ']', '[a]'],
    ['( a )', 2, ')', ']', '[ a ]'],
  ])('cs on %j at %i from %j to %j gives %j', (text, head, target, replacement, expected) => {
    expect(apply(text, changeSurround(text, head, target, replacement))).toBe(expected);
  });

  it.each([
    [')', '(hello) world'],
    ['(', '( hello ) world'],
    ['b', '(hello) world'],
    [']', '[hello] world'],
    ['[', '[ hello ] world'],
    ['}', '{hello} world'],
    ['{', '{ hello } world'],
    ['B', '{hello} world'],
    ['>', '<hello> world'],
    ['<', '< hello > world'],
    ['"', '"hello" world'],
    ["'", "'hello' world"],
    ['`', '`hello` world'],
  ])('ys wraps with %j as %j', (key, expected) => {
    expect(apply('hello world', addSurround('hello world', [{ from: 0, to: 5 }], key))).toBe(
      expected,
    );
  });

  it('keeps a linewise range’s last line break outside the pair', () => {
    const text = 'a\nb\nc';
    expect(apply(text, addSurround(text, [{ from: 0, to: 4 }], ')'))).toBe('(a\nb)\nc');
  });
});

describe('surround in vim mode (TYTO-418, ADR 0143)', () => {
  it.each([
    ['|hello world', 'ysiw)', '(hello) world'],
    ['|hello world', 'ysiw(', '( hello ) world'],
    ['hello |world', 'ys$"', 'hello "world"'],
    ['  say |hi', 'yss)', '  (say hi)'],
    ['say "h|i" now', 'ds"', 'say hi now'],
    ['f( |x )', 'ds(', 'fx'],
    ['f( |x )', 'ds)', 'f x '],
    ['say "h|i" now', `cs"'`, "say 'hi' now"],
    ['[a|, b]', 'cs])', '(a, b)'],
    ['[a|, b]', 'cs]{', '{ a, b }'],
    ['|hello world', 'viwS"', '"hello" world'],
    ['|hello world', 'veS]', '[hello] world'],
  ])('%j then %j gives %j', (before, keys, expected) => {
    on();
    expect(after(before, keys)).toBe(expected);
  });

  it('leaves the text alone when the pair is not around the cursor', () => {
    on();
    expect(after('|no pair', 'ds(')).toBe('no pair');
    expect(after('a |"b', 'cs"(')).toBe('a "b');
  });

  it('Escape cancels the read, and the next key is vim’s again', () => {
    on();
    const view = open('"ab"');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    type(view, 'ds<Esc>');
    expect(isReadingVimKeys(view)).toBe(false);
    type(view, 'x');
    expect(view.state.doc.toString()).toBe('"b"');
  });

  it('. repeats ds, cs and ys with the key that was read, without reading again', () => {
    on();
    const view = open('"a" "b" c d');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    type(view, 'ds"');
    view.dispatch({ selection: EditorSelection.cursor(3) });
    type(view, '.');
    expect(view.state.doc.toString()).toBe('a b c d');
    expect(isReadingVimKeys(view)).toBe(false);

    view.dispatch({ selection: EditorSelection.cursor(4) });
    type(view, 'ysiw)');
    view.dispatch({ selection: EditorSelection.cursor(8) });
    type(view, '.');
    expect(view.state.doc.toString()).toBe('a b (c) (d)');
    expect(isReadingVimKeys(view)).toBe(false);

    view.dispatch({ selection: EditorSelection.cursor(5) });
    type(view, 'cs)]');
    view.dispatch({ selection: EditorSelection.cursor(9) });
    type(view, '.');
    expect(view.state.doc.toString()).toBe('a b [c] [d]');
  });

  it('switched off, ds and visual S are vim’s own and nothing waits for a key', () => {
    const view = open('"ab"');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    type(view, 'ds');
    expect(isReadingVimKeys(view)).toBe(false);
    type(view, '<Esc>viwS');
    expect(isReadingVimKeys(view)).toBe(false);
  });

  it('refuses the s motion outside operatorPending and visual, as a text object is', () => {
    const result = setVimContributions(
      [
        {
          id: 'surround',
          mappings: [{ keys: 's', context: 'normal', operation: 'surround.target' }],
        },
      ],
      ['surround'],
    );
    expect(result.ok && result.diagnostics.map(({ code }) => code)).toEqual(['E_VIM_CONTRIBUTION']);
  });
});
