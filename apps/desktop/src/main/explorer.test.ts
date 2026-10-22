import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ExplorerService,
  type WatchFolder,
  checkEntryName,
  createExplorerService,
  ignoredByTheWatcher,
  relativeUnder,
  watchRecursively,
} from './explorer.js';

/**
 * The explorer's listing and watcher on a real disk (TYTO-279, ADR 0115): what the window is
 * told, that it is never a path, what an id stops meaning, and when the window hears a change.
 * The watcher is a stand-in for the timing tests and the platform's own for the one that asks
 * whether a file made outside the app is heard at all.
 */

let scratch: string;
let work: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-explorer-')));
  work = join(scratch, 'promo');
  await mkdir(join(work, 'slides', 'extra'), { recursive: true });
  await mkdir(join(work, '.git'), { recursive: true });
  await mkdir(join(work, 'assets'), { recursive: true });
  await writeFile(join(work, 'slide 10.brief'), '::a');
  await writeFile(join(work, 'slide 2.brief'), '::a');
  await writeFile(join(work, 'logo.png'), '');
  await writeFile(join(work, 'slides', 'capa.brief'), '::a');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(scratch, { recursive: true, force: true });
});

/** A watcher the test fires by hand, and that records whether it was closed. */
const handWatcher = () => {
  const watchers: { folder: string; fire: (name: string | null) => void; closed: boolean }[] = [];
  const watch: WatchFolder = (folder, onChange) => {
    const watcher = { folder, fire: onChange, closed: false };
    watchers.push(watcher);
    return {
      close: () => {
        watcher.closed = true;
      },
    };
  };
  return { watch, watchers };
};

const quiet = () =>
  createExplorerService({ onChange: () => undefined, watch: handWatcher().watch });

/** The id the listing of `folder` (`null` is the root) gives `name`, or `''`. */
const entryIdOf = async (
  explorer: ExplorerService,
  name: string,
  folder: string | null = null,
): Promise<string> =>
  (await explorer.list(folder)).entries.find((entry) => entry.name === name)?.id ?? '';

describe('listing the open folder', () => {
  it('answers folders first, names as a person reads numbers, and no .git', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);

    const root = await explorer.list(null);

    expect(root.entries.map(({ name, kind }) => [name, kind])).toEqual([
      ['assets', 'folder'],
      ['slides', 'folder'],
      ['logo.png', 'file'],
      ['slide 2.brief', 'brief'],
      ['slide 10.brief', 'brief'],
    ]);
    expect(root).toMatchObject({ more: 0, gone: false });
  });

  it('never tells the window a path', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const root = await explorer.list(null);
    const slides = root.entries.find((entry) => entry.name === 'slides');

    const told = JSON.stringify([root, await explorer.list(slides?.id ?? '')]);

    expect(told).not.toContain(scratch);
    expect(told).not.toContain('promo');
  });

  it('lists a folder by the id it was given, and the same id for the same path next time', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const slides = (await explorer.list(null)).entries.find((entry) => entry.name === 'slides');

    const children = await explorer.list(slides?.id ?? '');
    const again = (await explorer.list(null)).entries.find((entry) => entry.name === 'slides');

    expect(children.entries.map((entry) => entry.name)).toEqual(['extra', 'capa.brief']);
    expect(again?.id).toBe(slides?.id);
  });

  it('counts what it leaves out past the cap', async () => {
    const explorer = createExplorerService({
      onChange: () => undefined,
      watch: handWatcher().watch,
      cap: 3,
    });
    await explorer.setRoot(work);

    const root = await explorer.list(null);

    expect(root.entries.map((entry) => entry.name)).toEqual(['assets', 'slides', 'logo.png']);
    expect(root.more).toBe(2);
  });

  it('does not list a link that leads outside the folder', async () => {
    const outside = join(scratch, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.brief'), '::a');
    // A junction on Windows needs no privilege, and is the link a person there would make.
    await symlink(outside, join(work, 'atalho'), 'junction');
    await symlink(join(work, 'slides'), join(work, 'dentro'), 'junction');
    const explorer = quiet();
    await explorer.setRoot(work);

    const names = (await explorer.list(null)).entries.map((entry) => entry.name);

    expect(names).not.toContain('atalho');
    // A link that stays inside is an ordinary folder.
    expect(names).toContain('dentro');
  });
});

describe('an id that names nothing', () => {
  it('answers an empty listing marked gone when its folder was deleted or renamed outside', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const root = await explorer.list(null);
    const slides = root.entries.find((entry) => entry.name === 'slides');
    const assets = root.entries.find((entry) => entry.name === 'assets');

    await rename(join(work, 'slides'), join(work, 'lâminas'));
    await rm(join(work, 'assets'), { recursive: true });

    for (const id of [slides?.id ?? '', assets?.id ?? '']) {
      await expect(explorer.list(id)).resolves.toEqual({ entries: [], more: 0, gone: true });
    }
  });

  it('answers gone for an id it never minted, for a file, and for the folder before this one', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const root = await explorer.list(null);
    const slides = root.entries.find((entry) => entry.name === 'slides');
    const logo = root.entries.find((entry) => entry.name === 'logo.png');

    await expect(explorer.list('../../etc')).resolves.toMatchObject({ gone: true });
    await expect(explorer.list(logo?.id ?? '')).resolves.toMatchObject({ gone: true });

    await explorer.setRoot(join(work, 'slides'));
    await expect(explorer.list(slides?.id ?? '')).resolves.toMatchObject({ gone: true });
  });

  it('answers gone for everything once the folder closes', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    await explorer.setRoot(undefined);

    await expect(explorer.list(null)).resolves.toEqual({ entries: [], more: 0, gone: true });
  });
});

describe('the brief a click opens', () => {
  it('is a brief main listed, still inside the folder, and nothing else', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const root = await explorer.list(null);
    const idOf = (name: string): string =>
      root.entries.find((entry) => entry.name === name)?.id ?? '';

    expect(await explorer.briefPath(idOf('slide 2.brief'))).toBe(join(work, 'slide 2.brief'));
    expect(await explorer.briefPath(idOf('logo.png'))).toBeUndefined();
    expect(await explorer.briefPath(idOf('slides'))).toBeUndefined();
    expect(await explorer.briefPath('not-an-id')).toBeUndefined();

    await rm(join(work, 'slide 2.brief'));
    expect(await explorer.briefPath(idOf('slide 2.brief'))).toBeUndefined();
  });
});

describe('hearing a change', () => {
  it('tells the window once a burst has been quiet for the settle time', async () => {
    vi.useFakeTimers();
    const { watch, watchers } = handWatcher();
    const onChange = vi.fn();
    const explorer = createExplorerService({ onChange, watch, settleMs: 150 });
    await explorer.setRoot(work);

    watchers[0]?.fire('a.brief');
    vi.advanceTimersByTime(100);
    watchers[0]?.fire('b.brief');
    vi.advanceTimersByTime(149);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not hear .git or node_modules, at any depth', async () => {
    vi.useFakeTimers();
    const { watch, watchers } = handWatcher();
    const onChange = vi.fn();
    const explorer = createExplorerService({ onChange, watch, settleMs: 150 });
    await explorer.setRoot(work);

    watchers[0]?.fire('.git/index');
    watchers[0]?.fire(join('packages', 'node_modules', 'zod', 'index.js'));
    vi.advanceTimersByTime(500);

    expect(onChange).not.toHaveBeenCalled();
    expect(ignoredByTheWatcher('.gitignore')).toBe(false);
    expect(ignoredByTheWatcher(null)).toBe(false);
  });

  it('emits nothing for a closed folder, a folder replaced, or after quit', async () => {
    vi.useFakeTimers();
    const { watch, watchers } = handWatcher();
    const onChange = vi.fn();
    const explorer = createExplorerService({ onChange, watch, settleMs: 150 });

    await explorer.setRoot(work);
    watchers[0]?.fire('a.brief');
    // Closed with a change still settling: the timer is dropped with the watcher.
    await explorer.setRoot(undefined);
    watchers[0]?.fire('late.brief');
    vi.advanceTimersByTime(500);
    expect(watchers[0]?.closed).toBe(true);

    await explorer.setRoot(work);
    await explorer.setRoot(join(work, 'slides'));
    watchers[1]?.fire('old.brief');
    expect(watchers[1]?.closed).toBe(true);

    explorer.close();
    watchers[2]?.fire('after-quit.brief');
    vi.advanceTimersByTime(500);

    expect(watchers[2]?.closed).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the watcher and the ids when the same folder is read again', async () => {
    const { watch, watchers } = handWatcher();
    const explorer = createExplorerService({ onChange: () => undefined, watch });
    await explorer.setRoot(work);
    const before = (await explorer.list(null)).entries.map((entry) => entry.id);

    await explorer.setRoot(work);

    expect(watchers).toHaveLength(1);
    expect((await explorer.list(null)).entries.map((entry) => entry.id)).toEqual(before);
  });

  it('hears a file made outside the app, with the platform watcher', async () => {
    const onChange = vi.fn();
    const explorer = createExplorerService({ onChange, watch: watchRecursively, settleMs: 50 });
    await explorer.setRoot(work);

    await writeFile(join(work, 'slides', 'extra', 'nova.brief'), '::a');

    try {
      // Two folders deep, because Linux's recursive watch is Node's own walk, not the kernel's.
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000, interval: 50 });
    } finally {
      explorer.close();
    }
  });
});

describe('flagging what a name cannot tell (TYTO-282, ADR 0116)', () => {
  beforeEach(async () => {
    await mkdir(join(work, '.tyto'), { recursive: true });
    await writeFile(join(work, '.tyto', 'project.json'), '{}');
    await writeFile(join(work, 'project.json'), '{}');
    await mkdir(join(work, 'saida'), { recursive: true });
    await mkdir(join(work, 'modelos', 'banner'), { recursive: true });
    await mkdir(join(work, 'fotos'), { recursive: true });
  });

  const placesOf = async (
    explorer: ReturnType<typeof quiet>,
    entryId: string | null,
  ): Promise<Record<string, string | undefined>> =>
    Object.fromEntries(
      (await explorer.list(entryId)).entries.map((entry) => [entry.name, entry.place]),
    );

  const idOf = async (explorer: ReturnType<typeof quiet>, name: string): Promise<string> =>
    (await explorer.list(null)).entries.find((entry) => entry.name === name)?.id ?? '';

  it('flags the output, templates and assets folders, a template, and the project file', async () => {
    const explorer = quiet();
    await explorer.setRoot(work, {
      output: join(work, 'saida'),
      assets: [join(work, 'fotos')],
      templates: [join(work, 'modelos')],
    });

    expect(await placesOf(explorer, null)).toMatchObject({
      saida: 'output',
      modelos: 'templates',
      fotos: 'assets',
      // `assets` by name is the window's to draw; main flags only what the project named.
      assets: undefined,
      slides: undefined,
      'project.json': undefined,
    });
    expect(await placesOf(explorer, await idOf(explorer, 'modelos'))).toEqual({
      banner: 'template',
    });
    expect(await placesOf(explorer, await idOf(explorer, '.tyto'))).toEqual({
      'project.json': 'project',
    });
  });

  it('gives one folder named twice the first place in the order', async () => {
    const explorer = quiet();
    await explorer.setRoot(work, {
      output: join(work, 'saida'),
      assets: [join(work, 'saida'), join(work, 'modelos')],
      templates: [join(work, 'saida'), join(work, 'modelos'), join(work, 'modelos', 'banner')],
    });

    expect(await placesOf(explorer, null)).toMatchObject({
      saida: 'output',
      modelos: 'templates',
    });
    // Both a templates folder and a folder inside one: the templates folder wins.
    expect(await placesOf(explorer, await idOf(explorer, 'modelos'))).toEqual({
      banner: 'templates',
    });
  });

  it('flags nothing for a place that does not exist', async () => {
    const explorer = quiet();
    await explorer.setRoot(work, { output: join(work, 'nada'), assets: [], templates: [] });

    expect(Object.values(await placesOf(explorer, null)).filter(Boolean)).toEqual([]);
  });

  it('tells the window to list again when the same folder names new places, keeping the ids', async () => {
    const onChange = vi.fn();
    const explorer = createExplorerService({ onChange, watch: handWatcher().watch });
    await explorer.setRoot(work);
    const before = await idOf(explorer, 'saida');

    await explorer.setRoot(work, { output: undefined, assets: [], templates: [] });
    expect(onChange).not.toHaveBeenCalled();
    await explorer.setRoot(work, { output: join(work, 'saida'), assets: [], templates: [] });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await idOf(explorer, 'saida')).toBe(before);
    expect((await placesOf(explorer, null)).saida).toBe('output');
  });
});

/** The names nothing may be called, on any operating system (TYTO-352, ADR 0121 rule 1). */
describe('a name for a new or renamed entry', () => {
  it('refuses what would leave the folder, what Windows forbids, and .git', () => {
    const refused = [
      '',
      '   ',
      '.',
      '..',
      '..\\x',
      '../x',
      'a/b',
      'a\\b',
      'nul\u0000l',
      'tab\there',
      'del\u007f',
      'a<b',
      'a>b',
      'a:b',
      'a"b',
      'a|b',
      'a?b',
      'a*b',
      'fim.',
      'fim ',
      'CON',
      'con.brief',
      'Prn',
      'aux.txt',
      'NUL',
      'com1',
      'LPT9.log',
      'x'.repeat(256),
      '.git',
      '.GIT',
    ];
    expect(refused.filter((name) => checkEntryName(name))).toEqual([]);
  });

  it('accepts ordinary names, a leading dot and names that only start like a device', () => {
    const accepted = [
      'promo.brief',
      'slide 2',
      '.tyto',
      '..notas',
      ' espaço antes',
      'lâminas',
      'console.brief',
      'com0',
      'lpt10',
      'CONTRATO',
      '.gitignore',
      'x'.repeat(255),
    ];
    expect(accepted.filter((name) => !checkEntryName(name))).toEqual([]);
  });

  it('reads a child called ..notas as under its folder, and the parent as not', () => {
    expect(relativeUnder(work, join(work, '..notas'))).toBe('..notas');
    expect(relativeUnder(work, work)).toBe('');
    expect(relativeUnder(work, scratch)).toBeUndefined();
    expect(relativeUnder(work, join(scratch, 'promo-old'))).toBeUndefined();
  });
});

describe('making a new entry', () => {
  it('makes an empty file or folder by id and name, and the listing shows it with that id', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const slides = await entryIdOf(explorer, 'slides');

    const brief = await explorer.create(null, 'novo.brief', 'file');
    const folder = await explorer.create(slides, 'anexos', 'folder');

    expect(brief).toMatchObject({ ok: true, entry: { name: 'novo.brief', kind: 'brief' } });
    expect(folder).toMatchObject({ ok: true, entry: { name: 'anexos', kind: 'folder' } });
    expect(await readFile(join(work, 'novo.brief'), 'utf8')).toBe('');
    expect((await stat(join(work, 'slides', 'anexos'))).isDirectory()).toBe(true);
    expect(brief.ok && (await entryIdOf(explorer, 'novo.brief'))).toBe(brief.ok && brief.entry.id);
  });

  it('answers exists rather than replace a file or a folder that is there', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    await writeFile(join(work, 'slide 2.brief'), 'kept');

    await expect(explorer.create(null, 'slide 2.brief', 'file')).resolves.toEqual({
      ok: false,
      reason: 'exists',
    });
    await expect(explorer.create(null, 'slides', 'folder')).resolves.toEqual({
      ok: false,
      reason: 'exists',
    });
    await expect(explorer.create(null, 'slides', 'file')).resolves.toEqual({
      ok: false,
      reason: 'exists',
    });
    expect(await readFile(join(work, 'slide 2.brief'), 'utf8')).toBe('kept');
    expect((await readdir(join(work, 'slides'))).sort()).toEqual(['capa.brief', 'extra']);
  });

  it('writes nothing for a name that is refused, and nothing outside the folder', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const before = await readdir(scratch);

    for (const name of ['..\\fora.brief', '../fora.brief', 'a/b', 'CON', '..']) {
      await expect(explorer.create(null, name, 'file')).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(await readdir(scratch)).toEqual(before);
    expect((await readdir(work)).sort()).toEqual(
      ['.git', 'assets', 'logo.png', 'slide 10.brief', 'slide 2.brief', 'slides'].sort(),
    );
  });

  it('answers gone for a parent that is a file, an id it never minted, or a folder deleted', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const logo = await entryIdOf(explorer, 'logo.png');
    const assets = await entryIdOf(explorer, 'assets');
    await rm(join(work, 'assets'), { recursive: true });

    for (const parent of [logo, 'never-minted', assets]) {
      await expect(explorer.create(parent, 'x.brief', 'file')).resolves.toEqual({
        ok: false,
        reason: 'gone',
      });
    }
  });
});

describe('renaming an entry', () => {
  it('keeps the id of the entry and of everything under a folder', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const slides = await entryIdOf(explorer, 'slides');
    const capa = await entryIdOf(explorer, 'capa.brief', slides);
    const extra = await entryIdOf(explorer, 'extra', slides);

    const renamed = await explorer.rename(slides, 'lâminas');

    expect(renamed).toMatchObject({
      ok: true,
      entry: { id: slides, name: 'lâminas', kind: 'folder' },
      from: join(work, 'slides'),
      to: join(work, 'lâminas'),
    });
    expect(await entryIdOf(explorer, 'lâminas')).toBe(slides);
    // The expanded subtree is listed by the ids it already had.
    expect(await entryIdOf(explorer, 'capa.brief', slides)).toBe(capa);
    expect(await entryIdOf(explorer, 'extra', slides)).toBe(extra);
    expect(await explorer.briefPath(capa)).toBe(join(work, 'lâminas', 'capa.brief'));
  });

  it('answers exists and moves nothing when the name is taken', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    await writeFile(join(work, 'slide 2.brief'), 'two');
    await writeFile(join(work, 'slide 10.brief'), 'ten');
    const two = await entryIdOf(explorer, 'slide 2.brief');

    await expect(explorer.rename(two, 'slide 10.brief')).resolves.toEqual({
      ok: false,
      reason: 'exists',
    });
    await expect(explorer.rename(two, 'slides')).resolves.toEqual({
      ok: false,
      reason: 'exists',
    });
    expect(await readFile(join(work, 'slide 2.brief'), 'utf8')).toBe('two');
    expect(await readFile(join(work, 'slide 10.brief'), 'utf8')).toBe('ten');
  });

  it('changes only the case of a name, which lands on the entry itself where case is ignored', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const two = await entryIdOf(explorer, 'slide 2.brief');

    await expect(explorer.rename(two, 'Slide 2.brief')).resolves.toMatchObject({
      ok: true,
      entry: { id: two, name: 'Slide 2.brief' },
    });
    expect(await readdir(work)).toContain('Slide 2.brief');
    expect(await readdir(work)).not.toContain('slide 2.brief');
  });

  it.runIf(process.platform === 'linux')(
    'answers exists for another case where case is a different file',
    async () => {
      await writeFile(join(work, 'Slide 2.brief'), 'other');
      const explorer = quiet();
      await explorer.setRoot(work);
      const two = await entryIdOf(explorer, 'slide 2.brief');

      await expect(explorer.rename(two, 'Slide 2.brief')).resolves.toEqual({
        ok: false,
        reason: 'exists',
      });
      expect(await readFile(join(work, 'Slide 2.brief'), 'utf8')).toBe('other');
    },
  );

  it('changes the kind with the extension, and refuses a name that would leave the folder', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const logo = await entryIdOf(explorer, 'logo.png');

    await expect(explorer.rename(logo, '..\\fora.png')).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    await expect(explorer.rename(logo, 'logo.brief')).resolves.toMatchObject({
      ok: true,
      entry: { id: logo, kind: 'brief' },
    });
    expect(await explorer.briefPath(logo)).toBe(join(work, 'logo.brief'));
  });

  it('answers gone for an entry deleted outside the app', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const logo = await entryIdOf(explorer, 'logo.png');
    await rm(join(work, 'logo.png'));

    await expect(explorer.rename(logo, 'logo2.png')).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
  });
});

describe('deleting an entry', () => {
  /** A trash that is a folder of the scratch, so a test can see what went in. */
  const standInTrash = async () => {
    const bin = join(scratch, 'lixeira');
    await mkdir(bin);
    const trashed: string[] = [];
    const trash = async (path: string): Promise<void> => {
      trashed.push(path);
      await rename(path, join(bin, `${String(trashed.length)}-${basename(path)}`));
    };
    return { bin, trashed, trash };
  };

  it('moves the entry to the trash, and forgets its id and the ids under it', async () => {
    const { bin, trash } = await standInTrash();
    const explorer = createExplorerService({
      onChange: () => undefined,
      watch: handWatcher().watch,
      trash,
    });
    await explorer.setRoot(work);
    const slides = await entryIdOf(explorer, 'slides');
    const capa = await entryIdOf(explorer, 'capa.brief', slides);

    await expect(explorer.delete(slides)).resolves.toEqual({
      ok: true,
      path: join(work, 'slides'),
    });

    expect(await readdir(work)).not.toContain('slides');
    expect((await readdir(join(bin, '1-slides'))).sort()).toEqual(['capa.brief', 'extra']);
    await expect(explorer.list(slides)).resolves.toMatchObject({ gone: true });
    expect(await explorer.briefPath(capa)).toBeUndefined();
    await expect(explorer.delete(slides)).resolves.toEqual({ ok: false, reason: 'gone' });
  });

  it('answers trash-failed and leaves the file where it was when the trash refuses', async () => {
    const onError = vi.fn();
    const explorer = createExplorerService({
      onChange: () => undefined,
      onError,
      watch: handWatcher().watch,
      trash: () => Promise.reject(new Error('the bin is full')),
    });
    await explorer.setRoot(work);
    const two = await entryIdOf(explorer, 'slide 2.brief');

    await expect(explorer.delete(two)).resolves.toEqual({ ok: false, reason: 'trash-failed' });

    expect(await readFile(join(work, 'slide 2.brief'), 'utf8')).toBe('::a');
    expect(await entryIdOf(explorer, 'slide 2.brief')).toBe(two);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing when there is no trash at all', async () => {
    const explorer = quiet();
    await explorer.setRoot(work);
    const two = await entryIdOf(explorer, 'slide 2.brief');

    await expect(explorer.delete(two)).resolves.toEqual({ ok: false, reason: 'trash-failed' });
    expect(await readdir(work)).toContain('slide 2.brief');
  });
});
