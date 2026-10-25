// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorHandle, createEditor } from './editor.js';

/**
 * The cursor's line is shaded only while nothing is selected (TYTO-414): a selection, from vim's
 * visual modes or anywhere else, is the one highlight on its line.
 */

const DOC = '::lamina\n  Nível Médio\n  Dutos e Terminais\n';

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const mount = (vim = false): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc: DOC, vim });
  return handle;
};

const shaded = (view: EditorView): string[] =>
  [...view.dom.querySelectorAll('.cm-activeLine')].map((line) => line.textContent ?? '');

const shadedNumbers = (view: EditorView): number =>
  view.dom.querySelectorAll('.cm-lineNumbers .cm-activeLineGutter').length;

type VimEditor = Parameters<typeof Vim.handleKey>[0];
const press = (view: EditorView, ...keys: string[]): void => {
  const adapter = getCM(view);
  if (adapter === null) throw new Error('the view is not in vim mode');
  for (const key of keys) Vim.handleKey(adapter as unknown as VimEditor, key, 'user');
};

describe("the cursor's line", () => {
  it('is shaded while the selection is a caret', () => {
    const { view } = mount();
    view.dispatch({ selection: { anchor: 12 } });
    expect(shaded(view)).toEqual(['  Nível Médio']);
  });

  it('is not shaded while text is selected, and its number still is', () => {
    const { view } = mount();
    view.dispatch({ selection: { anchor: 11, head: 22 } });
    expect(shaded(view)).toEqual([]);
    expect(shadedNumbers(view)).toBe(1);
    view.dispatch({ selection: { anchor: 22 } });
    expect(shaded(view)).toEqual(['  Nível Médio']);
  });

  it('is not shaded when one of several ranges selects text', () => {
    const { view } = mount();
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.range(11, 16)]),
    });
    expect(shaded(view)).toEqual([]);
  });

  it('shades every line holding a caret, once each', () => {
    const { view } = mount();
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(1),
        EditorSelection.cursor(3),
        EditorSelection.cursor(14),
      ]),
    });
    expect(shaded(view)).toEqual(['::lamina', '  Nível Médio']);
  });

  it("goes in vim's visual and visual block modes and comes back on Escape", () => {
    const { view } = mount(true);
    view.dispatch({ selection: { anchor: 11 } });
    expect(shaded(view)).toEqual(['  Nível Médio']);
    press(view, 'v', 'e');
    expect(shaded(view)).toEqual([]);
    press(view, '<Esc>');
    expect(shaded(view)).toEqual(['  Nível Médio']);
    press(view, '<C-v>', 'j', 'l');
    expect(view.state.selection.ranges.length).toBeGreaterThan(1);
    expect(shaded(view)).toEqual([]);
    press(view, '<Esc>');
    expect(shaded(view)).toHaveLength(1);
  });
});
