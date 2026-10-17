import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  TAB_SIZE,
  formatBriefOnSaveExample,
  tabSizeExample,
} from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `formatBriefOnSave` and `tabSize` (TYTO-297, ADR 0096) as `settings.json` holds them. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-format-brief-settings-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

/** The commented line of an example, uncommented, as a person would. */
const uncommented = (example: string, key: string) =>
  example.replace(`// "${key}"`, `"${key}"`).replace(/,$/u, '');

describe('the formatBriefOnSave setting', () => {
  it('is off when the file says nothing, and on when it says true', async () => {
    expect(DEFAULT_SETTINGS.formatBriefOnSave).toBe(false);
    expect((await read('{}\n')).settings.formatBriefOnSave).toBe(false);
    const reading = await read('{\n  "formatBriefOnSave": true\n}\n');
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.formatBriefOnSave).toBe(true);
  });

  it('refuses anything but a boolean at the value, and stays off', async () => {
    const text = '{\n  "formatBriefOnSave": "yes"\n}\n';
    const reading = await read(text);
    const start = text.indexOf('"yes"');
    expect(reading.settings.formatBriefOnSave).toBe(false);
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + 5 }],
    ]);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = formatBriefOnSaveExample();
    expect(example).toContain('// "formatBriefOnSave": false,');
    const reading = await read(`{\n${uncommented(example, 'formatBriefOnSave')}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.formatBriefOnSave).toBe(false);
  });
});

describe('the tabSize setting', () => {
  it('is 2 when the file says nothing, and what it says from 1 to 8', async () => {
    expect(DEFAULT_SETTINGS.tabSize).toBe(2);
    expect((await read('{}\n')).settings.tabSize).toBe(2);
    for (const size of [1, 4, 8]) {
      const reading = await read(`{\n  "tabSize": ${String(size)}\n}\n`);
      expect(reading.diagnostics).toEqual([]);
      expect(reading.settings.tabSize).toBe(size);
    }
  });

  it.each(['0', '9', '2.5', '"4"', 'true'])(
    'refuses %s at the value, and stays 2',
    async (value) => {
      const text = `{\n  "tabSize": ${value}\n}\n`;
      const reading = await read(text);
      const start = text.indexOf(value, text.indexOf(':'));
      expect(reading.settings.tabSize).toBe(2);
      expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
        ['W_SETTING_INVALID', { start, end: start + value.length }],
      ]);
    },
  );

  it('is bounded where the editor clamps (MIN_TAB_SIZE and MAX_TAB_SIZE in @tyto/editor)', () => {
    expect([TAB_SIZE.minimum, TAB_SIZE.maximum]).toEqual([1, 8]);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = tabSizeExample();
    expect(example).toContain('// "tabSize": 2,');
    const reading = await read(`{\n${uncommented(example, 'tabSize')}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.tabSize).toBe(2);
  });
});
