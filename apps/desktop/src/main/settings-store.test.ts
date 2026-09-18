import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileSettingsStore } from './settings-store.js';

/**
 * The template folder surviving a restart, which is the card's third criterion (TYTO-122).
 *
 * Against a real file, because the claim is that something written now is there later and a
 * fake would be asserting the fake. The two failure modes worth pinning are the ones
 * `layout-store.ts` already lives by: a first run with no file, and a file somebody edited
 * into nonsense. Neither may stop a window opening.
 */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('fileSettingsStore', () => {
  it('remembers the folder across a restart', async () => {
    await fileSettingsStore(file).write({ templatesFolder: '/home/rafael/meus-templates' });

    // A second store over the same path, which is what the next launch builds.
    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/home/rafael/meus-templates',
    });
  });

  it('starts on the built-in pack when there is no file yet', async () => {
    expect(await fileSettingsStore(file).read()).toEqual({ templatesFolder: null });
  });

  it('clears back to the built-in pack, and the clearing survives too', async () => {
    const store = fileSettingsStore(file);
    await store.write({ templatesFolder: '/somewhere' });
    await store.write({ templatesFolder: null });

    expect(await fileSettingsStore(file).read()).toEqual({ templatesFolder: null });
  });

  it('opens on the default when the file is not JSON at all', async () => {
    writeFileSync(file, 'this is not json', 'utf8');

    // A window that would not open because of a hand-edited preference is the one outcome
    // worse than forgetting the preference.
    expect(await fileSettingsStore(file).read()).toEqual({ templatesFolder: null });
  });

  it('opens on the default when the file is JSON of the wrong shape', async () => {
    writeFileSync(file, JSON.stringify({ templatesFolder: 42 }), 'utf8');

    expect(await fileSettingsStore(file).read()).toEqual({ templatesFolder: null });
  });

  it('refuses an empty string, because a folder nobody named is no folder', async () => {
    writeFileSync(file, JSON.stringify({ templatesFolder: '' }), 'utf8');

    // `min(1)` on the schema. An empty path would reach `loadTemplateRegistry` as a root and
    // be reported as an unreadable folder on every launch, which is a diagnostic about a
    // choice nobody made.
    expect(await fileSettingsStore(file).read()).toEqual({ templatesFolder: null });
  });

  it('creates the folder it writes into, because a first run has none', async () => {
    const nested = join(scratch, 'deeper', 'settings.json');
    await fileSettingsStore(nested).write({ templatesFolder: '/x' });

    expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual({ templatesFolder: '/x' });
  });

  it('says nothing when the disk will not take it', async () => {
    // A file where the folder should be. The person keeps the folder for this session — the
    // reload has already happened — and loses only the memory of it.
    writeFileSync(join(scratch, 'blocked'), 'not a folder', 'utf8');

    await expect(
      fileSettingsStore(join(scratch, 'blocked', 'settings.json')).write({
        templatesFolder: '/x',
      }),
    ).resolves.toBeUndefined();
  });
});
