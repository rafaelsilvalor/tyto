import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { vimPluginIsOn, vimPluginsExample } from '../../shared/vim-plugins.js';
import { fileSettingsStore } from './settings-store.js';

/** `vimPlugins` (TYTO-418, ADR 0143) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-vim-plugins-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the vimPlugins setting', () => {
  it('names nothing when the file says nothing, and every plugin is then on', async () => {
    expect(DEFAULT_SETTINGS.vimPlugins).toEqual({});
    const reading = await read('{}\n');
    expect(reading.settings.vimPlugins).toEqual({});
    expect(vimPluginIsOn(reading.settings.vimPlugins, 'commentary')).toBe(true);
    expect(vimPluginIsOn(reading.settings.vimPlugins, 'an-installed-one')).toBe(true);
  });

  it('takes any plugin id, an installed plugin’s included, switched with a boolean', async () => {
    const reading = await read(
      '{\n  "vimPlugins": { "commentary": false, "an-installed-one": true }\n}\n',
    );
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.vimPlugins).toEqual({ commentary: false, 'an-installed-one': true });
    expect(vimPluginIsOn(reading.settings.vimPlugins, 'commentary')).toBe(false);
  });

  it('refuses a switch that is not a boolean at its value, and keeps the others', async () => {
    const text = '{\n  "vimPlugins": { "commentary": "off", "surround": false }\n}\n';
    const reading = await read(text);
    const start = text.indexOf('"off"');
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + '"off"'.length }],
    ]);
    expect(reading.settings.vimPlugins).toEqual({ surround: false });
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = vimPluginsExample();
    expect(example).toContain('// "vimPlugins": {');
    expect(example).toContain('//   "commentary": true');
    const uncommented = example
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('// Switch'))
      .map((line) => line.replace('// ', ''))
      .join('\n')
      .replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.vimPlugins).toEqual({ surround: true, commentary: true });
  });
});
