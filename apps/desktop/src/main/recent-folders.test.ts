import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RECENT_LIMIT, fileRecentFolders } from './recent-files.js';
import { createRecentFoldersService } from './recent-folders.js';

/**
 * The recent workspace folders (TYTO-487): the list on a real disk, as `recent-files.test.ts`
 * drives the files', and the service that mints the window's ids over it with the disk's
 * answer for which folders are still there given as a set.
 */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recent-folders-'));
  file = join(scratch, 'state', 'recent-folders.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A service over the real list, with `present` standing in for the disk. */
function service(present: Set<string>, platform: NodeJS.Platform = 'linux') {
  return createRecentFoldersService({
    list: fileRecentFolders(file, platform),
    exists: (folder) => Promise.resolve(present.has(folder)),
    home: () => (platform === 'win32' ? 'C:\\Users\\rafael' : '/home/rafael'),
    platform,
  });
}

describe('the folder list', () => {
  it('keeps the newest first, moves a reopened folder to the front, and stops at the cap', async () => {
    const present = new Set<string>();
    const recent = service(present);
    for (let index = 0; index < RECENT_LIMIT + 3; index += 1) {
      const folder = `/work/project-${String(index)}`;
      present.add(folder);
      await recent.remember(folder);
    }
    await recent.remember('/work/project-5');

    const names = (await recent.listing(null)).map((row) => row.name);
    expect(names).toHaveLength(RECENT_LIMIT);
    expect(names.slice(0, 3)).toEqual(['project-5', 'project-12', 'project-11']);
    // The three oldest fell off the end.
    expect(names).not.toContain('project-2');
  });

  it('writes under its own key, beside the files and not inside them', async () => {
    await service(new Set()).remember('/work/promo');

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      folders: [{ path: '/work/promo', name: 'promo' }],
    });
  });

  it('drops a folder that is gone from the listing', async () => {
    const present = new Set(['/work/kept']);
    const recent = service(present);
    await recent.remember('/work/gone');
    await recent.remember('/work/kept');

    expect((await recent.listing(null)).map((row) => row.name)).toEqual(['kept']);
  });

  it('treats two spellings of one folder as one entry on Windows', async () => {
    const present = new Set(['C:\\Work\\Promo', 'c:\\work\\promo']);
    const recent = service(present, 'win32');
    await recent.remember('C:\\Work\\Promo');
    await recent.remember('c:\\work\\promo');

    const rows = await recent.listing('C:\\WORK\\PROMO');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'promo', current: true });
  });

  it('names a folder by its platform’s separators, whatever machine runs this', async () => {
    // Injected rather than read from `node:path`: Linux CI must name a Windows path as Windows
    // does, and a backslash in a posix name is part of the name.
    const windows = service(new Set(['D:\\trabalho\\templates']), 'win32');
    await windows.remember('D:\\trabalho\\templates');
    expect((await windows.listing(null))[0]?.name).toBe('templates');

    rmSync(file, { force: true });
    const posix = service(new Set(['/srv/odd\\name']), 'linux');
    await posix.remember('/srv/odd\\name');
    expect((await posix.listing(null))[0]?.name).toBe('odd\\name');
  });

  it('keeps case apart where the disk does', async () => {
    const present = new Set(['/work/Promo', '/work/promo']);
    const recent = service(present);
    await recent.remember('/work/Promo');
    await recent.remember('/work/promo');

    expect(await recent.listing(null)).toHaveLength(2);
  });

  it('answers a file full of nonsense with an empty list', async () => {
    const recent = service(new Set(['/work/promo']));
    await recent.remember('/work/promo');
    writeFileSync(file, '{ "folders": [ nonsense', 'utf8');

    await expect(recent.listing(null)).resolves.toEqual([]);
  });
});

describe('the ids the window is handed', () => {
  it('shows a label and never a raw path, and marks the open folder', async () => {
    const recent = service(new Set(['/home/rafael/promo', '/srv/templates']));
    await recent.remember('/srv/templates');
    await recent.remember('/home/rafael/promo');

    const rows = await recent.listing('/srv/templates');
    expect(rows.map(({ id: _id, ...row }) => row)).toEqual([
      { name: 'promo', pathLabel: '~/promo', current: false },
      { name: 'templates', pathLabel: '/srv/templates', current: true },
    ]);
    for (const row of rows) expect(row.id).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('opens the folder an id names, and nothing for the open one, a stranger or a vanished one', async () => {
    const present = new Set(['/work/promo', '/work/templates', '/work/gone']);
    const recent = service(present);
    await recent.remember('/work/gone');
    await recent.remember('/work/templates');
    await recent.remember('/work/promo');
    const ids = Object.fromEntries((await recent.listing(null)).map((row) => [row.name, row.id]));

    expect(await recent.chosen(ids.templates ?? '', '/work/promo')).toBe('/work/templates');
    // Choosing the folder already open is not a reopen.
    expect(await recent.chosen(ids.promo ?? '', '/work/promo')).toBeUndefined();
    // An id nobody minted, and a path offered as one, name nothing.
    expect(await recent.chosen('0123456789abcdef', null)).toBeUndefined();
    expect(await recent.chosen('/work/promo', null)).toBeUndefined();
    present.delete('/work/gone');
    expect(await recent.chosen(ids.gone ?? '', null)).toBeUndefined();
  });

  it('keeps an id across listings, so a popover open while the list changes still opens its row', async () => {
    const recent = service(new Set(['/work/promo', '/work/templates']));
    await recent.remember('/work/promo');
    const before = (await recent.listing(null))[0]?.id;
    await recent.remember('/work/templates');

    expect((await recent.listing(null)).find((row) => row.name === 'promo')?.id).toBe(before);
  });
});
