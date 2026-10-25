import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lineNumbersExample } from '../../shared/line-numbers.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `lineNumbers` (TYTO-415) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-line-numbers-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the lineNumbers setting', () => {
  it('is on when the file says nothing, and takes relative and off', async () => {
    expect(DEFAULT_SETTINGS.lineNumbers).toBe('on');
    expect((await read('{}\n')).settings.lineNumbers).toBe('on');
    for (const look of ['relative', 'off'] as const) {
      const reading = await read(`{\n  "lineNumbers": "${look}"\n}\n`);
      expect(reading.diagnostics).toEqual([]);
      expect(reading.settings.lineNumbers).toBe(look);
    }
  });

  it('refuses a look it does not know, names the three, and stays on', async () => {
    const text = '{\n  "lineNumbers": "interval"\n}\n';
    const reading = await read(text);
    const start = text.indexOf('"interval"');
    expect(reading.settings.lineNumbers).toBe('on');
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + '"interval"'.length }],
    ]);
    expect(reading.diagnostics[0]?.message).toMatch(/'on', 'relative', 'off'/u);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = lineNumbersExample();
    expect(example).toContain('// "lineNumbers": "on",');
    const uncommented = example.replace('// "lineNumbers"', '"lineNumbers"').replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.lineNumbers).toBe('on');
  });
});
