import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BRIEF_COLUMN_LOOK_IDS, briefColumnsExample } from '../../shared/brief-columns.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `briefColumns` (TYTO-298, ADR 0097) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-brief-columns-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the briefColumns setting', () => {
  it('is the separator when the file says nothing', async () => {
    expect(DEFAULT_SETTINGS.briefColumns).toBe('separator');
    expect((await read('{}\n')).settings.briefColumns).toBe('separator');
  });

  it('takes each of the four looks', async () => {
    for (const look of BRIEF_COLUMN_LOOK_IDS) {
      const reading = await read(`{\n  "briefColumns": "${look}"\n}\n`);
      expect(reading.diagnostics).toEqual([]);
      expect(reading.settings.briefColumns).toBe(look);
    }
  });

  it('refuses another value at the value, naming the looks, and keeps the separator', async () => {
    const text = '{\n  "briefColumns": "rainbow"\n}\n';
    const reading = await read(text);
    const start = text.indexOf('"rainbow"');
    expect(reading.settings.briefColumns).toBe('separator');
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + '"rainbow"'.length }],
    ]);
    expect(reading.diagnostics[0]?.message).toMatch(/'perColumn'/u);
  });

  it('is in a new settings.json commented out with every look, and parses uncommented', async () => {
    const example = briefColumnsExample();
    expect(example).toContain('// "briefColumns": "separator",');
    for (const look of BRIEF_COLUMN_LOOK_IDS) expect(example).toContain(`//   "${look}": `);
    const uncommented = example.replace('// "briefColumns"', '"briefColumns"').replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.briefColumns).toBe('separator');
  });
});
