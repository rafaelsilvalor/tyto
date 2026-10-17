// @vitest-environment jsdom
import {
  autocompletion,
  completionStatus,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { briefLanguage } from './brief-language.js';
import { createEditor, type EditorHandle } from './editor.js';

/**
 * Enter in a brief (TYTO-305): through a real editor and its real keymap order, so what is
 * tested is that the brief's Enter is the one reached — ahead of `defaultKeymap`, behind an
 * open completion list — and not only what the command computes.
 *
 * `|` in a document marks the cursor; `[` and `]` a selection.
 */

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

interface Marked {
  readonly doc: string;
  readonly anchor: number;
  readonly head: number;
}

const unmark = (marked: string): Marked => {
  const cursor = marked.indexOf('|');
  if (cursor >= 0) {
    return { doc: marked.replace('|', ''), anchor: cursor, head: cursor };
  }
  const anchor = marked.indexOf('[');
  const head = marked.indexOf(']') - 1;
  return { doc: marked.replace('[', '').replace(']', ''), anchor, head };
};

/** The document with `|` where the cursor is. */
const marked = (view: EditorView): string => {
  const { head } = view.state.selection.main;
  const doc = view.state.doc.toString();
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
};

const open = (
  text: string,
  options: { language?: 'brief' | 'json'; vim?: boolean } = {},
): EditorView => {
  const { doc, anchor, head } = unmark(text);
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc,
    language: options.language ?? 'brief',
    vim: options.vim ?? false,
  });
  handle.view.dispatch({ selection: { anchor, head } });
  return handle.view;
};

const press = (view: EditorView, key: string, init: KeyboardEventInit = {}): boolean =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor');

/**
 * A real keydown on the content, which is where vim's engine listens ahead of the keymaps;
 * `runScopeHandlers` would skip the engine and reach the bindings directly.
 */
const keydown = (view: EditorView, key: string): void => {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
};

/** Enter `times` times, then the document with the cursor marked. */
const enter = (text: string, times = 1): string => {
  const view = open(text);
  for (let count = 0; count < times; count += 1) press(view, 'Enter');
  return marked(view);
};

describe('Enter in a brief', () => {
  it('on a line with text inside a block, opens a line at that line’s indent', () => {
    expect(enter('::lamina\n      ORTOPEDISTA|')).toBe('::lamina\n      ORTOPEDISTA\n      |');
  });

  it('on a blank line after text, keeps the blank line and the block’s indent', () => {
    // The blank line is left empty: its spaces mean nothing to the language (ADR 0087).
    expect(enter('::lamina\n      ORTOPEDISTA\n      |')).toBe(
      '::lamina\n      ORTOPEDISTA\n\n      |',
    );
    // Typed down to column 0 by hand first: the indent is the previous line's all the same.
    expect(enter('::lamina\n      ORTOPEDISTA\n|')).toBe('::lamina\n      ORTOPEDISTA\n\n      |');
  });

  it('on a second blank line in a row, adds no line and goes back to column 0', () => {
    expect(enter('::lamina\n      ORTOPEDISTA\n\n      |')).toBe(
      '::lamina\n      ORTOPEDISTA\n\n|',
    );
    // And a third Enter there changes nothing: it is already at column 0.
    expect(enter('::lamina\n      ORTOPEDISTA\n\n|')).toBe('::lamina\n      ORTOPEDISTA\n\n|');
    // A line of spaces counts as blank, as the grammar reads it.
    expect(enter('::lamina\n      X\n   \t\n      |')).toBe('::lamina\n      X\n   \t\n|');
  });

  it('types a block with Enter only: text, a blank line, text, and out', () => {
    expect(enter('::lamina\n      ORTOPEDISTA|', 3)).toBe('::lamina\n      ORTOPEDISTA\n\n|');
  });

  it('at column 0, opens a line at column 0', () => {
    expect(enter('::titulo Olá|')).toBe('::titulo Olá\n|');
    expect(enter('::lamina|')).toBe('::lamina\n|');
  });

  it('with the cursor before the text, moves the line down and keeps its indent', () => {
    expect(enter('::lamina\n|      ORTOPEDISTA')).toBe('::lamina\n\n      |ORTOPEDISTA');
    expect(enter('::lamina\n   |   ORTOPEDISTA')).toBe('::lamina\n\n      |ORTOPEDISTA');
  });

  it('in the middle of a line, splits it and keeps the indent on both halves', () => {
    expect(enter('::lamina\n      10-09 - 20h |Cuidado')).toBe(
      '::lamina\n      10-09 - 20h \n      |Cuidado',
    );
  });

  it('with a selection, replaces it and keeps the indent of the line it starts on', () => {
    expect(enter('::lamina\n      ORTO[PEDISTA\n      10-09]X')).toBe(
      '::lamina\n      ORTO\n      |X',
    );
  });

  it('in the frontmatter, leaves Enter to CodeMirror', () => {
    // The YAML is its own business; the second blank line rule does not reach into it.
    expect(enter('---\ntemplate: x\n\n|\n---\n::titulo A')).toBe(
      '---\ntemplate: x\n\n\n|\n---\n::titulo A',
    );
    // An unclosed frontmatter is still one being typed.
    expect(enter('---\ntemplate: x\n\n|')).toBe('---\ntemplate: x\n\n\n|');
    // Past the closing fence the brief's rule is back.
    expect(enter('---\ntemplate: x\n---\n::lamina\n  A\n\n  |')).toBe(
      '---\ntemplate: x\n---\n::lamina\n  A\n\n|',
    );
  });

  it('leaves Shift+Enter to CodeMirror', () => {
    const view = open('::lamina\n      X\n\n      |');
    expect(press(view, 'Enter', { shiftKey: true })).toBe(true);
    // CodeMirror's own newline, not the reset: a line was added.
    expect(view.state.doc.lines).toBe(5);
  });

  it('is not in a JSON tab, which keeps CodeMirror’s Enter', () => {
    const view = open('{\n  "a": 1,\n\n  |', { language: 'json' });
    press(view, 'Enter');
    expect(view.state.doc.lines).toBe(5);
  });

  it('follows the rule in vim insert mode', () => {
    const view = open('::lamina\n      X\n\n      |', { vim: true });
    const cm = getCM(view);
    if (cm === null) throw new Error('the view is not in vim mode');
    Vim.handleKey(cm as Parameters<typeof Vim.handleKey>[0], 'a', 'user');
    expect(cm.state.vim?.insertMode).toBe(true);
    keydown(view, 'Enter');
    expect(marked(view)).toBe('::lamina\n      X\n\n|');
  });

  it('leaves Enter in vim normal mode to the engine, which edits nothing', () => {
    const view = open('::lamina\n      |X\n\n      Y', { vim: true });
    const cm = getCM(view);
    if (cm === null) throw new Error('the view is not in vim mode');
    keydown(view, 'Enter');
    expect(cm.state.vim?.insertMode).toBe(false);
    // The engine took the key: the cursor went down, as `<CR>` does.
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBeGreaterThan(2);
    expect(view.state.doc.toString()).toBe('::lamina\n      X\n\n      Y');
  });
});

describe('Enter with an open completion list', () => {
  const source = (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\w+/);
    return word === null ? null : { from: word.from, options: [{ label: 'ORTOPEDISTA' }] };
  };

  it('accepts the completion and opens no line', async () => {
    const { doc, anchor } = unmark('::lamina\n      ORT|');
    const parent = document.createElement('div');
    document.body.append(parent);
    handle = createEditor(parent, {
      doc,
      extensions: [autocompletion(), briefLanguage.data.of({ autocomplete: source })],
    });
    const view = handle.view;
    view.dispatch({ selection: { anchor } });
    startCompletion(view);
    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe('active');
    });
    // CodeMirror refuses to accept within its interaction delay of the list opening (75 ms).
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(press(view, 'Enter')).toBe(true);
    expect(marked(view)).toBe('::lamina\n      ORTOPEDISTA|');
  });
});
