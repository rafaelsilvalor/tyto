import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, vimModeContribution, vimModeExample } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `vimMode` (TYTO-333) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-vim-mode-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the vimMode setting', () => {
  it('is off when the file says nothing, as the window always opened before it', async () => {
    expect(DEFAULT_SETTINGS.vimMode).toBe(false);
    expect((await read('{}\n')).settings.vimMode).toBe(false);
  });

  it('is on when the file says true', async () => {
    const reading = await read('{\n  "vimMode": true\n}\n');
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.vimMode).toBe(true);
  });

  it('refuses anything but a boolean at the value, and stays off', async () => {
    const text = '{\n  "vimMode": "on"\n}\n';
    const reading = await read(text);
    const start = text.indexOf('"on"');
    expect(reading.settings.vimMode).toBe(false);
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + '"on"'.length }],
    ]);
  });

  it('is written by the command, in place, keeping the comments around it', async () => {
    writeFileSync(file, '{\n  // mine\n  "tabSize": 4\n}\n', 'utf8');
    const store = fileSettingsStore(file);
    expect((await store.write({ vimMode: true })).ok).toBe(true);
    const reading = await store.load();
    expect(reading.settings.vimMode).toBe(true);
    expect(reading.settings.tabSize).toBe(4);
    expect(readFileSync(file, 'utf8')).toContain('// mine');
    // Turned off again, the key goes back to its default, which the store writes by removing it.
    expect((await store.write({ vimMode: false })).ok).toBe(true);
    expect((await store.load()).settings.vimMode).toBe(false);
    expect(readFileSync(file, 'utf8')).not.toContain('"vimMode"');
  });

  it('says what each value does, and names the command that writes it', () => {
    expect(vimModeContribution.description).toContain('Editor: turn vim mode on or off');
    expect(vimModeContribution.options.map((option) => option.value)).toEqual([true, false]);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = vimModeExample();
    expect(example).toContain('// "vimMode": false,');
    const uncommented = example.replace('// "vimMode"', '"vimMode"').replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.vimMode).toBe(false);
  });
});
