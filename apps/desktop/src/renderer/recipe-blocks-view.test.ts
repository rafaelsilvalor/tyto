// @vitest-environment jsdom
import {
  type EditorHandle,
  createEditor,
  notebookFrameOf,
  notebookFrames,
  notebookInsertOf,
} from '@tyto/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type BlockHost,
  blockMark,
  insertControl,
  markerOf,
  recipeFrames,
} from './recipe-blocks-view.js';
import type { StepSlot } from './recipe-notebook.js';

/**
 * A recipe's block toolbars (TYTO-676, ADR 0195 and ADR 0196) in a real editor under jsdom: what
 * each button writes into the text, and what it asks the window. The layout is the real window's
 * (`recipe-blocks.desktop.test.ts`).
 *
 * The recipe has a header, a note block, a block of two steps and a block of one: a blank line
 * parts blocks (ADR 0196).
 */

const TEXT = [
  'recipe weekly',
  'param team = design',
  '',
  '# Pull, then tag.',
  '',
  'acme.pull team={team}',
  'acme.tag',
  '',
  'where status = done',
  '',
].join('\n');

let editor: EditorHandle | undefined;

afterEach(() => {
  editor?.view.destroy();
  editor = undefined;
  document.body.replaceChildren();
});

function open(more: Partial<BlockHost> = {}) {
  const runBlock = vi.fn<(documentId: string, first: number, last: number) => void>();
  const runFrom = vi.fn<(documentId: string, first: number) => void>();
  const runAll = vi.fn<(documentId: string) => void>();
  const addStep = vi.fn<(view: unknown, slot: StepSlot) => void>();
  const host: BlockHost = {
    locale: () => 'en',
    documentOf: () => 'tab-1',
    foldable: () => false,
    collapsed: () => false,
    runBlock,
    runFrom,
    runAll,
    execution: () => [],
    addStep,
    ...more,
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  editor = createEditor(parent, {
    doc: TEXT,
    extensions: [
      notebookFrames({
        framesOf: (view) => recipeFrames(view, host),
        insert: (view) => insertControl(view, host, 'en'),
      }),
    ],
  });
  return { on: editor, runBlock, runFrom, runAll, addStep };
}

/** The "+" drawn on the boundary just above the line whose text is `text`, or below the last. */
async function plusAt(on: EditorHandle, text: string): Promise<HTMLElement> {
  await new Promise((done) => setTimeout(done, 50));
  const control = [...on.view.dom.querySelectorAll<HTMLElement>('.recipe-block-insert')].find(
    (each) => {
      const place = notebookInsertOf(on.view, each);
      if (place === 'end' || place === undefined) return place === text;
      return on.view.state.doc.lineAt(place.from).text === text;
    },
  );
  if (control === undefined) throw new Error(`no + above ${text}`);
  return control;
}

const choose = (control: HTMLElement, what: 'step' | 'note'): void => {
  control.querySelector<HTMLButtonElement>('[data-action="insert"]')?.click();
  control.querySelector<HTMLButtonElement>(`[data-action="${what}"]`)?.click();
};

/**
 * The toolbar standing for the block whose first line is `text`, once the editor has drawn
 * its toolbars (on its next measure): they sit beside the text, not in its lines.
 */
async function toolbarOn(on: EditorHandle, text: string): Promise<HTMLElement> {
  await new Promise((done) => setTimeout(done, 50));
  const toolbar = [...on.view.dom.querySelectorAll<HTMLElement>('.recipe-block-toolbar')].find(
    (each) => {
      const frame = notebookFrameOf(on.view, each);
      return frame !== undefined && on.view.state.doc.lineAt(frame.from).text === text;
    },
  );
  if (toolbar === undefined) throw new Error(`no toolbar on ${text}`);
  return toolbar;
}

const press = (toolbar: HTMLElement, action: string): void => {
  toolbar.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
};

const actionsOf = (toolbar: HTMLElement) =>
  [...toolbar.querySelectorAll<HTMLButtonElement>('button')].map((button) => [
    button.dataset['action'],
    button.disabled,
  ]);

describe("a recipe block's toolbar (TYTO-676)", () => {
  it('offers one toolbar per block, on its first line, with no toolbar on its other lines', async () => {
    const { on } = open();
    expect(actionsOf(await toolbarOn(on, 'acme.pull team={team}'))).toEqual([
      ['run', false],
      ['runFrom', false],
      ['up', false],
      ['down', false],
      ['delete', false],
    ]);
    // The block's second step is a line of the block, not a block of its own.
    await expect(toolbarOn(on, 'acme.tag')).rejects.toThrow('no toolbar');
    // A note runs nothing, and nothing but the header is above it.
    expect(actionsOf(await toolbarOn(on, '# Pull, then tag.'))).toEqual([
      ['up', true],
      ['down', false],
      ['delete', false],
    ]);
    expect(actionsOf(await toolbarOn(on, 'where status = done'))).toEqual([
      ['run', false],
      ['runFrom', false],
      ['up', false],
      ['down', true],
      ['delete', false],
    ]);
    // The header's toolbar runs the whole recipe, and no line's text holds a toolbar's glyphs.
    expect(actionsOf(await toolbarOn(on, 'recipe weekly'))).toEqual([['runAll', false]]);
    expect(on.view.contentDOM.textContent).not.toMatch(/[▶↑↓✕]/u);
  });

  it('moves a whole block up as one edit the editor undoes, the blank line kept', async () => {
    const { on } = open();
    press(await toolbarOn(on, 'acme.pull team={team}'), 'up');
    expect(on.getValue()).toBe(
      TEXT.replace(
        '# Pull, then tag.\n\nacme.pull team={team}\nacme.tag',
        'acme.pull team={team}\nacme.tag\n\n# Pull, then tag.',
      ),
    );
    const caret = on.view.state.selection.main.head;
    expect(on.view.state.doc.lineAt(caret).text).toBe('acme.pull team={team}');

    // One Ctrl+Z takes the whole move back: it was one edit.
    on.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(on.getValue()).toBe(TEXT);
  });

  it('moves a whole block down past the next one', async () => {
    const { on } = open();
    press(await toolbarOn(on, 'acme.pull team={team}'), 'down');
    expect(on.getValue().split('\n').slice(5, 9)).toEqual([
      'where status = done',
      '',
      'acme.pull team={team}',
      'acme.tag',
    ]);
  });

  it('deletes a whole block with the blank line that parted it', async () => {
    const { on } = open();
    press(await toolbarOn(on, 'acme.pull team={team}'), 'delete');
    expect(on.getValue()).toBe(TEXT.replace('acme.pull team={team}\nacme.tag\n\n', ''));
  });

  it('runs the whole block, its first step to its last, by their indices as the text is now', async () => {
    const { on, runBlock } = open();
    press(await toolbarOn(on, 'acme.pull team={team}'), 'run');
    // A block inserted above shifts the indices: the toolbar asks for them as they are now.
    on.view.dispatch({ changes: { from: TEXT.indexOf('acme.pull'), insert: 'acme.first\n\n' } });
    press(await toolbarOn(on, 'acme.pull team={team}'), 'run');
    press(await toolbarOn(on, 'where status = done'), 'run');
    expect(runBlock.mock.calls).toEqual([
      ['tab-1', 0, 1],
      ['tab-1', 1, 2],
      ['tab-1', 3, 3],
    ]);
  });

  it("offers to fold the block's result, its last step's, saying which way", async () => {
    const at = TEXT.indexOf('acme.tag');
    const { on } = open({ foldable: (_id, line) => line === at, collapsed: () => true });
    const toolbar = await toolbarOn(on, 'acme.pull team={team}');
    const fold = toolbar.querySelector<HTMLButtonElement>('[data-action="collapse"]');
    expect(fold?.getAttribute('aria-label')).toBe('Show result');
    expect(
      (await toolbarOn(on, 'where status = done')).querySelector('[data-action="collapse"]'),
    ).toBeNull();
  });
});

// TYTO-676: the "+" between blocks, run from here down, run all, and the counter.
describe('inserting, running from here and the counter (TYTO-676)', () => {
  it("runs from a block's first step down, and the whole recipe from the header", async () => {
    const { on, runFrom, runAll } = open();
    press(await toolbarOn(on, 'acme.pull team={team}'), 'runFrom');
    press(await toolbarOn(on, 'recipe weekly'), 'runAll');
    expect(runFrom.mock.calls).toEqual([['tab-1', 0]]);
    expect(runAll.mock.calls).toEqual([['tab-1']]);
  });

  it('writes a note as a block of its own above the block a "+" stands over', async () => {
    const { on } = open();
    choose(await plusAt(on, 'where status = done'), 'note');
    expect(on.getValue()).toBe(TEXT.replace('where status', '# \n\nwhere status'));
    const caret = on.view.state.selection.main.head;
    expect(on.view.state.doc.lineAt(caret).text).toBe('# ');
    expect(caret).toBe(on.view.state.doc.lineAt(caret).to);
  });

  it('opens the step picker for a new block at the boundary, and below the last', async () => {
    const { on, addStep } = open();
    choose(await plusAt(on, 'acme.pull team={team}'), 'step');
    choose(await plusAt(on, 'end'), 'step');
    expect(addStep.mock.calls.map(([, slot]) => slot)).toEqual([
      { at: TEXT.indexOf('acme.pull'), prefix: '', suffix: '\n\n', before: 0 },
      {
        at: TEXT.indexOf('where status = done') + 'where status = done'.length,
        prefix: '\n\n',
        suffix: '',
        before: 3,
      },
    ]);
  });

  it('draws a "+" above every block but the header, and one below the last', async () => {
    const { on } = open();
    await plusAt(on, 'end');
    const places = [...on.view.dom.querySelectorAll<HTMLElement>('.recipe-block-insert')].map(
      (each) => {
        const place = notebookInsertOf(on.view, each);
        return place === 'end' || place === undefined
          ? place
          : on.view.state.doc.lineAt(place.from).text;
      },
    );
    expect(places).toEqual([
      '# Pull, then tag.',
      'acme.pull team={team}',
      'where status = done',
      'end',
    ]);
  });

  it("shows each block's counter in the gutter, from its steps', and why on hover when stale", () => {
    const { on } = open({
      execution: () => [
        { state: 'ran', count: 4 },
        { state: 'ran', count: 5 },
        { state: 'running' },
      ],
    });
    const marks = [...on.view.dom.querySelectorAll<HTMLElement>('.recipe-block-count')].map(
      (each) => [each.textContent, each.classList.contains('recipe-block-count--stale')],
    );
    expect(marks).toEqual([
      ['[5]', false],
      ['[*]', false],
    ]);
    expect(markerOf({ state: 'never' }, 'en')).toMatchObject({ text: '[ ]', title: 'Not run yet' });
    expect(markerOf({ state: 'stale', count: 2 }, 'pt-BR').title).toBe(
      'Desatualizado: ele ou um passo acima mudou desde que rodou',
    );
  });
});

// ADR 0196: a block's counter is read from its steps'.
describe("a block's counter", () => {
  const steps = { first: 0, last: 2 };
  it("is the last step's number, stale when any step is, and running when any step runs", () => {
    const ran = { state: 'ran', count: 7 } as const;
    expect(blockMark([ran, ran, { state: 'ran', count: 9 }], steps)).toEqual({
      state: 'ran',
      count: 9,
    });
    expect(blockMark([{ state: 'stale', count: 1 }, ran, ran], steps)).toEqual({
      state: 'stale',
      count: 7,
    });
    // A step typed into the block since the last run has no number: the block is out of date.
    expect(blockMark([ran, { state: 'never' }, ran], steps)).toEqual({ state: 'stale', count: 7 });
    expect(blockMark([ran, { state: 'running' }, ran], steps)).toEqual({ state: 'running' });
    expect(blockMark([ran, ran, { state: 'never' }], steps)).toEqual({ state: 'never' });
  });
});
