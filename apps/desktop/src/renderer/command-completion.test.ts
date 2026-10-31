import { describe, expect, it } from 'vitest';

import type { CommandDescription } from '../../shared/ipc.js';
import {
  type CompletionSources,
  type ListedEntry,
  accept,
  complete,
  wordsAt,
} from './command-completion.js';

/**
 * Completion from a fake program definition (TYTO-496): the tree is what `cli:commands` answers,
 * so the subcommands, options and value kinds here stand for the CLI's own.
 */

const tree: CommandDescription = {
  name: 'tyto',
  description: '',
  arguments: [],
  options: [
    {
      flags: '-V, --version',
      description: 'version',
      long: '--version',
      short: '-V',
      takesValue: false,
    },
  ],
  commands: [
    {
      name: 'render',
      description: 'render a brief',
      arguments: [{ name: 'brief', required: true, description: '', value: { kind: 'brief' } }],
      options: [
        {
          flags: '-o, --out <dir>',
          description: 'out',
          long: '--out',
          short: '-o',
          takesValue: true,
          value: { kind: 'folder' },
        },
        {
          flags: '-t, --template <name>',
          description: 'template',
          long: '--template',
          short: '-t',
          takesValue: true,
          value: { kind: 'template' },
        },
        {
          flags: '-f, --formats <ids>',
          description: 'formats',
          long: '--formats',
          short: '-f',
          takesValue: true,
          value: { kind: 'formats', list: true },
        },
        {
          flags: '--types <kinds>',
          description: 'types',
          long: '--types',
          takesValue: true,
          value: { kind: 'types', list: true, choices: ['png', 'jpeg', 'webp', 'svg'] },
        },
        { flags: '--json', description: 'json', long: '--json', takesValue: false },
      ],
      commands: [],
    },
    {
      name: 'plugin',
      description: 'plugins',
      arguments: [],
      options: [],
      commands: [
        {
          name: 'disable',
          description: '',
          arguments: [{ name: 'name', required: true, description: '', value: { kind: 'plugin' } }],
          options: [],
          commands: [],
        },
      ],
    },
    { name: 'trust', description: 'trust', arguments: [], options: [], commands: [] },
  ],
};

const FOLDERS: Record<string, readonly ListedEntry[]> = {
  '': [
    { name: 'Meus briefs', kind: 'folder' },
    { name: 'cartaz.brief', kind: 'brief' },
    { name: 'notas.md', kind: 'file' },
  ],
  'Meus briefs': [
    { name: 'promo.brief', kind: 'brief' },
    { name: 'Promo antiga.brief', kind: 'brief' },
  ],
};

const sources: CompletionSources = {
  templates: () => [
    { name: 'cartaz', formats: ['feed', 'story'] },
    { name: 'carrossel', formats: ['grid-1x1'] },
    { name: 'saude-agenda', formats: ['feed'], aliasOf: 'agenda' },
  ],
  plugins: () => Promise.resolve(['google-fonts', 'fs-inbox']),
  list: (segments) => Promise.resolve(FOLDERS[segments.join('/')]),
  caseless: true,
};

const labels = async (line: string, caret = line.length) =>
  (await complete(line, caret, tree, sources)).items.map((item) => item.label);

describe('the words at the caret', () => {
  it('reads quoted words whole, and an open quote as part of the word', () => {
    const { done, current } = wordsAt('render "Meus briefs/pro', 23);
    expect(done.map((word) => word.text)).toEqual(['render']);
    expect(current).toEqual({ text: 'Meus briefs/pro', start: 7, end: 23, open: '"' });
  });

  it('starts an empty word after a space', () => {
    expect(wordsAt('render ', 7).current).toEqual({ text: '', start: 7, end: 7 });
  });
});

describe('completing from the tree', () => {
  it('offers the subcommands, by prefix and ignoring case, and a leading tyto changes nothing', async () => {
    expect(await labels('')).toEqual(['render', 'plugin', 'trust']);
    expect(await labels('R')).toEqual(['render']);
    expect(await labels('tyto pl')).toEqual(['plugin']);
    expect(await labels('plugin ')).toEqual(['disable']);
  });

  it('offers a command’s options, and not one already given', async () => {
    expect(await labels('render a.brief --t')).toEqual([
      '-t, --template <name>',
      '--types <kinds>',
    ]);
    expect(await labels('render a.brief --json --')).not.toContain('--json');
  });

  it('does not offer an option the window refuses', async () => {
    const refusing: CompletionSources = { ...sources, refused: new Set(['--template']) };
    const items = (await complete('render a.brief --t', 18, tree, refusing)).items;
    expect(items.map((item) => item.label)).toEqual(['--types <kinds>']);
  });

  it('offers nothing past the last argument', async () => {
    expect(await labels('trust ')).toEqual([]);
  });
});

describe('completing a value by its kind', () => {
  it('offers the choices a definition carries, one list item at a time', async () => {
    expect(await labels('render a.brief --types ')).toEqual(['png', 'jpeg', 'webp', 'svg']);
    const after = await complete('render a.brief --types png,', 27, tree, sources);
    expect(after.items.map((item) => item.insert)).toEqual(['png,jpeg', 'png,webp', 'png,svg']);
    expect(after.items[0]?.continues).toBe(true);
  });

  it('offers templates and aliases, and the formats of the template already chosen', async () => {
    expect(await labels('render a.brief -t ')).toEqual(['cartaz', 'carrossel', 'saude-agenda']);
    expect((await complete('render a.brief -t sa', 20, tree, sources)).items[0]?.detail).toBe(
      '→ agenda',
    );
    expect(await labels('render a.brief -t cartaz --formats ')).toEqual(['feed', 'story']);
    expect(await labels('render a.brief --formats ')).toEqual(['feed', 'story', 'grid-1x1']);
  });

  it('offers the installed plugins, and a value after an equals sign', async () => {
    expect(await labels('plugin disable g')).toEqual(['google-fonts']);
    const equals = await complete('render a.brief --types=sv', 25, tree, sources);
    expect(equals.items.map((item) => item.insert)).toEqual(['--types=svg']);
  });

  it('offers briefs and folders under the open folder, quoting a name with a space', async () => {
    const top = await complete('render ', 7, tree, sources);
    expect(top.items.map((item) => item.insert)).toEqual(['"Meus briefs/', 'cartaz.brief']);
    expect(top.items[0]?.continues).toBe(true);

    const inside = await complete('render "Meus briefs/pro', 23, tree, sources);
    expect(inside.items.map((item) => item.insert)).toEqual([
      '"Meus briefs/promo.brief"',
      '"Meus briefs/Promo antiga.brief"',
    ]);
    expect(await labels('render a.brief --out ')).toEqual(['Meus briefs/']);
  });

  it('offers no path for an absolute one, one going up, or with no folder open', async () => {
    expect(await labels('render C:\\briefs\\')).toEqual([]);
    expect(await labels('render ../')).toEqual([]);
    const closed: CompletionSources = { ...sources, list: () => Promise.resolve(undefined) };
    expect((await complete('render ', 7, tree, closed)).items).toEqual([]);
  });
});

describe('taking a suggestion', () => {
  it('replaces the whole word, adds a space after a finished one and none after a folder', () => {
    expect(
      accept(
        'ren --json',
        { from: 0, to: 3 },
        { label: 'render', insert: 'render', continues: false },
      ),
    ).toEqual({ line: 'render --json', caret: 6 });
    expect(
      accept(
        'render "Me',
        { from: 7, to: 10 },
        { label: 'Meus briefs/', insert: '"Meus briefs/', continues: true },
      ),
    ).toEqual({ line: 'render "Meus briefs/', caret: 20 });
    expect(
      accept('pl', { from: 0, to: 2 }, { label: 'plugin', insert: 'plugin', continues: false }),
    ).toEqual({
      line: 'plugin ',
      caret: 7,
    });
  });
});
