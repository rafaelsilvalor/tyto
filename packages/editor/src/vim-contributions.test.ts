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

  it('repeats an action with . only when the operation declares itself an edit', () => {
    const appendX = (isEdit: boolean) =>
      defineVimOperation('test.append-x', {
        kind: 'action',
        isEdit,
        run: (view) => {
          const at = view.state.selection.main.head;
          view.dispatch({ changes: { from: at, insert: 'x' } });
        },
      });
    const press = (): string => {
      setVimContributions(
        [
          {
            id: 'test-append',
            mappings: [{ keys: 'zx', context: 'normal', operation: 'test.append-x' }],
          },
        ],
        ['test-append'],
      );
      const editor = open('abc');
      editor.view.dispatch({ selection: EditorSelection.cursor(0) });
      keys(editor.view, 'z', 'x', '.');
      return editor.view.state.doc.toString();
    };

    appendX(true);
    expect(press()).toBe('xxabc');

    resetVimContributionsForTest();
    appendX(false);
    // Not an edit: `.` has nothing recorded to repeat, so one `x` only.
    expect(press()).toBe('xabc');
  });

  it("hands the operation the key a mapping's <character> stood for", () => {
    defineVimOperation('test.insert-key', {
      kind: 'action',
      run: (view, args) => {
        const at = view.state.selection.main.head;
        view.dispatch({ changes: { from: at, insert: String(args['selectedCharacter']) } });
      },
    });
    setVimContributions(
      [
        {
          id: 'test-key',
          mappings: [{ keys: 'zr<character>', context: 'normal', operation: 'test.insert-key' }],
        },
      ],
      ['test-key'],
    );
    const editor = open('abc');
    editor.view.dispatch({ selection: EditorSelection.cursor(0) });

    keys(editor.view, 'z', 'r', '"');

    expect(editor.view.state.doc.toString()).toBe('"abc');
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

/**
 * A test contribution of the built-in objects, as TYTO-419's plugin will map them: each key in
 * both contexts a text object is allowed in, `inner` on the `i` spelling.
 */
const objectMappings = (operation: string, letter: string): VimContribution['mappings'] =>
  (['visual', 'operatorPending'] as const).flatMap((context) => [
    { keys: `i${letter}`, context, operation, args: { inner: true } },
    { keys: `a${letter}`, context, operation },
  ]);

const OBJECTS: VimContribution = {
  id: 'test-objects',
  mappings: [...objectMappings('indentObject', 'i'), ...objectMappings('entireBuffer', 'e')],
};

/** The exploration's sample (TYTO-420); the cursor starts on `text d`, line 4. */
const BLOCKS = [
  'scene a',
  '  frame b',
  '    text c',
  '    text d',
  '',
  '    text e',
  '  frame f',
  '    text g',
  'scene h',
].join('\n');

interface EngineMode {
  readonly visualMode: boolean;
  readonly visualLine: boolean;
  readonly insertMode: boolean;
}

const modeOf = (view: EditorView): EngineMode =>
  (getCM(view) as unknown as { state: { vim: EngineMode } }).state.vim;

/** The cursor on `line`, four columns in; `j` cannot do it, because jsdom has no layout. */
const toLine = (view: EditorView, line: number): void => {
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(line).from + 4) });
};

/** Insert mode's keys do not type through `handleKey`; a dispatch types instead. */
const type = (view: EditorView, text: string): void => {
  const at = view.state.selection.main.head;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
};

const onBlocks = (): EditorView => {
  const { view } = open(BLOCKS);
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(4).from + 6) });
  return view;
};

const selected = (view: EditorView): string => {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
};

describe('vim text objects (TYTO-422, ADR 0142)', () => {
  beforeEach(() => {
    const result = setVimContributions([OBJECTS], ['test-objects']);
    expect(result.ok && result.diagnostics).toEqual([]);
  });

  it('selects the indent block linewise with vii', () => {
    const view = onBlocks();

    keys(view, 'v', 'i', 'i');

    expect(modeOf(view)).toMatchObject({ visualMode: true, visualLine: true });
    expect(selected(view)).toBe('    text c\n    text d\n\n    text e');
  });

  it('deletes the indent block with dii, whole lines', () => {
    const view = onBlocks();

    keys(view, 'd', 'i', 'i');

    expect(view.state.doc.toString()).toBe('scene a\n  frame b\n  frame f\n    text g\nscene h');
  });

  it('changes the indent block with cii, leaving one line to type on', () => {
    const view = onBlocks();

    keys(view, 'c', 'i', 'i');
    expect(modeOf(view).insertMode).toBe(true);
    type(view, 'X');
    keys(view, '<Esc>');

    expect(view.state.doc.toString()).toBe(
      'scene a\n  frame b\n    X\n  frame f\n    text g\nscene h',
    );
  });

  it('takes the line that opens the block with dai', () => {
    const view = onBlocks();

    keys(view, 'd', 'a', 'i');

    expect(view.state.doc.toString()).toBe('scene a\n  frame f\n    text g\nscene h');
  });

  it('climbs one level per count, before the operator or after it', () => {
    const after = onBlocks();
    keys(after, 'd', '2', 'i', 'i');
    const before = onBlocks();
    keys(before, '2', 'd', 'i', 'i');

    expect(after.state.doc.toString()).toBe('scene a\nscene h');
    expect(before.state.doc.toString()).toBe('scene a\nscene h');
  });

  it('repeats dii with . from where the cursor is', () => {
    const view = onBlocks();

    keys(view, 'd', 'i', 'i');
    toLine(view, 4);
    keys(view, '.');

    expect(view.state.doc.toString()).toBe('scene a\n  frame b\n  frame f\nscene h');
  });

  it('repeats cii with . from where the cursor is', () => {
    const view = onBlocks();

    keys(view, 'c', 'i', 'i');
    type(view, 'X');
    keys(view, '<Esc>');
    toLine(view, 5);
    keys(view, '.');

    expect(view.state.doc.toString()).toBe('scene a\n  frame b\n    X\n  frame f\n    X\nscene h');
  });

  it('selects the whole buffer with vae and its text with vie', () => {
    const { view } = open('\nscene a\n  frame b\n\n');
    toLine(view, 2);

    keys(view, 'v', 'i', 'e');
    expect(selected(view)).toBe('scene a\n  frame b');
    keys(view, '<Esc>', 'd', 'a', 'e');
    expect(view.state.doc.toString()).toBe('');
  });

  it("gives vim's own keys back when it is switched off", () => {
    setVimContributions([OBJECTS], []);
    const view = onBlocks();

    // Vim has no `i` object of its own: `dii` does nothing.
    keys(view, 'd', 'i', 'i');

    expect(view.state.doc.toString()).toBe(BLOCKS);
  });
});

describe('vim text-object refusals (TYTO-422, ADR 0142)', () => {
  const problemOf = (mappings: VimContribution['mappings']): readonly string[] => {
    const result = setVimContributions([{ id: 'test-refused', mappings }], ['test-refused']);
    expect(result.ok && result.value).toEqual([]);
    return result.ok ? result.diagnostics.map((item) => item.message) : [];
  };

  it('refuses a text object outside visual and operator-pending', () => {
    expect(problemOf([{ keys: 'ii', context: 'normal', operation: 'indentObject' }])).toEqual([
      "Vim contribution 'test-refused' was not applied: 'indentObject' is a text object, which is mapped in 'visual' and 'operatorPending', not in 'normal'.",
    ]);
    expect(problemOf([{ keys: 'ii', operation: 'indentObject' }])).toEqual([
      "Vim contribution 'test-refused' was not applied: 'indentObject' is a text object, which is mapped in 'visual' and 'operatorPending', not in 'every context'.",
    ]);
  });

  it('refuses in( and its kind, which vim never lets through', () => {
    expect(
      problemOf([{ keys: 'in(', context: 'operatorPending', operation: 'indentObject' }]),
    ).toEqual([
      "Vim contribution 'test-refused' was not applied: 'in(' can never be reached: vim's own 'i' and 'a' match it whole after its second key, and a whole match wins over a longer mapping.",
    ]);
    // Any kind, any second key: the built-in object takes whatever follows `i` or `a`.
    expect(problemOf([{ keys: 'a,x', context: 'visual', operation: 'test.upper' }])).toHaveLength(
      1,
    );
  });

  it('is right to refuse it: the engine never reaches a mapped in(', () => {
    // The measurement behind the refusal (TYTO-420), kept so an engine that changes the rule
    // turns this red and the refusal can go.
    let calls = 0;
    Vim.defineMotion('tyto-test:unreachable', () => {
      calls++;
      return null;
    });
    Vim.mapCommand('in(', 'motion', 'tyto-test:unreachable', {}, { context: 'operatorPending' });
    try {
      keys(onBlocks(), 'd', 'i', 'n', '(');
    } finally {
      Vim.unmap('in(', 'operatorPending');
    }

    expect(calls).toBe(0);
  });
});

describe('a charwise text object (TYTO-422, ADR 0142)', () => {
  beforeEach(() => {
    // The line's text without its indent: charwise, so its `to` is exclusive.
    defineVimOperation('test.trimmed', {
      kind: 'textObject',
      select: (view, head) => {
        const line = view.state.doc.lineAt(head);
        const start = line.from + line.text.search(/\S/);
        return { from: start, to: line.to, linewise: false };
      },
    });
    setVimContributions(
      [
        {
          id: 'test-charwise',
          mappings: [
            { keys: 'iq', context: 'visual', operation: 'test.trimmed' },
            { keys: 'iq', context: 'operatorPending', operation: 'test.trimmed' },
          ],
        },
      ],
      ['test-charwise'],
    );
  });

  it('hands an operator the exact characters', () => {
    const view = onBlocks();

    keys(view, 'd', 'i', 'q');

    expect(view.state.doc.line(4).text).toBe('    ');
  });

  it('ends a visual selection on its last character', () => {
    const view = onBlocks();

    keys(view, 'v', 'i', 'q');

    expect(modeOf(view)).toMatchObject({ visualMode: true, visualLine: false });
    expect(selected(view)).toBe('text d');
  });
});
