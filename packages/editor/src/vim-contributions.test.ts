// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCommandRegistry } from './commands.js';
import { createEditor, type EditorHandle } from './editor.js';
import {
  type VimContribution,
  defineVimOperation,
  resetVimContributionsForTest,
  setVimContributions,
} from './vim-contributions.js';

const handles: EditorHandle[] = [];

const open = (doc: string): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const handle = createEditor(parent, { doc, commands: createCommandRegistry(), vim: true });
  handles.push(handle);
  return handle;
};

/** The engine's two spellings of one adapter; see `vim-mode.test.ts`. */
type VimEditor = Parameters<typeof Vim.handleKey>[0];

const keys = (view: EditorView, ...sequence: readonly string[]): void => {
  const adapter = getCM(view);
  if (adapter === null) throw new Error('the view is not in vim mode');
  for (const key of sequence) Vim.handleKey(adapter as unknown as VimEditor, key, 'user');
};

/**
 * A test-only operation: upper-cases the selection. Mapped on visual `S`, which vim already
 * has (`VdO`: replace the line), so "off" is visible as vim's own `S` coming back.
 */
const UPPER: VimContribution = {
  id: 'test-upper',
  mappings: [{ keys: 'S', context: 'visual', operation: 'test.upper' }],
};

beforeEach(() => {
  defineVimOperation('test.upper', {
    kind: 'action',
    run: (view) => {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: view.state.sliceDoc(from, to).toUpperCase() },
      });
    },
  });
});

afterEach(() => {
  resetVimContributionsForTest();
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

/** `vlS` on `abc` / `def`, from the start: what `S` does to a two-character selection. */
const pressVisualS = (): string => {
  const editor = open('abc\ndef');
  editor.view.dispatch({ selection: EditorSelection.cursor(0) });
  keys(editor.view, 'v', 'l', 'S');
  return editor.view.state.doc.toString();
};

describe('vim contributions (TYTO-417, ADR 0141)', () => {
  it("runs the contribution's operation when it is on", () => {
    const result = setVimContributions([UPPER], ['test-upper']);

    expect(result.ok && result.value).toEqual(['test-upper']);
    expect(result.ok && result.diagnostics).toEqual([]);
    expect(pressVisualS()).toBe('ABc\ndef');
  });

  it("gives vim's own key back when it is switched off", () => {
    setVimContributions([UPPER], ['test-upper']);
    setVimContributions([UPPER], []);

    // Vim's visual `S` replaces the line: the first line is gone and an empty one opened.
    expect(pressVisualS()).toBe('\ndef');
  });

  it('changes nothing when it is switched on twice', () => {
    setVimContributions([UPPER], ['test-upper']);
    setVimContributions([UPPER], ['test-upper']);
    // Mapped twice, one unmap would leave the second copy in force and `S` still upper-casing.
    setVimContributions([UPPER], []);

    expect(pressVisualS()).toBe('\ndef');
  });

  it('is off in every editor of the window at once, because the engine is global', () => {
    setVimContributions([UPPER], ['test-upper']);
    expect(pressVisualS()).toBe('ABc\ndef');
    expect(pressVisualS()).toBe('ABc\ndef');
  });

  it('refuses a contribution naming an operation the editor does not have', () => {
    const unknown: VimContribution = {
      id: 'test-unknown',
      mappings: [{ keys: 'S', context: 'visual', operation: 'test.missing' }],
    };

    const result = setVimContributions([unknown], ['test-unknown']);

    expect(result.ok && result.value).toEqual([]);
    expect(result.ok && result.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'E_VIM_CONTRIBUTION',
        "Vim contribution 'test-unknown' was not applied: the editor has no operation 'test.missing'.",
      ],
    ]);
    // Nothing was mapped: vim's own `S` still runs.
    expect(pressVisualS()).toBe('\ndef');
  });

  it('refuses a second contribution mapping the same keys in the same context', () => {
    const twin: VimContribution = { ...UPPER, id: 'test-twin' };

    const result = setVimContributions([UPPER, twin], ['test-upper', 'test-twin']);

    expect(result.ok && result.value).toEqual(['test-upper']);
    expect(result.ok && result.diagnostics.map((item) => item.message)).toEqual([
      "Vim contribution 'test-twin' was not applied: 'S' is already mapped by 'test-upper'.",
    ]);
  });

  it('hands an operator the range its motion covers', () => {
    defineVimOperation('test.upper-motion', {
      kind: 'operator',
      run: (view, _args, ranges) => {
        view.dispatch({
          changes: ranges.map(({ from, to }) => ({
            from,
            to,
            insert: view.state.sliceDoc(from, to).toUpperCase(),
          })),
        });
      },
    });
    setVimContributions(
      [
        {
          id: 'test-operator',
          mappings: [{ keys: 'gz', context: 'normal', operation: 'test.upper-motion' }],
        },
      ],
      ['test-operator'],
    );
    const editor = open('abc def');
    editor.view.dispatch({ selection: EditorSelection.cursor(0) });

    keys(editor.view, 'g', 'z', 'w');

    expect(editor.view.state.doc.toString()).toBe('ABC def');
  });

  it('runs an ex command while it is on, and nothing once it is off', () => {
    const ran: string[] = [];
    const registry = createCommandRegistry();
    registry.register({
      id: 'test.ex',
      run: () => {
        ran.push('test.ex');
      },
    });
    const withRegistry = createEditor(document.body.appendChild(document.createElement('div')), {
      doc: 'abc',
      commands: registry,
      vim: true,
    });
    handles.push(withRegistry);
    const contribution: VimContribution = {
      id: 'test-ex',
      mappings: [],
      ex: [{ name: 'testex', command: 'test.ex' }],
    };
    const ex = (): void => {
      Vim.handleEx(
        getCM(withRegistry.view) as unknown as Parameters<typeof Vim.handleEx>[0],
        'testex',
      );
    };

    setVimContributions([contribution], ['test-ex']);
    ex();
    setVimContributions([contribution], []);
    ex();

    expect(ran).toEqual(['test.ex']);
  });
});
