// @vitest-environment jsdom
import {
  type EditorHandle,
  cellOutputs,
  createEditor,
  enterNotebookCommand,
  notebookFrames,
  selectedNotebookFrame,
  setCellOutputs,
} from '@tyto/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BlockHost, recipeFrames } from './recipe-blocks-view.js';
import {
  type CommandModeHost,
  DELETE_WINDOW,
  inCommandMode,
  runBlockAction,
} from './recipe-command-mode.js';
import type { StepSlot } from './recipe-notebook.js';

/**
 * A recipe's command mode (TYTO-676, ADR 0195 decision 7) in a real editor under jsdom: what
 * each action does to the text, to the selected block and to focus. Which key runs which action
 * is the table's (`commands.test.ts`); that vim's keys and typing stay the text's is the real
 * window's (`recipe-command-mode.desktop.test.ts`).
 */

// Blocks between blank lines (ADR 0196): the header; `acme.pull` to `acme.tag` (cells 0 and 1);
// `where` and `select` (2 and 3); a note; and `sort` (4).
const TEXT = [
  'recipe weekly',
  '',
  'acme.pull',
  '# a note',
  'acme.tag',
  '',
  'where status = done',
  'select key',
  '',
  '# only a note',
  '',
  'sort key',
  '',
].join('\n');

/** The second block with the blank line that set it apart: what deleting it takes. */
const SECOND = 'where status = done\nselect key\n\n';

let editor: EditorHandle | undefined;

afterEach(() => {
  editor?.view.destroy();
  editor = undefined;
  document.body.replaceChildren();
});

function open() {
  const blocks: BlockHost = {
    locale: () => 'en',
    documentOf: () => 'tab-1',
    foldable: () => false,
    collapsed: () => false,
    runBlock: () => undefined,
    runFrom: () => undefined,
    runAll: () => undefined,
    execution: () => [],
    addStep: () => undefined,
  };
  let now = 0;
  const host = {
    documentOf: () => 'tab-1',
    runBlock: vi.fn<(documentId: string, first: number, last: number) => void>(),
    addStep: vi.fn<(view: unknown, slot: StepSlot) => void>(),
    undo: vi.fn<(view: unknown) => void>(),
    now: () => now,
  } satisfies CommandModeHost;
  const parent = document.createElement('div');
  document.body.append(parent);
  editor = createEditor(parent, {
    doc: TEXT,
    extensions: [cellOutputs(), notebookFrames({ framesOf: (view) => recipeFrames(view, blocks) })],
  });
  const on = editor;
  const run = (action: Parameters<typeof runBlockAction>[1]) =>
    runBlockAction(on.view, action, host);
  const selected = (): string | undefined => {
    const frame = selectedNotebookFrame(on.view);
    return frame === undefined ? undefined : on.view.state.doc.lineAt(frame.from).text;
  };
  const tick = (milliseconds: number): void => {
    now += milliseconds;
  };
  return { on, host, run, selected, tick };
}

const lineOf = (on: EditorHandle, text: string): number => {
  for (let number = 1; number <= on.view.state.doc.lines; number += 1) {
    if (on.view.state.doc.line(number).text === text) return on.view.state.doc.line(number).from;
  }
  throw new Error(`no line ${text}`);
};

describe("a recipe's command mode (TYTO-676, ADR 0196)", () => {
  it("enters on the cursor's whole block, and steps over blocks but never onto the header", () => {
    const { on, run, selected } = open();
    // The cursor on the block's last line selects the block, read from its first.
    on.view.dispatch({ selection: { anchor: lineOf(on, 'acme.tag') } });
    expect(run('commandMode')).toBe(true);
    expect(inCommandMode(on.view)).toBe(true);
    expect(selected()).toBe('acme.pull');
    expect(run('previous')).toBe(false);
    expect(selected()).toBe('acme.pull');
    run('next');
    expect(selected()).toBe('where status = done');
    run('next');
    expect(selected()).toBe('# only a note');
    run('next');
    expect(selected()).toBe('sort key');
    expect(run('next')).toBe(false);
  });

  it('deletes on D twice within the window, and not on two presses farther apart', () => {
    const { on, run, selected, tick } = open();
    enterNotebookCommand(on.view, lineOf(on, 'select key'));
    run('delete');
    expect(on.getValue()).toBe(TEXT);
    tick(DELETE_WINDOW + 1);
    run('delete');
    expect(on.getValue()).toBe(TEXT);
    tick(DELETE_WINDOW - 1);
    run('delete');
    // The whole block, both its steps, and the blank line that set it apart.
    expect(on.getValue()).toBe(TEXT.replace(SECOND, ''));
    // Command mode stays, on the block that took its place.
    expect(inCommandMode(on.view)).toBe(true);
    expect(selected()).toBe('# only a note');
  });

  it("deletes at once from the command bar, on the cursor's block", () => {
    const { on, run } = open();
    on.view.dispatch({ selection: { anchor: lineOf(on, 'select key') } });
    run('delete');
    expect(on.getValue()).toBe(TEXT.replace(SECOND, ''));
  });

  it("edits with the caret at the end of the block's first line, focus back in the text", () => {
    const { on, run } = open();
    enterNotebookCommand(on.view, lineOf(on, 'select key'));
    run('edit');
    expect(inCommandMode(on.view)).toBe(false);
    expect(on.view.hasFocus).toBe(true);
    const first = 'where status = done';
    expect(on.view.state.selection.main.head).toBe(lineOf(on, first) + first.length);
    expect(selectedNotebookFrame(on.view)).toBeUndefined();
  });

  it('inserts a new block above and below the selected one through the step picker', () => {
    const { on, run, host } = open();
    enterNotebookCommand(on.view, lineOf(on, 'select key'));
    run('insertAbove');
    run('insertBelow');
    enterNotebookCommand(on.view, lineOf(on, 'sort key'));
    run('insertBelow');
    // Each a block of its own, a blank line apart, never a line inside a block (ADR 0196).
    expect(host.addStep.mock.calls.map(([, slot]) => slot)).toEqual([
      { at: lineOf(on, 'where status = done'), prefix: '', suffix: '\n\n', before: 2 },
      { at: lineOf(on, '# only a note'), prefix: '', suffix: '\n\n', before: 4 },
      { at: lineOf(on, 'sort key') + 'sort key'.length, prefix: '\n\n', suffix: '', before: 5 },
    ]);
  });

  it('runs the block and moves down: the selection in command mode, the caret in the text', () => {
    const { on, run, host, selected } = open();
    enterNotebookCommand(on.view, lineOf(on, 'where status = done'));
    run('runAndAdvance');
    expect(selected()).toBe('# only a note');

    on.view.focus();
    on.view.dispatch({ selection: { anchor: lineOf(on, 'acme.tag') } });
    run('runAndAdvance');
    // Every step of the block, its first to its last.
    expect(host.runBlock.mock.calls).toEqual([
      ['tab-1', 2, 3],
      ['tab-1', 0, 1],
    ]);
    // The caret at the end of the next block's first line, not at its last line's end.
    const caret = on.view.state.selection.main.head;
    expect(caret).toBe(lineOf(on, 'where status = done') + 'where status = done'.length);
  });

  it("folds the block's result, its last step's, and does nothing on a note", () => {
    const { on, run } = open();
    const clicked: string[] = [];
    // A result under each step of the second block, each with its fold toggle.
    const result = (line: string) => ({
      at: lineOf(on, line),
      key: line,
      render: () => {
        const element = document.createElement('div');
        const toggle = document.createElement('button');
        toggle.className = 'recipe-cell__toggle';
        toggle.addEventListener('click', () => clicked.push(line));
        element.append(toggle);
        return element;
      },
    });
    on.view.dispatch({
      effects: setCellOutputs.of([result('where status = done'), result('select key')]),
    });
    enterNotebookCommand(on.view, lineOf(on, 'where status = done'));
    expect(run('toggleResult')).toBe(true);
    expect(clicked).toEqual(['select key']);
    enterNotebookCommand(on.view, lineOf(on, '# only a note'));
    expect(run('toggleResult')).toBe(false);
  });

  it('undoes through the editor, staying in command mode', () => {
    const { on, run, host } = open();
    enterNotebookCommand(on.view, lineOf(on, 'acme.pull'));
    run('undo');
    expect(host.undo).toHaveBeenCalledOnce();
    expect(inCommandMode(on.view)).toBe(true);
  });
});
