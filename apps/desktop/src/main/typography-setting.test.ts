import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import {
  FONT_AREAS,
  ZOOM,
  steppedZoom,
  typographyExample,
  typographySchema,
  zoomFactor,
} from '../../shared/typography.js';
import { fileSettingsStore } from './settings-store.js';

/** `zoom`, the two faces and sizes, and `fontSizes`/`fontFamilies` over them (TYTO-272). */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-typography-setting-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const read = async (text: string) => {
  writeFileSync(file, text, 'utf8');
  return fileSettingsStore(file).load();
};

describe('the typography settings', () => {
  it('are the window as it was when the file says nothing', async () => {
    const { settings } = await read('{}\n');
    expect({
      zoom: settings.zoom,
      uiFontFamily: settings.uiFontFamily,
      uiFontSize: settings.uiFontSize,
      codeFontFamily: settings.codeFontFamily,
      codeFontSize: settings.codeFontSize,
    }).toEqual({
      zoom: 0,
      uiFontFamily: 'Source Sans 3',
      uiFontSize: 14,
      codeFontFamily: 'IBM Plex Mono',
      codeFontSize: 14,
    });
    expect(DEFAULT_SETTINGS.zoom).toBe(0);
  });

  it('take a face, a size and a zoom inside their bounds', async () => {
    const reading = await read(
      '{\n  "zoom": -5,\n  "uiFontFamily": "Segoe UI",\n  "uiFontSize": 24,\n' +
        '  "codeFontFamily": "Cascadia Code",\n  "codeFontSize": 9\n}\n',
    );
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings).toMatchObject({
      zoom: -5,
      uiFontFamily: 'Segoe UI',
      uiFontSize: 24,
      codeFontFamily: 'Cascadia Code',
      codeFontSize: 9,
    });
  });

  it('refuse each value outside its bounds at the value, keeping the default', async () => {
    const text =
      '{\n  "zoom": 6,\n  "uiFontSize": 8,\n  "codeFontSize": 33,\n' +
      '  "codeFontFamily": "Mono\\"; } body { color: red"\n}\n';
    const reading = await read(text);
    const at = (needle: string) => {
      const start = text.indexOf(needle);
      return { start, end: start + needle.length };
    };
    const invalid = reading.diagnostics.filter((item) => item.code === 'W_SETTING_INVALID');
    // In the order the settings are declared, not the order the file writes them.
    expect(invalid.map((item) => item.range)).toEqual([
      at('6'),
      at('8'),
      at('"Mono\\"; } body { color: red"'),
      at('33'),
    ]);
    expect(invalid[0]?.message).toMatch(/-5 to 5/u);
    expect(invalid[2]?.message).toMatch(/not a family name/u);
    expect(reading.settings).toMatchObject({
      zoom: 0,
      uiFontSize: 14,
      codeFontSize: 14,
      codeFontFamily: 'IBM Plex Mono',
    });
  });

  it('refuse a size or a zoom that is not whole', async () => {
    const reading = await read('{\n  "zoom": 0.5,\n  "codeFontSize": 13.5\n}\n');
    expect(reading.diagnostics.map((item) => item.code)).toEqual([
      'W_SETTING_INVALID',
      'W_SETTING_INVALID',
    ]);
  });

  it('are in a new settings.json commented out, and parse uncommented', async () => {
    const example = typographyExample();
    for (const key of [
      'zoom',
      'uiFontFamily',
      'uiFontSize',
      'codeFontFamily',
      'codeFontSize',
      'fontSizes',
      'fontFamilies',
    ]) {
      expect(example).toContain(`// "${key}": `);
    }
    // Every area is listed under both objects, so the file shows every key a person may write.
    for (const area of FONT_AREAS) {
      expect(example.split(`//   "${area.id}": `)).toHaveLength(3);
    }
    const uncommented = example
      .split('\n')
      .filter((line) => /^\/\/ +["}]/u.test(line.trim()))
      .map((line) => line.replace('// ', ''))
      .join('\n')
      .replace(/,$/u, '');
    const reading = await read(`{\n${uncommented}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.uiFontFamily).toBe('Source Sans 3');
    expect(reading.settings.fontSizes.titleBar).toBe(14);
    expect(reading.settings.fontFamilies.editor).toBe('IBM Plex Mono');
  });
});

describe('the areas over the bases (TYTO-272 PR B)', () => {
  it('reads a size and a face per area, and leaves the unset ones to their base', async () => {
    const reading = await read(
      '{\n  "fontSizes": { "tabs": 18, "statusBar": 16, "editor": 20 },\n' +
        '  "fontFamilies": { "problems": "Segoe UI" }\n}\n',
    );
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.fontSizes).toEqual({ tabs: 18, statusBar: 16, editor: 20 });
    expect(reading.settings.fontFamilies).toEqual({ problems: 'Segoe UI' });
  });

  it('says an unknown area at its name and a size out of that area’s bounds at the value', async () => {
    const reading = await read(
      '{\n  "fontSizes": { "sidebar": 16, "titleBar": 19, "tabs": 25, "editor": 30, "queue": 16 }\n}\n',
    );
    // The title bar stops at 18 and a UI area at 24, where a code area goes on to 32.
    expect(reading.settings.fontSizes).toEqual({ editor: 30, queue: 16 });
    expect(reading.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'W_SETTING_ENTRY_INVALID',
        expect.stringMatching(/^Entry 'sidebar' of setting 'fontSizes' .*not an area/u),
      ],
      ['W_SETTING_INVALID', expect.stringMatching(/^Setting 'fontSizes\.titleBar' .*over 18/u)],
      ['W_SETTING_INVALID', expect.stringMatching(/^Setting 'fontSizes\.tabs' .*over 24/u)],
    ]);
    expect(reading.diagnostics.every((item) => item.range !== undefined)).toBe(true);
  });

  it('refuses a face that could close the CSS string, at that area alone', async () => {
    const reading = await read(
      '{\n  "fontFamilies": { "tabs": "a;b", "statusBar": "Segoe UI" }\n}\n',
    );
    expect(reading.settings.fontFamilies).toEqual({ statusBar: 'Segoe UI' });
    expect(reading.diagnostics.map((item) => item.code)).toEqual(['W_SETTING_INVALID']);
  });

  it('declares every area once, each over one of the two bases', () => {
    const ids = FONT_AREAS.map((area) => area.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FONT_AREAS.filter((area) => area.base === 'code').map((area) => area.id)).toEqual([
      'editor',
      'json',
      'completion',
    ]);
    expect(FONT_AREAS.find((area) => area.id === 'titleBar')?.maximum).toBe(18);
  });
});

describe('the zoom', () => {
  it('steps by one inside -5 to 5, and resets to 0', () => {
    expect(steppedZoom(0, 'in')).toBe(1);
    expect(steppedZoom(0, 'out')).toBe(-1);
    expect(steppedZoom(ZOOM.maximum, 'in')).toBe(5);
    expect(steppedZoom(ZOOM.minimum, 'out')).toBe(-5);
    expect(steppedZoom(3, 'reset')).toBe(0);
  });

  it("is Electron's factor of 1.2 per step", () => {
    expect(zoomFactor(0)).toBe(1);
    expect(zoomFactor(1)).toBeCloseTo(1.2, 10);
    expect(zoomFactor(-1)).toBeCloseTo(1 / 1.2, 10);
  });
});

describe('typography on the bridge', () => {
  it('refuses a family that could close the CSS string it lands in', () => {
    const good = {
      uiFontFamily: 'Segoe UI',
      uiFontSize: 14,
      codeFontFamily: 'Cascadia Code',
      codeFontSize: 14,
      fontSizes: { tabs: 18 },
      fontFamilies: { tabs: 'Segoe UI' },
    };
    expect(typographySchema.safeParse(good).success).toBe(true);
    // And an area's size outside that area's bounds, which main never sends.
    expect(typographySchema.safeParse({ ...good, fontSizes: { titleBar: 19 } }).success).toBe(
      false,
    );
    expect(typographySchema.safeParse({ ...good, fontFamilies: { tabs: 'a"b' } }).success).toBe(
      false,
    );
    for (const family of ['a"b', "a'b", 'a;b', 'a}b', 'a\\b', 'a<b', 'a\nb', '']) {
      expect(typographySchema.safeParse({ ...good, codeFontFamily: family }).success, family).toBe(
        false,
      );
    }
  });
});
