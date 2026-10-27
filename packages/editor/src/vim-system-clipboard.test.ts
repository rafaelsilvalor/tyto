// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCommandRegistry } from './commands.js';
import { type EditorHandle, createEditor } from './editor.js';
import { resetVimContributionsForTest, setVimContributions } from './vim-contributions.js';
import {
  type SystemClipboard,
  resetVimSystemClipboardForTest,
  setVimSystemClipboard,
} from './vim-system-clipboard.js';

/**
 * Vim's yank and the system clipboard (TYTO-442). The clipboard is a stub port that records
 * writes and serves reads; the real one is never touched. The engine's own `"+y` writes
 * `navigator.clipboard`, which jsdom lacks, so that is a recording stub too.
 */

interface StubClipboard extends SystemClipboard {
  readonly writes: string[];
  reads: number;
  /** What the next reads return: text, or a promise the test settles. */
  serve: string | Promise<string>;
}

const stubClipboard = (serve: string | Promise<string> = ''): StubClipboard => {
  const clipboard: StubClipboard = {
    writes: [],
    reads: 0,
    serve,
    readText: () => {
      clipboard.reads += 1;
      return Promise.resolve(clipboard.serve);
    },
    writeText: (text) => {
      clipboard.writes.push(text);
      return Promise.resolve();
    },
  };
  return clipboard;
};

const engineWrites: string[] = [];
const handles: EditorHandle[] = [];

beforeEach(() => {
  engineWrites.length = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text: string) => engineWrites.push(text) },
  });
  const result = setVimContributions(
    [{ id: 'replaceWithRegister', mappings: [{ keys: 'gr', operation: 'replaceWithRegister' }] }],
    ['replaceWithRegister'],
  );
  expect(result.ok).toBe(true);
});

afterEach(() => {
  resetVimSystemClipboardForTest();
  resetVimContributionsForTest();
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
  Reflect.deleteProperty(navigator, 'clipboard');
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

const NAMED: Readonly<Record<string, string>> = { '<Esc>': 'Escape' };

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

/** Lets the yank detector's end-of-task check and the port's promises run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const focus = async (view: EditorView): Promise<void> => {
  view.contentDOM.dispatchEvent(new FocusEvent('focus'));
  await settle();
};

const unnamed = (): { text: string; linewise: boolean } => {
  const register = Vim.getRegisterController().getRegister('"');
  return { text: register.toString(), linewise: register.linewise };
};

/** The writes a sequence of keys makes, each in its own editor. */
const writesOf = async (keys: string): Promise<string[]> => {
  const clipboard = stubClipboard();
  setVimSystemClipboard(clipboard);
  const view = open('|alpha beta\ngamma');
  type(view, keys);
  await settle();
  return clipboard.writes;
};

describe('a yank writes the system clipboard (TYTO-442)', () => {
  it.each([
    ['yiw', ['alpha']],
    ['yy', ['alpha beta\n']],
    ['"*yiw', ['alpha']],
    ['"+yiw', []],
    ['"ayiw', []],
    ['dd', []],
    ['x', []],
    ['ciw', []],
    ['p', []],
  ])('%j writes %j', async (keys, expected) => {
    expect(await writesOf(keys)).toEqual(expected);
  });

  it('leaves "+y to the engine, which writes the clipboard itself', async () => {
    await writesOf('"+yiw');
    expect(engineWrites).toEqual(['alpha']);
  });

  it('switched off, neither reads nor writes', async () => {
    const clipboard = stubClipboard('EXT');
    const view = open('|alpha beta');
    type(view, 'yiw');
    await focus(view);
    expect([clipboard.reads, clipboard.writes]).toEqual([0, []]);
  });

  it('drops a port that rejects or throws', async () => {
    setVimSystemClipboard({
      readText: () => Promise.reject(new DOMException('no focus', 'NotAllowedError')),
      writeText: () => {
        throw new Error('denied');
      },
    });
    const view = open('|alpha beta');
    type(view, 'yiw');
    await settle();
    await focus(view);
    expect(unnamed().text).toBe('alpha');
  });
});

/** The text after `keys` with `text` in the unnamed register, as vim itself would hold it. */
const withRegister = (before: string, text: string, keys: string): string => {
  Vim.getRegisterController().getRegister('"').setText(text, text.endsWith('\n'));
  const view = open(before);
  type(view, keys);
  return marked(view);
};

describe('an outside copy reaches the unnamed register on focus (TYTO-442)', () => {
  it.each([
    ['|ab cd', 'EXT', 'p', 'aEX|Tb cd'],
    ['|ab cd', 'EXT', 'P', 'EXT|ab cd'],
    ['|ab cd', 'EXT', '3p', 'aEXTEXTEX|Tb cd'],
    ['|ab cd', 'EXT', 'pw.', 'aEXTb cEX|Td'],
    ['|ab cd', 'EXT', 'wviwp', 'ab EX|T'],
    ['|ab cd', 'EXT', 'wgriw', 'ab |EXT'],
    ['one\n|two', 'L\r\n', 'p', 'one\ntwo\n|L'],
    ['one\n|two', 'L\r\n', 'P', 'one\n|L\ntwo'],
    ['one\n|two\nend', 'L\r\n', 'grr', 'one\n|L\nend'],
  ])('%j with %j copied, then %j, gives %j', async (before, copied, keys, expected) => {
    Vim.getRegisterController().getRegister('"').setText('stale');
    setVimSystemClipboard(stubClipboard(copied));
    const view = open(before);
    await focus(view);
    type(view, keys);
    expect(marked(view)).toBe(expected);
    resetVimSystemClipboardForTest();
    expect(withRegister(before, copied.replace(/\r\n/gu, '\n'), keys)).toBe(expected);
  });

  it('"+gr reads the copy too', async () => {
    setVimSystemClipboard(stubClipboard('EXT'));
    const view = open('|ab cd');
    await focus(view);
    type(view, 'w"+griw');
    expect(marked(view)).toBe('ab |EXT');
  });

  it('does not take back what Tyto itself yanked, though Windows returns \\r\\n', async () => {
    const clipboard = stubClipboard();
    setVimSystemClipboard(clipboard);
    const view = open('|x\nsecond\nend');
    type(view, 'yy2Gdd');
    await settle();
    clipboard.serve = 'x\r\n';
    await focus(view);
    expect(unnamed()).toEqual({ text: 'second\n', linewise: true });
  });

  it('takes an outside copy once, so a later delete is not overwritten by it', async () => {
    setVimSystemClipboard(stubClipboard('EXT'));
    const view = open('|one\ntwo');
    await focus(view);
    type(view, 'dd');
    await focus(view);
    expect(unnamed()).toEqual({ text: 'one\n', linewise: true });
  });

  it('keeps a yank made while the read was pending', async () => {
    let resolve: (text: string) => void = () => undefined;
    const clipboard = stubClipboard(new Promise<string>((done) => (resolve = done)));
    setVimSystemClipboard(clipboard);
    const view = open('|alpha beta');
    view.contentDOM.dispatchEvent(new FocusEvent('focus'));
    type(view, 'yiw');
    await Promise.resolve();
    resolve('EXT');
    await settle();
    expect(unnamed().text).toBe('alpha');
  });

  it('leaves the register alone when the clipboard is empty', async () => {
    setVimSystemClipboard(stubClipboard(''));
    const view = open('|alpha beta');
    type(view, 'yiw');
    await settle();
    await focus(view);
    expect(unnamed().text).toBe('alpha');
  });
});
