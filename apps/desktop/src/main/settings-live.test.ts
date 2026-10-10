import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IpcEventPayload } from '../../shared/ipc.js';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings.js';
import { type LiveSettings, createLiveSettings } from './settings-live.js';
import { BUILT_IN_SETTINGS, fileSettingsStore } from './settings-store.js';

/**
 * The three writers of `settings.json` (TYTO-206, ADR 0073 decision 8), against a real file:
 * the claim is about what is on disk after each of them, and a fake disk would assert itself.
 * The watcher is the test calling `changed()`, which is what the composition root's does.
 */

let scratch: string;
let file: string;
let applied: { next: Settings; keys: readonly (keyof Settings)[] }[];
let sent: IpcEventPayload<'settings:changed'>[];
let logged: string[];

const live = (initial: Settings = DEFAULT_SETTINGS): LiveSettings => {
  const late: { live?: LiveSettings } = {};
  const store = fileSettingsStore(
    file,
    () => BUILT_IN_SETTINGS,
    (text) => late.live?.wrote(text),
  );
  const created = createLiveSettings({
    store,
    declared: () => BUILT_IN_SETTINGS,
    initial,
    readText: () => readFile(file, 'utf8').catch(() => ''),
    apply: (next, keys) => {
      applied.push({ next, keys });
      return Promise.resolve();
    },
    configure: () => undefined,
    send: (payload) => sent.push(payload),
    log: {
      info: (message) => logged.push(message),
      warn: (message) => logged.push(message),
    },
  });
  late.live = created;
  return created;
};

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-live-settings-'));
  file = join(scratch, 'settings.json');
  applied = [];
  sent = [];
  logged = [];
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('live settings', () => {
  it('applies a save made outside the app, and only the keys that moved', async () => {
    const settings = live();
    writeFileSync(file, '{\n  // by hand\n  "queueAutoRun": true\n}\n', 'utf8');

    await settings.changed();

    expect(applied.map((entry) => entry.keys)).toEqual([['queueAutoRun']]);
    expect(applied[0]?.next.queueAutoRun).toBe(true);
    expect(sent).toEqual([{ saved: false, refused: false }]);
  });

  it("does not take the app's own write for a change", async () => {
    const settings = live();

    expect(await settings.remember({ queueAutoRun: true })).toBe(true);
    await settings.changed();

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ queueAutoRun: true });
    expect(applied).toEqual([]);
    expect(logged.filter((line) => line.includes('changed on disk'))).toEqual([]);
  });

  it('applies the same text again when somebody else wrote it in between', async () => {
    const settings = live();
    await settings.remember({ queueAutoRun: true });
    writeFileSync(file, '{}', 'utf8');
    await settings.changed();
    writeFileSync(file, '{\n  "queueAutoRun": true\n}\n', 'utf8');
    await settings.changed();

    expect(applied.map((entry) => entry.next.queueAutoRun)).toEqual([false, true]);
  });

  it('puts a screen change into a tab with unsaved typing, and leaves the disk alone', async () => {
    const onDisk = '{\n  "queueAutoRun": false\n}\n';
    writeFileSync(file, onDisk, 'utf8');
    const settings = live();
    const typing = '{\n  // typing\n  "queueAutoRun": false\n}\n';
    settings.validate('document-2', typing, true);

    expect(await settings.remember({ queueFolder: '/fila' })).toBe(true);

    expect(readFileSync(file, 'utf8')).toBe(onDisk);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.saved).toBe(false);
    expect(sent[0]?.text).toContain('// typing');
    expect(sent[0]?.text).toContain('"queueFolder": "/fila"');
  });

  it('refuses a screen change to a file that does not parse, says so and goes back', async () => {
    const broken = '{ "queueAutoRun": true "queueFolder": null';
    writeFileSync(file, broken, 'utf8');
    const settings = live({ ...DEFAULT_SETTINGS, queueAutoRun: true });

    expect(await settings.remember({ queueAutoRun: false })).toBe(false);

    expect(readFileSync(file, 'utf8')).toBe(broken);
    expect(applied).toEqual([
      { next: { ...DEFAULT_SETTINGS, queueAutoRun: true }, keys: ['queueAutoRun'] },
    ]);
    expect(sent).toEqual([{ saved: false, refused: true }]);
  });

  it('keeps a clean tab in step with the disk', async () => {
    writeFileSync(file, '{}', 'utf8');
    const settings = live();
    settings.validate('document-2', '{}', false);

    await settings.remember({ queueAutoRun: true });
    writeFileSync(file, '{ "queueKinds": { "/fila": ["svg"] } }', 'utf8');
    await settings.changed();

    expect(sent.map((payload) => payload.text)).toEqual([
      expect.stringContaining('"queueAutoRun": true'),
      '{ "queueKinds": { "/fila": ["svg"] } }',
    ]);
    expect(sent.every((payload) => payload.saved)).toBe(true);
  });

  it("finds a buffer's problems the way the store finds the file's", () => {
    const settings = live();
    const diagnostics = settings.validate('document-2', '{ "queueAutRun": true }', false);
    expect(diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_UNKNOWN', { start: 2, end: 15 }],
    ]);
  });
});
