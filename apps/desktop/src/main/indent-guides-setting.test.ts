import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, indentGuidesExample } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `indentGuides` (TYTO-293, ADR 0088) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-indent-guides-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the indentGuides setting', () => {
  it('is on when the file says nothing', async () => {
    expect(DEFAULT_SETTINGS.indentGuides).toBe(true);
    expect((await read('{}\n')).settings.indentGuides).toBe(true);
  });

  it('is off when the file says false', async () => {
    const reading = await read('{\n  "indentGuides": false\n}\n');
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.indentGuides).toBe(false);
  });

  it('refuses anything but a boolean at the value, and stays on', async () => {
    const text = '{\n  "indentGuides": "no"\n}\n';
    const reading = await read(text);
    const start = text.indexOf('"no"');
    expect(reading.settings.indentGuides).toBe(true);
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + '"no"'.length }],
    ]);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = indentGuidesExample();
    expect(example).toContain('// "indentGuides": true,');
    expect(example).toMatch(/true \(the default\) or false/u);
    const uncommented = example.replace('// "indentGuides"', '"indentGuides"').replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.indentGuides).toBe(true);
  });
});
