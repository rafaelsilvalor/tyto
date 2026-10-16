// @vitest-environment jsdom
import { completionStatus, currentCompletions } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type JsonAssistSource, hoverDom, jsonAssist } from './json-assist.js';
import { json } from './json-language.js';

/**
 * The editor's half of the JSON tabs' help (TYTO-304): a host's plain answers turned into
 * CodeMirror's list, and a pick replacing the string being typed, quotes and all.
 */

/** Suggests two keys inside any string, and `true` after a `t`; explains nothing. */
const source: JsonAssistSource = {
  complete: (text, position) => {
    const before = text.slice(0, position);
    if (/"\w*$/u.test(before)) {
      return {
        from: before.lastIndexOf('"') + 1,
        quoted: true,
        options: [
          { label: 'alpha', insert: '"alpha": 1', select: [9, 10], kind: 'property' },
          { label: 'beta', info: 'The second.', insert: '"beta": true' },
        ],
      };
    }
    if (before.endsWith('t')) {
      return { from: position - 1, quoted: false, options: [{ label: 'true', insert: 'true' }] };
    }
    return null;
  },
  hover: () => null,
};

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function mount(doc: string, at: number, assist: JsonAssistSource = source): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: at },
      extensions: [json(), jsonAssist(assist)],
    }),
  });
  return view;
}

function type(target: EditorView, text: string): void {
  for (const character of text) {
    const at = target.state.selection.main.head;
    target.dispatch({
      changes: { from: at, insert: character },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    });
  }
}

const labels = (target: EditorView): string[] =>
  currentCompletions(target.state).map((option) => option.label);

async function pickFirst(target: EditorView): Promise<void> {
  await vi.waitFor(() => {
    expect(completionStatus(target.state)).toBe('active');
  });
  // Past CodeMirror's 75 ms in which Enter would not accept.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const enter = new KeyboardEvent('keydown', { key: 'Enter' });
  expect(runScopeHandlers(target, enter, 'editor')).toBe(true);
}

const selected = (target: EditorView): string =>
  target.state.sliceDoc(target.state.selection.main.from, target.state.selection.main.to);

describe('the JSON tabs’ completion', () => {
  it('opens on a quote, filters by the word, and leaves the default selected', async () => {
    const target = mount('{\n  \n}', 4);
    type(target, '"al');
    await vi.waitFor(() => {
      expect(labels(target)).toEqual(['alpha']);
    });
    await pickFirst(target);
    expect(target.state.doc.toString()).toBe('{\n  "alpha": 1\n}');
    expect(selected(target)).toBe('1');
  });

  it('takes a closing quote that was already there', async () => {
    const target = mount('{ "" }', 3);
    type(target, 'b');
    await pickFirst(target);
    expect(target.state.doc.toString()).toBe('{ "beta": true }');
  });

  it('replaces a bare word without touching what is around it', async () => {
    const target = mount('{ "on":  }', 8);
    type(target, 't');
    await pickFirst(target);
    expect(target.state.doc.toString()).toBe('{ "on": true }');
  });

  it('opens nothing when the source answers nothing', async () => {
    const target = mount('{}', 1, { complete: () => null, hover: () => null });
    type(target, '"');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completionStatus(target.state)).toBeNull();
  });
});

describe('the JSON tabs’ hover', () => {
  it('writes the answer as text, labels and all', () => {
    const dom = hoverDom({
      from: 0,
      to: 1,
      title: 'vimModeStyle',
      text: '<b>not markup</b>',
      facts: [{ label: 'Default', value: '"badge"' }],
    });
    expect(dom.querySelector('.cm-json-hover-title')?.textContent).toBe('vimModeStyle');
    expect(dom.querySelector('b')).toBeNull();
    expect(dom.querySelector('.cm-json-hover-text')?.textContent).toBe('<b>not markup</b>');
    expect(dom.querySelector('.cm-json-hover-fact')?.textContent).toBe('Default: "badge"');
  });
});
