// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it } from 'vitest';

import { createCommandRegistry } from './commands.js';
import { type EditorHandle, type LanguageName, createEditor } from './editor.js';
import {
  type VimContribution,
  resetVimContributionsForTest,
  setVimContributions,
} from './vim-contributions.js';

/** vim-commentary's `gc`, as the desktop's built-in contribution maps it (TYTO-418). */
const COMMENTARY: VimContribution = {
  id: 'commentary',
  mappings: [{ keys: 'gc', operation: 'comment' }],
};

const handles: EditorHandle[] = [];

afterEach(() => {
  resetVimContributionsForTest();
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

const open = (doc: string, language: LanguageName = 'brief'): EditorView => {
  const parent = document.body.appendChild(document.createElement('div'));
  const handle = createEditor(parent, {
    doc,
    language,
    commands: createCommandRegistry(),
    vim: true,
    vimStatus: false,
  });
  handles.push(handle);
  return handle.view;
};

type VimEditor = Parameters<typeof Vim.handleKey>[0];

const press = (view: EditorView, sequence: string): void => {
  const adapter = getCM(view) as unknown as VimEditor;
  for (const key of sequence) Vim.handleKey(adapter, key, 'user');
};

/**
 * The cursor to the start of a line by dispatch: `j` cannot do it, because jsdom has no layout
 * and the engine's vertical motions read it.
 */
const toLine = (view: EditorView, line: number): void => {
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(line).from) });
};

/** Text before, keys from the start of `line`, text after: the shape every case below has. */
const after = (
  doc: string,
  sequence: string,
  language: LanguageName = 'brief',
  line = 1,
): string => {
  const view = open(doc, language);
  toLine(view, line);
  press(view, sequence);
  return view.state.doc.toString();
};

const on = (): void => {
  const result = setVimContributions([COMMENTARY], ['commentary']);
  expect(result.ok && result.diagnostics).toEqual([]);
};

describe('commentary (TYTO-418, ADR 0143)', () => {
  it('gcc comments the line in a brief, and gcc again uncomments it', () => {
    on();
    expect(after('scene a\nscene b', 'gcc')).toBe('// scene a\nscene b');
    expect(after('// scene a\nscene b', 'gcc')).toBe('scene a\nscene b');
  });

  it('gc takes a count or a motion: 2gcc comments two lines, gcG to the end', () => {
    on();
    expect(after('a\nb\nc', '2gcc')).toBe('// a\n// b\nc');
    expect(after('a\nb\nc', 'gcG', 'brief', 2)).toBe('a\n// b\n// c');
  });

  it('gc in visual mode comments the selected lines', () => {
    on();
    expect(after('a\nb\nc', 'VGgc', 'brief', 2)).toBe('a\n// b\n// c');
  });

  it('. repeats it on the line the cursor is on', () => {
    on();
    const view = open('a\nb\nc');
    toLine(view, 1);
    press(view, 'gcc');
    toLine(view, 3);
    press(view, '.');
    expect(view.state.doc.toString()).toBe('// a\nb\n// c');
  });

  it("wraps a template's line in a block comment, the only comment the language has", () => {
    on();
    expect(after('<p>a</p>\n<p>b</p>', 'gcc', 'template')).toBe('<!-- <p>a</p> -->\n<p>b</p>');
  });

  it('wraps a Markdown line in a block comment too', () => {
    on();
    expect(after('# Notas\n\nUma linha.\n', 'gcc', 'markdown', 3)).toBe(
      '# Notas\n\n<!-- Uma linha. -->\n',
    );
  });

  it("switched off, gc is vim's own again: a line comment in a brief, nothing in a template", () => {
    setVimContributions([COMMENTARY], ['commentary']);
    setVimContributions([COMMENTARY], []);

    expect(after('scene a\nscene b', 'gcc')).toBe('// scene a\nscene b');
    expect(after('<p>a</p>\n<p>b</p>', 'gcc', 'template')).toBe('<p>a</p>\n<p>b</p>');
  });
});
