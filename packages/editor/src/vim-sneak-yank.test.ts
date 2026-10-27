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
import { characterRepeatTarget, findOf, sneakTarget } from './vim-sneak.js';
import {
  type VimYank,
  YANK_FLASH_MS,
  flashedYank,
  onVimYank,
  resetVimYankFlashForTest,
  setVimYankFlash,
} from './vim-yank.js';

/**
 * Sneak and the yank flash (TYTO-419). One file for both: each mounts editors, and jsdom costs
 * seconds a file. The contributions are the ones the desktop will ship.
 */
const PLUGINS: readonly VimContribution[] = [
  {
    id: 'sneak',
    mappings: [
      { keys: 's', context: 'normal', operation: 'sneak' },
      { keys: 'S', context: 'normal', operation: 'sneak', args: { backward: true } },
      { keys: ';', context: 'normal', operation: 'sneak.repeat' },
      { keys: ',', context: 'normal', operation: 'sneak.repeat', args: { reverse: true } },
    ],
  },
  {
    id: 'surround',
    mappings: [{ keys: 's', context: 'operatorPending', operation: 'surround.target' }],
  },
  {
    id: 'exchange',
    mappings: [{ keys: 'x', context: 'operatorPending', operation: 'exchange.target' }],
  },
  {
    id: 'objects',
    mappings: [
      { keys: 'ii', context: 'operatorPending', operation: 'indentObject', args: { inner: true } },
    ],
  },
];

const handles: EditorHandle[] = [];

const closeAll = (): void => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
};

afterEach(() => {
  resetVimContributionsForTest();
  resetVimYankFlashForTest();
  closeAll();
});

const open = (before: string): EditorView => {
  const parent = document.body.appendChild(document.createElement('div'));
  const handle = createEditor(parent, {
    doc: before.replace('|', ''),
    language: 'brief',
    commands: createCommandRegistry(),
    vim: true,
    vimStatus: false,
  });
  handles.push(handle);
  handle.view.dispatch({ selection: EditorSelection.cursor(Math.max(0, before.indexOf('|'))) });
  return handle.view;
};

const NAMED: Readonly<Record<string, string>> = { '<Esc>': 'Escape', '<Space>': ' ' };

const type = (view: EditorView, sequence: string): void => {
  for (const key of sequence.match(/<[^<>]+>|[\s\S]/gu) ?? []) {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: NAMED[key] ?? key, bubbles: true, cancelable: true }),
    );
  }
};

const marked = (view: EditorView): string => {
  const doc = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
};

const after = (before: string, keys: string): string => {
  const view = open(before);
  type(view, keys);
  return marked(view);
};

const on = (...ids: string[]): void => {
  const result = setVimContributions(PLUGINS, ids);
  expect(result.ok && result.diagnostics).toEqual([]);
};

describe('sneak (TYTO-419)', () => {
  it('finds the Nth pair forward or backward, case-sensitive, with no wrap', () => {
    expect(sneakTarget('ab ab ab', 0, 'ab', false, 2)).toBe(6);
    expect(sneakTarget('ab ab ab', 6, 'ab', true, 1)).toBe(3);
    expect(sneakTarget('AB ab', 0, 'AB', false, 1)).toBeUndefined();
    expect(sneakTarget('ab x', 3, 'ab', false, 1)).toBeUndefined();
  });

  it('reads a find from a whole command’s keys, and not a letter another key took', () => {
    expect(findOf(['3', 't', 'x'])).toEqual({
      kind: 'character',
      character: 'x',
      forward: true,
      till: true,
    });
    expect(findOf(['d', 'F', '<Space>'])).toMatchObject({ character: ' ', forward: false });
    expect(findOf(['r', 'f'])).toBeUndefined();
    expect(findOf(['m', 't'])).toBeUndefined();
    expect(findOf(['"', 't', 'x'])).toBeUndefined();
    const till = { kind: 'character', character: '.', forward: true, till: true } as const;
    expect(characterRepeatTarget('xa.b.c', 1, till, false, 1)).toBe(3);
  });

  it.each([
    ['|ab xx ab ab', 'sab', 'ab xx |ab ab'],
    ['|ab xx ab ab', '2sab', 'ab xx ab |ab'],
    ['|x\nfoo ab', 'sab', 'x\nfoo |ab'],
    ['|AB ab', 'sAB', '|AB ab'],
    ['|AB ab', 'sab', 'AB |ab'],
    ['|abc', 'szz', '|abc'],
    ['ab ab |x', 'Sab', 'ab |ab x'],
    ['ab ab |x', '2Sab', '|ab ab x'],
    ['|ab ab ab', 'sab;', 'ab ab |ab'],
    ['|ab ab ab', 'sab;,', 'ab |ab ab'],
    ['|ab ab ab ab', 'sab2;', 'ab ab ab |ab'],
    ['ab ab ab |x', 'Sab;', 'ab |ab ab x'],
    ['ab ab ab |x', 'Sab;,', 'ab ab |ab x'],
    ['|a.b.c.d', 'f.;', 'a.b|.c.d'],
    ['|a.b.c.d', 'f.;;,', 'a.b|.c.d'],
    ['|a.b.c.d', 'f.2;', 'a.b.c|.d'],
    ['|xa.b.c', 't.;', 'xa.|b.c'],
    ['a.b.c|x', 'T.;', 'a.|b.cx'],
    ['a.b.c|x', 'T.,', 'a.b.|cx'],
    ['|a.b ab. ab.', 'sabf.;', 'a.b ab. ab|.'],
    ['|a.b ab ab', 'f.sab;', 'a.b ab |ab'],
    ['|a.b.c', 'f.d;', 'a|c'],
    ['|ab ab', 's<Esc>x', '|b ab'],
    ['|ab ab', 'sa<Esc>x', '|b ab'],
    ['|xab ab', 'xsab.', 'ab |b'],
    ['|ab', ';', '|ab'],
  ])('%j then %j gives %j', (before, keys, expected) => {
    on('sneak');
    expect(after(before, keys)).toBe(expected);
  });

  it('waits for two keys after s, and Escape stops the wait', () => {
    on('sneak');
    const view = open('|ab');
    type(view, 's');
    expect(isReadingVimKeys(view)).toBe(true);
    type(view, '<Esc>');
    expect(isReadingVimKeys(view)).toBe(false);
  });

  it.each([
    ['|abc', 's<Esc>'],
    ['|abc\ndef', 'S<Esc>'],
  ])('switched off, %j then %j is vim’s own s and S again', (before, keys) => {
    const vims = after(before, keys);
    closeAll();
    on('sneak');
    on();
    expect(after(before, keys)).toBe(vims);
    // jsdom inserts no text for a keydown, so `cl` and `cc` show as the delete they start with.
    expect(vims).toBe(before.includes('\n') ? '|\ndef' : '|bc');
  });
});

/** The yanks seen in a view after the keys and the end of the task, and the ranges flashed. */
const yanked = async (
  before: string,
  keys: string,
): Promise<{ yanks: VimYank[]; flashed: string[]; view: EditorView }> => {
  const view = open(before);
  const yanks: VimYank[] = [];
  onVimYank(view, (yank) => yanks.push(yank));
  type(view, keys);
  await Promise.resolve();
  const doc = view.state.doc;
  const flashed = flashedYank(view).map(({ from, to }) => doc.sliceString(from, to));
  return { yanks, flashed, view };
};

const SAMPLE = 'alpha beta\ngamma\ndelta\n  in1\n  in2\nend';

describe('the yank flash (TYTO-419)', () => {
  it.each([
    ['|', 'yiw', ['alpha']],
    ['|', 'yy', ['alpha beta']],
    ['|', '3yy', ['alpha beta\ngamma\ndelta']],
    ['|', 'y$', ['alpha beta']],
    ['|', '"ayiw', ['alpha']],
    ['|', 'viwy', ['alpha']],
    // `V2G`, not `Vj`: with no layout in jsdom, `j` in visual line mode runs to the last line.
    ['|', 'V2Gy', ['alpha beta\ngamma']],
    ['alpha beta\ngamma\ndelta\n  |in1', 'yii', ['  in1\n  in2']],
  ])('%j then %j flashes %j', async (cursor, keys, expected) => {
    on('objects');
    const at = cursor === '|' ? `|${SAMPLE}` : `${cursor}\n  in2\nend`;
    const { yanks, flashed } = await yanked(at, keys);
    expect(flashed).toEqual(expected);
    expect(yanks).toHaveLength(1);
  });

  it.each([
    ['dd', 0],
    ['yiwp', 1],
    ['ysiw)', 0],
    ['cxiw', 0],
  ])('%j yanks %i times', async (keys, count) => {
    on('surround', 'exchange');
    const { yanks } = await yanked(`|${SAMPLE}`, keys);
    expect(yanks).toHaveLength(count);
  });

  it('reports the text and linewise for a listener, and the mark goes after the delay', async () => {
    const { yanks, view } = await yanked(`|${SAMPLE}`, 'yy');
    expect(yanks[0]).toMatchObject({ text: 'alpha beta\n', linewise: true });
    expect(view.contentDOM.querySelector('.cm-tyto-yank-flash')?.textContent).toBe('alpha beta');
    await new Promise((resolve) => setTimeout(resolve, YANK_FLASH_MS + 50));
    expect(flashedYank(view)).toEqual([]);
  });

  it('switched off, nothing flashes, and the detector still sees the yank', async () => {
    setVimYankFlash(false);
    const { yanks, flashed } = await yanked(`|${SAMPLE}`, 'yiw');
    expect(flashed).toEqual([]);
    expect(yanks).toHaveLength(1);
  });
});
