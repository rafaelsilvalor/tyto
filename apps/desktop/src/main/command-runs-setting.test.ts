import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commandRunsExample } from '../../shared/command-runs.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `commandsOrder` and `commandsFoldOlderRuns` (TYTO-496) as `settings.json` holds them. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-command-runs-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the command panel’s two settings', () => {
  it('are newest last and not folded when the file says nothing, and take the other values', async () => {
    expect(DEFAULT_SETTINGS.commandsOrder).toBe('newestLast');
    expect(DEFAULT_SETTINGS.commandsFoldOlderRuns).toBe(false);
    const reading = await read(
      '{\n  "commandsOrder": "newestFirst",\n  "commandsFoldOlderRuns": true\n}\n',
    );
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.commandsOrder).toBe('newestFirst');
    expect(reading.settings.commandsFoldOlderRuns).toBe(true);
  });

  it('refuses an order it does not know, names the two, and keeps the default', async () => {
    const text = '{\n  "commandsOrder": "sideways",\n  "commandsFoldOlderRuns": "yes"\n}\n';
    const reading = await read(text);
    expect(reading.settings.commandsOrder).toBe('newestLast');
    expect(reading.settings.commandsFoldOlderRuns).toBe(false);
    expect(reading.diagnostics.map((item) => item.code)).toEqual([
      'W_SETTING_INVALID',
      'W_SETTING_INVALID',
    ]);
    expect(reading.diagnostics[0]?.message).toMatch(/'newestLast', 'newestFirst'/u);
  });

  it('are in a new settings.json commented out, and parse with nothing to say uncommented', async () => {
    const example = commandRunsExample();
    expect(example).toContain('// "commandsOrder": "newestLast",');
    const uncommented = example
      .replace('// "commandsOrder"', '"commandsOrder"')
      .replace('// "commandsFoldOlderRuns"', '"commandsFoldOlderRuns"')
      .replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.commandsOrder).toBe('newestLast');
  });
});
