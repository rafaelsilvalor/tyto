// @vitest-environment jsdom
import { type EditorHandle, createEditor, notebookFrameOf, notebookFrames } from '@tyto/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BlockHost, recipeFrames } from './recipe-blocks-view.js';

/**
 * A recipe's block toolbars (TYTO-676, ADR 0195) in a real editor under jsdom: what each
 * button writes into the text, and what it asks the window. The layout is the real window's
 * (`recipe-blocks.desktop.test.ts`).
 */

const TEXT = [
  'recipe weekly',
  'param team = design',
  '',
  '# Pull, then tag.',
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
  const runBlock = vi.fn<(documentId: string, step: number) => void>();
  const host: BlockHost = {
    locale: () => 'en',
    documentOf: () => 'tab-1',
    foldable: () => false,
    collapsed: () => false,
    runBlock,
    ...more,
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  editor = createEditor(parent, {
    doc: TEXT,
    extensions: [notebookFrames({ framesOf: (view) => recipeFrames(view, host) })],
  });
  return { on: editor, runBlock };
}

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
  it('offers run on a step, moves where a neighbour allows, and none on the header', async () => {
    const { on } = open();
    expect(actionsOf(await toolbarOn(on, 'acme.pull team={team}'))).toEqual([
      ['run', false],
      ['up', false],
      ['down', false],
      ['delete', false],
    ]);
    // A note runs nothing, and nothing but the header is above it.
    expect(actionsOf(await toolbarOn(on, '# Pull, then tag.'))).toEqual([
      ['up', true],
      ['down', false],
      ['delete', false],
    ]);
    expect(actionsOf(await toolbarOn(on, 'where status = done'))).toEqual([
      ['run', false],
      ['up', false],
      ['down', true],
      ['delete', false],
    ]);
    // No toolbar stands for the header, and no line's text holds a toolbar's glyphs.
    await expect(toolbarOn(on, 'recipe weekly')).rejects.toThrow('no toolbar');
    expect(on.view.contentDOM.textContent).not.toMatch(/[▶↑↓✕]/u);
  });

  it('moves a block up as one edit the editor undoes, and keeps the caret on it', async () => {
    const { on } = open();
    press(await toolbarOn(on, 'acme.tag'), 'up');
    expect(on.getValue()).toBe(
      TEXT.replace('acme.pull team={team}\nacme.tag', 'acme.tag\nacme.pull team={team}'),
    );
    const caret = on.view.state.selection.main.head;
    expect(on.view.state.doc.lineAt(caret).text).toBe('acme.tag');

    // One Ctrl+Z takes the whole move back: it was one edit.
    on.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(on.getValue()).toBe(TEXT);
  });

  it('moves a step down past the blank line, leaving the blank where it was', async () => {
    const { on } = open();
    press(await toolbarOn(on, 'acme.tag'), 'down');
    expect(on.getValue().split('\n').slice(4, 8)).toEqual([
      'acme.pull team={team}',
      'where status = done',
      '',
      'acme.tag',
    ]);
  });

  it('deletes a block with its line break', async () => {
    const { on } = open();
    press(await toolbarOn(on, '# Pull, then tag.'), 'delete');
    expect(on.getValue()).toBe(TEXT.replace('# Pull, then tag.\n', ''));
  });

  it("runs the block's own step, by its index in the text as it is now", async () => {
    const { on, runBlock } = open();
    // A step inserted above: the toolbar built for step 2 now sits on step 3.
    on.view.dispatch({ changes: { from: TEXT.indexOf('acme.pull'), insert: 'acme.first\n' } });
    press(await toolbarOn(on, 'where status = done'), 'run');
    expect(runBlock.mock.calls).toEqual([['tab-1', 3]]);
  });

  it('offers to fold a result that folds, saying which way', async () => {
    const at = TEXT.indexOf('acme.tag');
    const { on } = open({ foldable: (_id, line) => line === at, collapsed: () => true });
    const toolbar = await toolbarOn(on, 'acme.tag');
    const fold = toolbar.querySelector<HTMLButtonElement>('[data-action="collapse"]');
    expect(fold?.getAttribute('aria-label')).toBe('Show result');
    expect(
      (await toolbarOn(on, 'acme.pull team={team}')).querySelector('[data-action="collapse"]'),
    ).toBeNull();
  });
});
