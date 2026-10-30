// @vitest-environment jsdom
import {
  CompletionContext,
  completionStatus,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { briefLanguage } from './brief-language.js';
import {
  type SlashItem,
  type SlashSource,
  completeSlash,
  slashCompletion,
  slashRequested,
} from './slash.js';

/**
 * The "/" menu (TYTO-276), in a real `EditorView`: typed input goes through a transaction marked
 * `input.type`, which is what wakes completion, and Enter and Escape go through the view's own
 * key handlers, which is where the completion keymap sits.
 */

/** Every call an item's `apply` received, and the item replacing that span with its label. */
const applied: { label: string; from: number; to: number }[] = [];

const itemFor = (label: string): SlashItem => ({
  label,
  detail: `detail of ${label}`,
  apply: (view, from, to) => {
    applied.push({ label, from, to });
    view.dispatch({ changes: { from, to, insert: `[${label}]` } });
  },
});

const TEMPLATES: SlashSource = {
  section: 'Templates',
  items: () => ['agenda-diaria', 'tabela-nova', 'banner-novo'].map(itemFor),
};

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  applied.length = 0;
});

function mount(doc: string, cursor = doc.length): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [briefLanguage, slashCompletion([TEMPLATES])],
    }),
  });
  return view;
}

/** Types `text` at the cursor the way a keystroke does. */
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

/** A key through the editor's own handlers, which is where the completion keymap is. */
function press(target: EditorView, key: string): boolean {
  return runScopeHandlers(target, new KeyboardEvent('keydown', { key }), 'editor');
}

const labels = (target: EditorView): string[] =>
  currentCompletions(target.state).map((option) => option.label);

async function waitForList(target: EditorView): Promise<void> {
  await vi.waitFor(() => {
    expect(completionStatus(target.state)).toBe('active');
  });
}

/** Whether the source answers at the end of `doc` — the negative cases, without timing. */
const answers = (doc: string, explicit = false): boolean => {
  const state = EditorState.create({ doc, extensions: [briefLanguage, slashCompletion([])] });
  return completeSlash([TEMPLATES])(new CompletionContext(state, doc.length, explicit)) !== null;
};

describe('the "/" menu', () => {
  it('opens on a "/" at column 0, with every template under its section', async () => {
    const target = mount('::titulo Olá\n\n');
    type(target, '/');
    await waitForList(target);

    expect(labels(target)).toEqual(['agenda-diaria', 'banner-novo', 'tabela-nova']);
    const option = currentCompletions(target.state)[0];
    expect(option?.section).toEqual({ name: 'Templates', rank: 0 });
    expect(option?.detail).toBe('detail of agenda-diaria');
  });

  it('carries the info of an item to the panel beside it, none for one without (TYTO-467)', () => {
    const source: SlashSource = {
      section: 'Templates',
      items: () => [
        { ...itemFor('aviso-laranja'), info: 'from plugins/cores.yaml' },
        itemFor('aviso'),
      ],
    };
    const result = completeSlash([source])(
      new CompletionContext(
        EditorState.create({ doc: '/', extensions: [briefLanguage] }),
        1,
        false,
      ),
    );

    expect(result?.options.map((option) => [option.label, option.info])).toEqual([
      ['aviso-laranja', 'from plugins/cores.yaml'],
      ['aviso', undefined],
    ]);
  });

  it('opens in a brief whose frontmatter is not closed yet, which is body to the grammar', () => {
    expect(answers('---\ntemplate: agenda-diaria\n/')).toBe(true);
  });

  it('stays shut for a "/" in the middle of a line', () => {
    expect(answers('::titulo a/')).toBe(false);
    expect(answers('texto /')).toBe(false);
  });

  it('stays shut after indentation, where body text may start with "/"', () => {
    expect(answers('::lamina\n  /')).toBe(false);
    expect(answers('\t/')).toBe(false);
  });

  it('stays shut inside the frontmatter', () => {
    // A closed frontmatter with the "/" on its own line in it: column 0, nothing after the
    // cursor on that line, so only the `Frontmatter` node keeps the list shut.
    const doc = '---\ntemplate: x\n/\n---\n\n::titulo a\n';
    const state = EditorState.create({ doc, extensions: [briefLanguage, slashCompletion([])] });
    const at = doc.indexOf('/') + 1;
    expect(completeSlash([TEMPLATES])(new CompletionContext(state, at, false))).toBeNull();
  });

  it('stays shut when the "/" is typed in front of text already on the line', () => {
    const doc = '/texto';
    const state = EditorState.create({ doc, extensions: [briefLanguage, slashCompletion([])] });
    expect(completeSlash([TEMPLATES])(new CompletionContext(state, 1, false))).toBeNull();
  });

  it('filters as the query is typed, and Enter replaces the "/" and the query', async () => {
    const target = mount('::titulo Olá\n\n');
    type(target, '/agen');
    await waitForList(target);
    expect(labels(target)).toEqual(['agenda-diaria']);

    // CodeMirror refuses to accept within its interaction delay of the list opening (75 ms).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(press(target, 'Enter')).toBe(true);

    expect(applied).toEqual([{ label: 'agenda-diaria', from: 14, to: 19 }]);
    expect(target.state.doc.toString()).toBe('::titulo Olá\n\n[agenda-diaria]');
  });

  it('closes on Escape and leaves the "/" as it was typed', async () => {
    const target = mount('');
    type(target, '/');
    await waitForList(target);

    expect(press(target, 'Escape')).toBe(true);
    expect(completionStatus(target.state)).toBeNull();
    expect(target.state.doc.toString()).toBe('/');
    expect(applied).toEqual([]);
  });

  it('turns `//` into a comment: the second "/" closes the list and stays text', async () => {
    const target = mount('');
    type(target, '/');
    await waitForList(target);
    type(target, '/ nota');

    await vi.waitFor(() => {
      expect(completionStatus(target.state)).toBeNull();
    });
    expect(target.state.doc.toString()).toBe('// nota');
  });

  it('opens without a "/" when asked, and the choice goes in at the cursor', async () => {
    const target = mount('::titulo Olá\n', 8);
    target.dispatch({ effects: slashRequested.of(null) });
    startCompletion(target);
    await waitForList(target);
    expect(labels(target)).toHaveLength(3);

    type(target, 'tab');
    await vi.waitFor(() => {
      expect(labels(target)).toEqual(['tabela-nova']);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    press(target, 'Enter');

    // Only the query goes: there was no "/" to take with it.
    expect(applied).toEqual([{ label: 'tabela-nova', from: 8, to: 11 }]);
    expect(target.state.doc.toString()).toBe('::titulo[tabela-nova] Olá\n');
  });

  it('forgets the request once the text or the cursor moves', () => {
    const doc = '::titulo Olá\n';
    let state = EditorState.create({ doc, extensions: [briefLanguage, slashCompletion([])] });
    state = state.update({ effects: slashRequested.of(null) }).state;
    const source = completeSlash([TEMPLATES]);
    expect(source(new CompletionContext(state, 3, true))).not.toBeNull();
    // Asked for, but not explicitly — a keystroke's query, not the command's.
    expect(source(new CompletionContext(state, 3, false))).toBeNull();

    state = state.update({ selection: { anchor: 1 } }).state;
    expect(source(new CompletionContext(state, 1, true))).toBeNull();
  });
});
