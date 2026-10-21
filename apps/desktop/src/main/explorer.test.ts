import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type WatchFolder,
  createExplorerService,
  ignoredByTheWatcher,
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
