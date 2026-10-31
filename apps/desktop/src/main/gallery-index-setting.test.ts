import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_GALLERY_INDEX } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { fileSettingsStore } from './settings-store.js';

/** `galleryIndex` (TYTO-506, ADR 0162) as `settings.json` holds it. */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-gallery-index-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the galleryIndex setting', () => {
  it('is the index the CLI falls back to when the file says nothing', async () => {
    expect(DEFAULT_SETTINGS.galleryIndex).toBe(DEFAULT_GALLERY_INDEX);
    expect((await read('{}\n')).settings.galleryIndex).toBe(DEFAULT_GALLERY_INDEX);
  });

  it('takes any location git reads', async () => {
    const reading = await read('{\n  "galleryIndex": "file:///C:/lists/index"\n}\n');
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.galleryIndex).toBe('file:///C:/lists/index');
  });

  it('refuses a blank location at the value, and keeps the default', async () => {
    const text = '{\n  "galleryIndex": " "\n}\n';
    const reading = await read(text);
    const start = text.indexOf('" "');
    expect(reading.settings.galleryIndex).toBe(DEFAULT_GALLERY_INDEX);
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + 3 }],
    ]);
  });
});
