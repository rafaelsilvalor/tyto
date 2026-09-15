import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RECENT_LIMIT, fileRecentFiles } from './recent-files.js';

/**
 * The recent list against a real folder (E9.8).
 *
 * A real disk rather than a double, because every interesting thing this module does is
 * about what a disk can be: a file that is not there, a file full of nonsense, a folder
 * that does not exist yet. A double would agree with whatever this file assumed.
 *
 * The rule under all of it is that **nothing here fails loudly**. A recent list is a
 * convenience, and the one outcome worse than forgetting it is an app that will not open
 * because of it.
 */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recent-'));
  file = join(scratch, 'state', 'recent-files.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('remembering', () => {
  it('creates the folder it was pointed at', async () => {
    // `app.getPath('userData')` exists, but the subfolder this writes into may not, and a
    // first run is exactly when it does not.
    const recent = fileRecentFiles(file);

    await recent.remember({ path: '/briefs/a.brief', name: 'a.brief' });

    await expect(recent.list()).resolves.toEqual([{ path: '/briefs/a.brief', name: 'a.brief' }]);
  });

  it('survives being read by a second reader, which is what a restart is', async () => {
    await fileRecentFiles(file).remember({ path: '/briefs/a.brief', name: 'a.brief' });

    await expect(fileRecentFiles(file).list()).resolves.toEqual([
      { path: '/briefs/a.brief', name: 'a.brief' },
    ]);
  });

  it('moves a file already in the list to the front rather than duplicating it', async () => {
    const recent = fileRecentFiles(file);
    await recent.remember({ path: '/a.brief', name: 'a.brief' });
    await recent.remember({ path: '/b.brief', name: 'b.brief' });
    await recent.remember({ path: '/a.brief', name: 'a.brief' });

    const names = (await recent.list()).map((entry) => entry.name);
    expect(names).toEqual(['a.brief', 'b.brief']);
  });

  it('tells two files of the same name apart by their folder', async () => {
    // Two campaigns both called `campanha.brief` are two entries, and opening one must not
    // evict the other.
    const recent = fileRecentFiles(file);
    await recent.remember({ path: '/janeiro/campanha.brief', name: 'campanha.brief' });
    await recent.remember({ path: '/fevereiro/campanha.brief', name: 'campanha.brief' });

    expect(await recent.list()).toHaveLength(2);
  });

  it(`keeps ${String(RECENT_LIMIT)} and drops the oldest`, async () => {
    const recent = fileRecentFiles(file);
    for (let index = 0; index <= RECENT_LIMIT; index += 1) {
      await recent.remember({ path: `/${String(index)}.brief`, name: `${String(index)}.brief` });
    }

    const entries = await recent.list();
    expect(entries).toHaveLength(RECENT_LIMIT);
    expect(entries[0]?.name).toBe(`${String(RECENT_LIMIT)}.brief`);
    expect(entries.map((entry) => entry.name)).not.toContain('0.brief');
  });
});

describe('reading something that is not a list', () => {
  it('answers with nothing for a file that was never written', async () => {
    await expect(fileRecentFiles(file).list()).resolves.toEqual([]);
  });

  it('answers with nothing for a file somebody hand-edited into nonsense', async () => {
    const broken = join(scratch, 'broken.json');
    writeFileSync(broken, '{ this is not json', 'utf8');

    await expect(fileRecentFiles(broken).list()).resolves.toEqual([]);
  });

  it('answers with nothing for valid JSON of the wrong shape', async () => {
    // A release that changed the shape must not make the app unopenable for everybody who
    // already had a list.
    const wrong = join(scratch, 'wrong.json');
    writeFileSync(wrong, JSON.stringify({ files: [{ nope: true }] }), 'utf8');

    await expect(fileRecentFiles(wrong).list()).resolves.toEqual([]);
  });
});

describe('what reopening is allowed to trust', () => {
  it('knows only what it wrote', async () => {
    const recent = fileRecentFiles(file);
    await recent.remember({ path: '/briefs/a.brief', name: 'a.brief' });

    await expect(recent.knows('/briefs/a.brief')).resolves.toBe(true);
    await expect(recent.knows('/etc/passwd')).resolves.toBe(false);
  });

  it('knows nothing at all when there is no list', async () => {
    await expect(fileRecentFiles(file).knows('/briefs/a.brief')).resolves.toBe(false);
  });
});
