import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, stickyScrollExample } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `stickyScroll` (TYTO-295, ADR 0094) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-sticky-scroll-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the stickyScroll setting', () => {
  it('is on when the file says nothing, and off when it says false', async () => {
    expect(DEFAULT_SETTINGS.stickyScroll).toBe(true);
    expect((await read('{}\n')).settings.stickyScroll).toBe(true);
    const reading = await read('{\n  "stickyScroll": false\n}\n');
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.stickyScroll).toBe(false);
  });

  it('refuses anything but a boolean at the value, and stays on', async () => {
    const text = '{\n  "stickyScroll": 1\n}\n';
    const reading = await read(text);
    const start = text.indexOf('1');
    expect(reading.settings.stickyScroll).toBe(true);
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + 1 }],
    ]);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = stickyScrollExample();
    expect(example).toContain('// "stickyScroll": true,');
    const uncommented = example.replace('// "stickyScroll"', '"stickyScroll"').replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.stickyScroll).toBe(true);
  });
});
