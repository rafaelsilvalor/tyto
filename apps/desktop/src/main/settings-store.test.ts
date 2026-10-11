import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings.js';
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
      ...DEFAULT_SETTINGS,
      templatesFolder: '/home/rafael/meus-templates',
    });
  });

  it('starts on the built-in pack when there is no file yet', async () => {
    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('clears back to the built-in pack, and the clearing survives too', async () => {
    const store = fileSettingsStore(file);
    await store.write({ templatesFolder: '/somewhere' });
    await store.write({ templatesFolder: null });

    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('opens on the default when the file is not JSON at all', async () => {
    writeFileSync(file, 'this is not json', 'utf8');

    // A window that would not open because of a hand-edited preference is the one outcome
    // worse than forgetting the preference.
    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('opens on the default when the file is JSON of the wrong shape', async () => {
    writeFileSync(file, JSON.stringify({ templatesFolder: 42 }), 'utf8');

    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses an empty string, because a folder nobody named is no folder', async () => {
    writeFileSync(file, JSON.stringify({ templatesFolder: '' }), 'utf8');

    // `min(1)` on the schema. An empty path would reach `loadTemplateRegistry` as a root and
    // be reported as an unreadable folder on every launch, which is a diagnostic about a
    // choice nobody made.
    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('creates the folder it writes into, because a first run has none', async () => {
    const nested = join(scratch, 'deeper', 'settings.json');
    await fileSettingsStore(nested).write({ templatesFolder: '/x' });

    expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual({ templatesFolder: '/x' });
  });

  it('reads a file written before the queue existed without losing its folder', async () => {
    // TYTO-45 added two keys. Without their defaults in the schema, an old file would fail the
    // whole object and the templates folder a person chose would silently go back to none.
    writeFileSync(file, JSON.stringify({ templatesFolder: '/old/templates' }), 'utf8');

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/old/templates',
      queueFolder: null,
      queueAutoRun: false,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it('reads a file written before a folder could choose its file types', async () => {
    // TYTO-188's key, missing from every file written before it: defaulted, so every folder
    // keeps producing PNG alone and nothing else in the record is lost.
    writeFileSync(
      file,
      JSON.stringify({ templatesFolder: '/t', queueFolder: '/q', queueAutoRun: true }),
      'utf8',
    );

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/t',
      queueFolder: '/q',
      queueAutoRun: true,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it('keeps the templates folder when the file types were hand-broken', async () => {
    // Without `.catch` on the field, one bad value failed the whole object and the person's
    // templates folder went back to none along with it.
    writeFileSync(
      file,
      JSON.stringify({ templatesFolder: '/t', queueFolder: '/q', queueKinds: { '/q': [] } }),
      'utf8',
    );

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/t',
      queueFolder: '/q',
      queueAutoRun: false,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it('changes only the keys it is given, so two writers keep each other', async () => {
    const store = fileSettingsStore(file);
    // Not awaited one by one: the templates picker and the queue panel can write at once.
    await Promise.all([
      store.write({ templatesFolder: '/templates' }),
      store.write({ queueFolder: '/queue', queueAutoRun: true }),
    ]);

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/templates',
      queueFolder: '/queue',
      queueAutoRun: true,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it('says nothing when the disk will not take it', async () => {
    // A file where the folder should be. The person keeps the folder for this session — the
    // reload has already happened — and loses only the memory of it.
    writeFileSync(join(scratch, 'blocked'), 'not a folder', 'utf8');

    await expect(
      fileSettingsStore(join(scratch, 'blocked', 'settings.json')).write({
        templatesFolder: '/x',
      }),
    ).resolves.toEqual(ok(undefined));
  });
});

/**
 * The file a person edits by hand (TYTO-206, ADR 0073): JSON with comments, tolerant one key
 * at a time, edited in place, and never written while it does not parse.
 */
describe('a settings file somebody edits by hand', () => {
  const rangeOf = (text: string, fragment: string) => {
    const start = text.indexOf(fragment);
    return { start, end: start + fragment.length };
  };

  it('keeps every good key when one value is bad, and points at that value', async () => {
    const text = [
      '{',
      '  // my own templates',
      '  "templatesFolder": "/t",',
      '  "queueAutoRun": "yes",',
      '  "queueFolder": "/q"',
      '}',
    ].join('\n');
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings).toEqual({
      ...DEFAULT_SETTINGS,
      templatesFolder: '/t',
      queueFolder: '/q',
    });
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', rangeOf(text, '"yes"')],
    ]);
  });

  it('names an unknown key at the key, and still applies the rest', async () => {
    const text = '{ "queueAutoRn": true, "queueAutoRun": true }';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.queueAutoRun).toBe(true);
    expect(reading.diagnostics.map((item) => [item.code, item.range, item.message])).toEqual([
      ['W_SETTING_UNKNOWN', rangeOf(text, '"queueAutoRn"'), "Unknown setting 'queueAutoRn'."],
    ]);
  });

  it('keeps a comment the person wrote when a screen changes a key', async () => {
    const text = '{\n  // the queue I share with Ana\n  "queueFolder": "/q",\n}\n';
    writeFileSync(file, text, 'utf8');

    expect(await fileSettingsStore(file).write({ templatesFolder: '/t' })).toEqual(ok(undefined));

    const after = readFileSync(file, 'utf8');
    expect(after).toContain('// the queue I share with Ana');
    expect(after.startsWith('{\n  // the queue I share with Ana\n  "queueFolder": "/q",')).toBe(
      true,
    );
    expect(await fileSettingsStore(file).read()).toEqual({
      ...DEFAULT_SETTINGS,
      templatesFolder: '/t',
      queueFolder: '/q',
    });
  });

  it('writes only what differs from the default, and removes a key set back to it', async () => {
    const store = fileSettingsStore(file);
    await store.write({ queueAutoRun: true, queueFolder: null });

    expect(readFileSync(file, 'utf8')).toBe('{\n  "queueAutoRun": true\n}');

    await store.write({ queueAutoRun: false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({});
  });

  it('never writes over a file that does not parse, and says why', async () => {
    const text = '{\n  "templatesFolder": "/t"\n  "queueAutoRun": tru';
    writeFileSync(file, text, 'utf8');

    const written = await fileSettingsStore(file).write({ queueFolder: '/q' });

    expect(written.ok).toBe(false);
    expect(written.ok ? [] : written.error.map((item) => item.code)).toContain('E_SETTINGS_SYNTAX');
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('still opens on a file that does not parse, with what could be read', async () => {
    writeFileSync(file, '{ "templatesFolder": "/t" "queueAutoRun": true', 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.templatesFolder).toBe('/t');
    expect(reading.diagnostics.some((item) => item.code === 'E_SETTINGS_SYNTAX')).toBe(true);
  });
});
