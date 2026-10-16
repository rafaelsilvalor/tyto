import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import {
  VIM_COLOUR_MODES,
  contrastRatio,
  statusBarColorsContrast,
} from '../../shared/status-bar-colors.js';
import { VIM_MODE_STYLES, vimBarText, vimModeStyleExample } from '../../shared/vim-mode-style.js';
import { colourDifference } from './colour-difference.js';
import { BASE_COLORS, BUILT_IN_THEMES } from './themes.js';
import { BUILT_IN_SETTINGS, fileSettingsStore, validateSettingsText } from './settings-store.js';

/**
 * `vimModeStyle` (TYTO-301, ADR 0091): the setting as the file holds it, and the text the
 * `bar` style writes on the whole bar, measured in every theme Tyto ships.
 */

/** Tyto Light and Tyto Dark, and the twenty of `@tyto/theme-pack`: the 22 a person can pick. */
const THEMES: readonly {
  readonly id: string;
  readonly colors: Readonly<Record<string, string>>;
}[] = [
  { id: BUILT_IN_THEMES.light.id, colors: BASE_COLORS.light },
  { id: BUILT_IN_THEMES.dark.id, colors: BASE_COLORS.dark },
  ...THEME_PACK_THEMES.map((theme) => {
    const file = THEME_PACK_FILES[theme.path];
    if (file === undefined) throw new Error(`${theme.id} names '${theme.path}', not there`);
    return { id: theme.id, colors: file.colors };
  }),
];

/** The bar's text on the bar, for each theme and mode, as the `bar` style draws it. */
const pairs = THEMES.flatMap((theme) => {
  const text = vimBarText(theme.colors);
  return VIM_COLOUR_MODES.map((mode) => {
    const background = theme.colors[`status-bar-vim-${mode}`] ?? '';
    const foreground = text[mode] ?? '';
    return {
      theme: theme.id,
      mode,
      background,
      foreground,
      ratio: contrastRatio(foreground, background) ?? 0,
    };
  });
});
const lowest = pairs.reduce((low, pair) => (pair.ratio < low.ratio ? pair : low));

describe('the bar style’s text, in every theme Tyto ships', () => {
  it('measures 22 themes in 4 modes', () => {
    expect(THEMES).toHaveLength(22);
    expect(pairs).toHaveLength(88);
  });

  it(`reads 4.5:1 or better on all 88 (lowest: ${lowest.ratio.toFixed(2)}:1, ${lowest.theme} ${lowest.mode})`, () => {
    // The number goes to the log even when green, which the default reporter would hide.
    process.stdout.write(
      `vimModeStyle bar: lowest ${lowest.ratio.toFixed(3)}:1 of ${String(pairs.length)} ` +
        `(${lowest.theme} ${lowest.mode}, ${lowest.foreground} on ${lowest.background})\n`,
    );
    expect(pairs.filter((pair) => pair.ratio < 4.5)).toEqual([]);
  });

  it("is never the bar's own text, which was not chosen for the mode's colour", () => {
    // Tyto Light's #58585a reads 2.06:1 on its blue NORMAL; the derived text is white.
    const light = vimBarText(BASE_COLORS.light);
    expect(light.normal).toBe('#ffffff');
    expect(
      contrastRatio(
        BASE_COLORS.light['status-bar-text']!,
        BASE_COLORS.light['status-bar-vim-normal']!,
      ),
    ).toBeLessThan(4.5);
  });

  it('follows an override of the mode’s colour, as the badge’s text does', () => {
    // A pale yellow INSERT: Tyto Dark's dark candidate reads best on it.
    const text = vimBarText(BASE_COLORS.dark, { 'vimMode.insert': '#ffe066' });
    expect(text.insert).toBe(BASE_COLORS.dark['accent-text']);
    expect(text.normal).toBe(vimBarText(BASE_COLORS.dark).normal);
  });

  // On a coloured bar a hovered button keeps the theme's `hover` and a toggle that is on takes
  // `surface`, each with the theme's `text` (ADR 0091): opaque chrome pairs the theme's own
  // floors hold readable — `button-on` is a translucent grey, which on a mode's colour would
  // leave `text` on a tinted mode colour — told apart from the bar by how far the colours are.
  const chrome = THEMES.flatMap((theme) =>
    (['hover', 'surface'] as const).flatMap((token) =>
      VIM_COLOUR_MODES.map((mode) => ({
        theme: theme.id,
        token,
        mode,
        difference: colourDifference(
          theme.colors[token] ?? '',
          theme.colors[`status-bar-vim-${mode}`] ?? '',
        ),
      })),
    ),
  );
  const closest = chrome.reduce((low, item) => (item.difference < low.difference ? item : low));
  it(`keeps a hovered or pressed button apart from the bar (closest: ΔE ${closest.difference.toFixed(1)}, ${closest.theme} ${closest.token} on ${closest.mode})`, () => {
    process.stdout.write(
      `vimModeStyle bar: hover/on closest ΔE2000 ${closest.difference.toFixed(2)} of ` +
        `${String(chrome.length)} (${closest.theme} ${closest.token} on ${closest.mode})\n`,
    );
    expect(closest.difference).toBeGreaterThanOrEqual(10);
  });
});

describe('the vimModeStyle setting in the file', () => {
  let folder: string;
  let file: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'tyto-vim-mode-style-'));
    file = join(folder, 'settings.json');
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('is the badge, today’s look, when the file does not name it', async () => {
    expect(DEFAULT_SETTINGS.vimModeStyle).toBe('badge');
    expect((await fileSettingsStore(file).read()).vimModeStyle).toBe('badge');
  });

  it.each(['border', 'bar'] as const)('reads %s', async (style) => {
    writeFileSync(file, `{ "vimModeStyle": "${style}" }`, 'utf8');
    expect((await fileSettingsStore(file).read()).vimModeStyle).toBe(style);
  });

  it('refuses a style it does not know at the value, naming the three, and draws the badge', async () => {
    const text = '{ "vimModeStyle": "stripe" }';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.vimModeStyle).toBe('badge');
    const start = text.indexOf('"stripe"');
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start, end: start + '"stripe"'.length }],
    ]);
    expect(reading.diagnostics[0]?.message).toBe(
      "Setting 'vimModeStyle' is not accepted (the styles are 'badge', 'border', 'bar'); " +
        'its default applies.',
    );
  });

  it('describes each of the three values in its declaration', () => {
    const declared = BUILT_IN_SETTINGS.find((setting) => setting.key === 'vimModeStyle');
    for (const style of VIM_MODE_STYLES) {
      expect(declared?.contribution.description).toContain(`'${style.id}' (${style.description})`);
    }
  });

  it('is in a new settings.json commented out, with the three values and what each does', async () => {
    const example = vimModeStyleExample();
    for (const style of VIM_MODE_STYLES) {
      expect(example).toMatch(
        new RegExp(`// +"${style.id}" +${style.description.replace(/[.()]/g, '\\$&')}`, 'u'),
      );
    }
    // Uncommenting the key gives a file that parses with nothing to say.
    const uncommented = example.replace('// "vimModeStyle"', '"vimModeStyle"').replace(/,$/u, '');
    writeFileSync(file, `{\n${uncommented}\n}\n`, 'utf8');
    const reading = await fileSettingsStore(file).load();
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.vimModeStyle).toBe('badge');
  });
});

/** Which styles a vim colour the theme's text does not read on is warned about (ADR 0091). */
describe('the contrast warning under each style', () => {
  const light = { id: 'tyto-light', colors: BASE_COLORS.light };
  // Mid grey: white reads 3.94:1 on it, the best of Tyto Light's three candidates.
  const check = (style: string | undefined) => {
    const text = `{ ${style === undefined ? '' : `"vimModeStyle": "${style}", `}"statusBarColors": { "vimMode.insert": "#808080" } }`;
    return validateSettingsText(text, BUILT_IN_SETTINGS, (entries) =>
      statusBarColorsContrast(entries, [light]),
    ).map((item) => item.code);
  };

  it('warns under the badge and the bar, where text sits on the colour', () => {
    expect(check(undefined)).toEqual(['W_SETTING_LOW_CONTRAST']);
    expect(check('badge')).toEqual(['W_SETTING_LOW_CONTRAST']);
    expect(check('bar')).toEqual(['W_SETTING_LOW_CONTRAST']);
  });

  it('says nothing under the border, where only a strip wears it', () => {
    expect(check('border')).toEqual([]);
  });
});
