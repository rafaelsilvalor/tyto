import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import {
  type BuiltinContext,
  type BuiltinOutcome,
  type FileRead,
  type PanelFiles,
  type PanelWrites,
  PANEL_BUILTINS,
} from './command-builtins.js';
import { absoluteFolder } from './command-file-builtins.js';

/**
 * The command panel's reading file commands (TYTO-537, ADR 0201): `ls`, `cd`, `pwd` and `cat`,
 * over a workspace whose ids are its steps joined with `/`.
 */

type Kind = 'folder' | 'brief' | 'file';

const TREE: Record<string, readonly { name: string; kind: Kind }[]> = {
  '': [
    { name: 'entregas', kind: 'folder' },
    { name: 'capa.brief', kind: 'brief' },
    { name: 'semana.recipe', kind: 'file' },
    { name: 'notas.txt', kind: 'file' },
  ],
  entregas: [{ name: 'novembro', kind: 'folder' }],
  'entregas/novembro': [{ name: 'story.brief', kind: 'brief' }],
};

const TEXTS: Record<string, FileRead> = {
  'notas.txt': { ok: true, text: 'one\r\ntwo\n', truncated: false },
  'capa.brief': { ok: true, text: '::a', truncated: true },
  'semana.recipe': { ok: false, reason: 'binary' },
};

function workspace(
  working: readonly string[] = [],
  more = 0,
): { files: PanelFiles; moved: (readonly string[])[] } {
  const moved: (readonly string[])[] = [];
  return {
    moved,
    files: {
      folder: 'C:\\work\\promo',
      workingFolder: working,
      changeFolder: (steps) => moved.push(steps),
      list: (entryId) => {
        const key = entryId ?? '';
        return Promise.resolve({
          entries: (TREE[key] ?? []).map((entry) => ({
            ...entry,
            id: key === '' ? entry.name : `${key}/${entry.name}`,
          })),
          more: key === '' ? more : 0,
        });
      },
      read: (entryId) => Promise.resolve(TEXTS[entryId] ?? { ok: false, reason: 'gone' }),
      caseless: true,
      writes: {} as PanelWrites,
    },
  };
}

const run = (
  name: string,
  args: readonly string[],
  files: PanelFiles | undefined,
): Promise<BuiltinOutcome> => {
  const context: BuiltinContext = {
    args: args.map((text) => ({ text, quoted: false })),
    history: () => [],
    runTyto: () => Promise.resolve(true),
    clear: () => undefined,
    exit: () => undefined,
    commands: () => Promise.resolve([]),
    say: (key) => translate('en', key),
    registry: PANEL_BUILTINS,
    files,
    aliases: {
      list: () => Promise.resolve({ aliases: [], workspace: 'none' }),
      set: () => Promise.resolve({ ok: true }),
      reserved: () => false,
    },
    variables: { all: () => new Map(), set: () => undefined },
  };
  return Promise.resolve(PANEL_BUILTINS.find({ text: name, quoted: false })!.run(context));
};

describe('ls', () => {
  it('lists the working folder: folders end in /, every name beside its kind', async () => {
    expect(await run('ls', [], workspace().files)).toEqual({
      kind: 'printed',
      lines: [
        'entregas/      folder',
        'capa.brief     brief',
        'semana.recipe  recipe',
        'notas.txt      file',
      ],
      base: [],
    });
  });

  it('lists a folder by path, and says its names are in it, for the links', async () => {
    expect(await run('ls', ['novembro'], workspace(['entregas']).files)).toEqual({
      kind: 'printed',
      lines: ['story.brief  brief'],
      base: ['entregas', 'novembro'],
    });
  });

  it('lists a file as itself, as typed', async () => {
    expect(await run('ls', ['../capa.brief'], workspace(['entregas']).files)).toEqual({
      kind: 'printed',
      lines: ['../capa.brief  brief'],
      base: ['entregas'],
    });
  });

  it('counts what the explorer left out past its cap', async () => {
    const outcome = await run('ls', [], workspace([], 3).files);
    expect(outcome).toMatchObject({
      notes: ["… and 3 more, past the explorer's limit."],
    });
  });

  it.each([
    ['..', 'leads outside the workspace folder'],
    ['C:\\Windows', 'leads outside the workspace folder'],
    ['nada', 'no such file or folder'],
  ])('refuses %s', async (typed, said) => {
    const outcome = await run('ls', [typed], workspace().files);
    expect(outcome).toMatchObject({ kind: 'printed', failed: true });
    expect(outcome.kind === 'printed' ? outcome.lines[0] : '').toContain(said);
  });
});

describe('cd', () => {
  it('moves the working folder, with the names as the disk has them', async () => {
    const { files, moved } = workspace(['entregas']);
    expect(await run('cd', ['NOVEMBRO'], files)).toEqual({ kind: 'printed', lines: [] });
    expect(moved).toEqual([['entregas', 'novembro']]);
  });

  it('goes back with `..` and to the root alone', async () => {
    const { files, moved } = workspace(['entregas', 'novembro']);
    await run('cd', ['..'], files);
    await run('cd', [], files);
    expect(moved).toEqual([['entregas'], []]);
  });

  it.each([
    ['..', 'leads outside'],
    ['/etc', 'leads outside'],
    ['\\\\server\\share', 'leads outside'],
    ['~', 'leads outside'],
    ['capa.brief', 'is not a folder'],
    ['nada', 'no such file or folder'],
  ])('stays where it is for %s', async (typed, said) => {
    const { files, moved } = workspace();
    const outcome = await run('cd', [typed], files);
    expect(outcome).toMatchObject({ kind: 'printed', failed: true });
    expect(outcome.kind === 'printed' ? outcome.lines[0] : '').toContain(said);
    expect(moved).toEqual([]);
  });

  it('takes one folder at most', async () => {
    const outcome = await run('cd', ['a', 'b'], workspace().files);
    expect(outcome).toEqual({
      kind: 'printed',
      lines: ['cd: takes at most one folder.'],
      failed: true,
    });
  });
});

describe('pwd', () => {
  it('prints the working folder under the workspace, with its separator', async () => {
    expect(await run('pwd', [], workspace(['entregas', 'novembro']).files)).toEqual({
      kind: 'printed',
      lines: ['C:\\work\\promo\\entregas\\novembro'],
    });
    expect(absoluteFolder('/home/ana/promo', [])).toBe('/home/ana/promo');
    expect(absoluteFolder('/home/ana/promo/', ['a'])).toBe('/home/ana/promo/a');
  });
});

describe('cat', () => {
  it('prints a text file by line, and a note for one cut at the cap', async () => {
    expect(await run('cat', ['notas.txt', 'capa.brief'], workspace().files)).toEqual({
      kind: 'printed',
      lines: ['one', 'two', '::a'],
      base: [],
      notes: ['capa.brief is longer than 256 KB: only its first 256 KB are printed.'],
    });
  });

  it.each([
    ['semana.recipe', 'is not text'],
    ['entregas', 'is a folder'],
    ['../x.txt', 'leads outside'],
    ['nada.txt', 'no such file or folder'],
  ])('refuses %s', async (typed, said) => {
    const outcome = await run('cat', [typed], workspace().files);
    expect(outcome).toMatchObject({ kind: 'printed', failed: true });
    expect(outcome.kind === 'printed' ? outcome.lines[0] : '').toContain(said);
  });
});

describe('with no workspace folder open', () => {
  it.each(['ls', 'cd', 'pwd', 'cat'])('%s says it needs one', async (name) => {
    const outcome = await run(name, ['x'], undefined);
    expect(outcome).toMatchObject({ kind: 'printed', failed: true });
    expect(outcome.kind === 'printed' ? outcome.lines[0] : '').toContain(
      'needs a workspace folder open',
    );
  });
});

describe('in a restricted folder', () => {
  it('all four run: they read and run nothing (ADR 0201 decision 4)', () => {
    for (const name of ['ls', 'cd', 'pwd', 'cat']) {
      expect(PANEL_BUILTINS.find({ text: name, quoted: false })?.runsInRestrictedFolder).toBe(true);
    }
  });
});
