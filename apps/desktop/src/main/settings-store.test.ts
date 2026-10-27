import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import { declaredSetting } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import {
  STATUS_BAR_ITEMS,
  STATUS_BAR_ITEM_IDS,
  statusBarItemsExample,
} from '../../shared/status-bar-items.js';
import {
  STATUS_BAR_COLOUR_KEYS,
  statusBarColorsContrast,
  statusBarColorsExample,
} from '../../shared/status-bar-colors.js';
import { BUILT_IN_SETTINGS, fileSettingsStore, validateSettingsText } from './settings-store.js';

/**
 * The template folder surviving a restart, which is the card's third criterion (TYTO-122).
 *
 * Against a real file, because the claim is that something written now is there later and a
 * fake would be asserting the fake. The two failure modes worth pinning are the ones
 * `layout-store.ts` already lives by: a first run with no file, and a file somebody edited
 * into nonsense. Neither may stop a window opening.
 */

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-'));
  file = join(scratch, 'settings.json');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('fileSettingsStore', () => {
  it('remembers the folder across a restart', async () => {
    await fileSettingsStore(file).write({ templatesFolder: '/home/rafael/meus-templates' });

    // A second store over the same path, which is what the next launch builds.
    expect(await fileSettingsStore(file).read()).toEqual({
      ...DEFAULT_SETTINGS,
      templatesFolder: '/home/rafael/meus-templates',
    });
  });

  it('starts on the built-in pack when there is no file yet', async () => {
    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('clears back to the built-in pack, and the clearing survives too', async () => {
    const store = fileSettingsStore(file);
    await store.write({ templatesFolder: '/somewhere' });
    await store.write({ templatesFolder: null });

    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('opens on the default when the file is not JSON at all', async () => {
    writeFileSync(file, 'this is not json', 'utf8');

    // A window that would not open because of a hand-edited preference is the one outcome
    // worse than forgetting the preference.
    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('opens on the default when the file is JSON of the wrong shape', async () => {
    writeFileSync(file, JSON.stringify({ templatesFolder: 42 }), 'utf8');

    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses an empty string, because a folder nobody named is no folder', async () => {
    writeFileSync(file, JSON.stringify({ templatesFolder: '' }), 'utf8');

    // `min(1)` on the schema. An empty path would reach `loadTemplateRegistry` as a root and
    // be reported as an unreadable folder on every launch, which is a diagnostic about a
    // choice nobody made.
    expect(await fileSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('creates the folder it writes into, because a first run has none', async () => {
    const nested = join(scratch, 'deeper', 'settings.json');
    await fileSettingsStore(nested).write({ templatesFolder: '/x' });

    expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual({ templatesFolder: '/x' });
  });

  it('reads a file written before the queue existed without losing its folder', async () => {
    // TYTO-45 added two keys. Without their defaults in the schema, an old file would fail the
    // whole object and the templates folder a person chose would silently go back to none.
    writeFileSync(file, JSON.stringify({ templatesFolder: '/old/templates' }), 'utf8');

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/old/templates',
      queueFolder: null,
      queueAutoRun: false,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
      iconStrokeWidth: DEFAULT_SETTINGS.iconStrokeWidth,
      statusBarItems: DEFAULT_SETTINGS.statusBarItems,
      statusBarColors: DEFAULT_SETTINGS.statusBarColors,
      vimMode: DEFAULT_SETTINGS.vimMode,
      vimPlugins: DEFAULT_SETTINGS.vimPlugins,
      vimModeStyle: DEFAULT_SETTINGS.vimModeStyle,
      indentGuides: DEFAULT_SETTINGS.indentGuides,
      stickyScroll: DEFAULT_SETTINGS.stickyScroll,
      formatBriefOnSave: DEFAULT_SETTINGS.formatBriefOnSave,
      tabSize: DEFAULT_SETTINGS.tabSize,
      briefColumns: DEFAULT_SETTINGS.briefColumns,
      lineNumbers: DEFAULT_SETTINGS.lineNumbers,
      zoom: DEFAULT_SETTINGS.zoom,
      uiFontFamily: DEFAULT_SETTINGS.uiFontFamily,
      uiFontSize: DEFAULT_SETTINGS.uiFontSize,
      codeFontFamily: DEFAULT_SETTINGS.codeFontFamily,
      codeFontSize: DEFAULT_SETTINGS.codeFontSize,
      fontSizes: DEFAULT_SETTINGS.fontSizes,
      fontFamilies: DEFAULT_SETTINGS.fontFamilies,
      googleFonts: DEFAULT_SETTINGS.googleFonts,
    });
  });

  it('reads a file written before a folder could choose its file types', async () => {
    // TYTO-188's key, missing from every file written before it: defaulted, so every folder
    // keeps producing PNG alone and nothing else in the record is lost.
    writeFileSync(
      file,
      JSON.stringify({ templatesFolder: '/t', queueFolder: '/q', queueAutoRun: true }),
      'utf8',
    );

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/t',
      queueFolder: '/q',
      queueAutoRun: true,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
      iconStrokeWidth: DEFAULT_SETTINGS.iconStrokeWidth,
      statusBarItems: DEFAULT_SETTINGS.statusBarItems,
      statusBarColors: DEFAULT_SETTINGS.statusBarColors,
      vimMode: DEFAULT_SETTINGS.vimMode,
      vimPlugins: DEFAULT_SETTINGS.vimPlugins,
      vimModeStyle: DEFAULT_SETTINGS.vimModeStyle,
      indentGuides: DEFAULT_SETTINGS.indentGuides,
      stickyScroll: DEFAULT_SETTINGS.stickyScroll,
      formatBriefOnSave: DEFAULT_SETTINGS.formatBriefOnSave,
      tabSize: DEFAULT_SETTINGS.tabSize,
      briefColumns: DEFAULT_SETTINGS.briefColumns,
      lineNumbers: DEFAULT_SETTINGS.lineNumbers,
      zoom: DEFAULT_SETTINGS.zoom,
      uiFontFamily: DEFAULT_SETTINGS.uiFontFamily,
      uiFontSize: DEFAULT_SETTINGS.uiFontSize,
      codeFontFamily: DEFAULT_SETTINGS.codeFontFamily,
      codeFontSize: DEFAULT_SETTINGS.codeFontSize,
      fontSizes: DEFAULT_SETTINGS.fontSizes,
      fontFamilies: DEFAULT_SETTINGS.fontFamilies,
      googleFonts: DEFAULT_SETTINGS.googleFonts,
    });
  });

  it('keeps the templates folder when the file types were hand-broken', async () => {
    // Without `.catch` on the field, one bad value failed the whole object and the person's
    // templates folder went back to none along with it.
    writeFileSync(
      file,
      JSON.stringify({ templatesFolder: '/t', queueFolder: '/q', queueKinds: { '/q': [] } }),
      'utf8',
    );

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/t',
      queueFolder: '/q',
      queueAutoRun: false,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
      iconStrokeWidth: DEFAULT_SETTINGS.iconStrokeWidth,
      statusBarItems: DEFAULT_SETTINGS.statusBarItems,
      statusBarColors: DEFAULT_SETTINGS.statusBarColors,
      vimMode: DEFAULT_SETTINGS.vimMode,
      vimPlugins: DEFAULT_SETTINGS.vimPlugins,
      vimModeStyle: DEFAULT_SETTINGS.vimModeStyle,
      indentGuides: DEFAULT_SETTINGS.indentGuides,
      stickyScroll: DEFAULT_SETTINGS.stickyScroll,
      formatBriefOnSave: DEFAULT_SETTINGS.formatBriefOnSave,
      tabSize: DEFAULT_SETTINGS.tabSize,
      briefColumns: DEFAULT_SETTINGS.briefColumns,
      lineNumbers: DEFAULT_SETTINGS.lineNumbers,
      zoom: DEFAULT_SETTINGS.zoom,
      uiFontFamily: DEFAULT_SETTINGS.uiFontFamily,
      uiFontSize: DEFAULT_SETTINGS.uiFontSize,
      codeFontFamily: DEFAULT_SETTINGS.codeFontFamily,
      codeFontSize: DEFAULT_SETTINGS.codeFontSize,
      fontSizes: DEFAULT_SETTINGS.fontSizes,
      fontFamilies: DEFAULT_SETTINGS.fontFamilies,
      googleFonts: DEFAULT_SETTINGS.googleFonts,
    });
  });

  it('changes only the keys it is given, so two writers keep each other', async () => {
    const store = fileSettingsStore(file);
    // Not awaited one by one: the templates picker and the queue panel can write at once.
    await Promise.all([
      store.write({ templatesFolder: '/templates' }),
      store.write({ queueFolder: '/queue', queueAutoRun: true }),
    ]);

    expect(await fileSettingsStore(file).read()).toEqual({
      templatesFolder: '/templates',
      queueFolder: '/queue',
      queueAutoRun: true,
      queueKinds: {},
      theme: DEFAULT_SETTINGS.theme,
      iconStrokeWidth: DEFAULT_SETTINGS.iconStrokeWidth,
      statusBarItems: DEFAULT_SETTINGS.statusBarItems,
      statusBarColors: DEFAULT_SETTINGS.statusBarColors,
      vimMode: DEFAULT_SETTINGS.vimMode,
      vimPlugins: DEFAULT_SETTINGS.vimPlugins,
      vimModeStyle: DEFAULT_SETTINGS.vimModeStyle,
      indentGuides: DEFAULT_SETTINGS.indentGuides,
      stickyScroll: DEFAULT_SETTINGS.stickyScroll,
      formatBriefOnSave: DEFAULT_SETTINGS.formatBriefOnSave,
      tabSize: DEFAULT_SETTINGS.tabSize,
      briefColumns: DEFAULT_SETTINGS.briefColumns,
      lineNumbers: DEFAULT_SETTINGS.lineNumbers,
      zoom: DEFAULT_SETTINGS.zoom,
      uiFontFamily: DEFAULT_SETTINGS.uiFontFamily,
      uiFontSize: DEFAULT_SETTINGS.uiFontSize,
      codeFontFamily: DEFAULT_SETTINGS.codeFontFamily,
      codeFontSize: DEFAULT_SETTINGS.codeFontSize,
      fontSizes: DEFAULT_SETTINGS.fontSizes,
      fontFamilies: DEFAULT_SETTINGS.fontFamilies,
      googleFonts: DEFAULT_SETTINGS.googleFonts,
    });
  });

  it('says nothing when the disk will not take it', async () => {
    // A file where the folder should be. The person keeps the folder for this session — the
    // reload has already happened — and loses only the memory of it.
    writeFileSync(join(scratch, 'blocked'), 'not a folder', 'utf8');

    await expect(
      fileSettingsStore(join(scratch, 'blocked', 'settings.json')).write({
        templatesFolder: '/x',
      }),
    ).resolves.toEqual(ok(undefined));
  });
});

/**
 * The file a person edits by hand (TYTO-206, ADR 0073): JSON with comments, tolerant one key
 * at a time, edited in place, and never written while it does not parse.
 */
describe('a settings file somebody edits by hand', () => {
  const rangeOf = (text: string, fragment: string) => {
    const start = text.indexOf(fragment);
    return { start, end: start + fragment.length };
  };

  it('keeps every good key when one value is bad, and points at that value', async () => {
    const text = [
      '{',
      '  // my own templates',
      '  "templatesFolder": "/t",',
      '  "queueAutoRun": "yes",',
      '  "queueFolder": "/q"',
      '}',
    ].join('\n');
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings).toEqual({
      ...DEFAULT_SETTINGS,
      templatesFolder: '/t',
      queueFolder: '/q',
    });
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', rangeOf(text, '"yes"')],
    ]);
  });

  it('names an unknown key at the key, and still applies the rest', async () => {
    const text = '{ "queueAutoRn": true, "queueAutoRun": true }';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.queueAutoRun).toBe(true);
    expect(reading.diagnostics.map((item) => [item.code, item.range, item.message])).toEqual([
      ['W_SETTING_UNKNOWN', rangeOf(text, '"queueAutoRn"'), "Unknown setting 'queueAutoRn'."],
    ]);
  });

  it('keeps a comment the person wrote when a screen changes a key', async () => {
    const text = '{\n  // the queue I share with Ana\n  "queueFolder": "/q",\n}\n';
    writeFileSync(file, text, 'utf8');

    expect(await fileSettingsStore(file).write({ templatesFolder: '/t' })).toEqual(ok(undefined));

    const after = readFileSync(file, 'utf8');
    expect(after).toContain('// the queue I share with Ana');
    expect(after.startsWith('{\n  // the queue I share with Ana\n  "queueFolder": "/q",')).toBe(
      true,
    );
    expect(await fileSettingsStore(file).read()).toEqual({
      ...DEFAULT_SETTINGS,
      templatesFolder: '/t',
      queueFolder: '/q',
    });
  });

  it('writes only what differs from the default, and removes a key set back to it', async () => {
    const store = fileSettingsStore(file);
    await store.write({ queueAutoRun: true, queueFolder: null });

    expect(readFileSync(file, 'utf8')).toBe('{\n  "queueAutoRun": true\n}');

    await store.write({ queueAutoRun: false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({});
  });

  it('never writes over a file that does not parse, and says why', async () => {
    const text = '{\n  "templatesFolder": "/t"\n  "queueAutoRun": tru';
    writeFileSync(file, text, 'utf8');

    const written = await fileSettingsStore(file).write({ queueFolder: '/q' });

    expect(written.ok).toBe(false);
    expect(written.ok ? [] : written.error.map((item) => item.code)).toContain('E_SETTINGS_SYNTAX');
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('still opens on a file that does not parse, with what could be read', async () => {
    writeFileSync(file, '{ "templatesFolder": "/t" "queueAutoRun": true', 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.templatesFolder).toBe('/t');
    expect(reading.diagnostics.some((item) => item.code === 'E_SETTINGS_SYNTAX')).toBe(true);
  });
});

/** `statusBarItems` (TYTO-301, ADR 0091): a list whose entries are checked one at a time. */
describe('the statusBarItems setting in the file', () => {
  const rangeOf = (text: string, fragment: string) => {
    const start = text.indexOf(fragment);
    return { start, end: start + fragment.length };
  };

  it('is today’s bar when the file does not name it', async () => {
    expect((await fileSettingsStore(file).read()).statusBarItems).toEqual(STATUS_BAR_ITEM_IDS);
  });

  it('reads a filtered, reordered list as written', async () => {
    writeFileSync(file, '{ "statusBarItems": ["settings", "problems", "leftArea"] }', 'utf8');

    expect((await fileSettingsStore(file).read()).statusBarItems).toEqual([
      'settings',
      'problems',
      'leftArea',
    ]);
  });

  it('points at an unknown id and a repeated one, and applies the rest', async () => {
    const text = '{\n  "statusBarItems": ["problems", "clock", 3, "problems", "queue"]\n}\n';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.statusBarItems).toEqual(['problems', 'queue']);
    // The repeat is the second "problems", not the first.
    const repeat = text.lastIndexOf('"problems"');
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_ENTRY_INVALID', rangeOf(text, '"clock"')],
      ['W_SETTING_ENTRY_INVALID', rangeOf(text, '3')],
      ['W_SETTING_ENTRY_INVALID', { start: repeat, end: repeat + '"problems"'.length }],
    ]);
    expect(reading.diagnostics[0]?.message).toContain("'clock' is not a status bar item");
  });

  it('refuses a value that is not a list, and draws today’s bar', async () => {
    const text = '{ "statusBarItems": "template" }';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.statusBarItems).toEqual(STATUS_BAR_ITEM_IDS);
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', rangeOf(text, '"template"')],
    ]);
  });

  it('is in a new settings.json commented out, every id in today’s order', async () => {
    // What "Open Settings (JSON)" writes holds the example; uncommented, it is the default.
    const example = statusBarItemsExample();
    const uncommented = example
      .replace(/^ {2}\/\/ (?=\s*["\]])/gmu, '  ')
      .replace(/ +\/\/ .*$/gmu, '');
    writeFileSync(file, `{\n${uncommented}\n}\n`, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.statusBarItems).toEqual(STATUS_BAR_ITEM_IDS);
    for (const item of STATUS_BAR_ITEMS) expect(example).toContain(item.description);
  });
});

/** `statusBarColors` (TYTO-301, ADR 0091): an object whose members are checked one at a time. */
describe('the statusBarColors setting in the file', () => {
  const rangeOf = (text: string, fragment: string) => {
    const start = text.indexOf(fragment);
    return { start, end: start + fragment.length };
  };

  it('is empty — the theme everywhere — when the file does not name it', async () => {
    expect((await fileSettingsStore(file).read()).statusBarColors).toEqual({});
  });

  it('points at an unknown key and a bad colour, and applies the rest', async () => {
    const text =
      '{\n  "statusBarColors": {\n    "background": "#1e3a5f",\n    "clock": "#ffffff",\n' +
      '    "vimMode.normal": "blue",\n    "item.problems": "#FD6"\n  }\n}\n';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.statusBarColors).toEqual({
      background: '#1e3a5f',
      'item.problems': '#FD6',
    });
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_ENTRY_INVALID', rangeOf(text, '"clock"')],
      ['W_SETTING_INVALID', rangeOf(text, '"blue"')],
    ]);
    // The unknown key's message lists every key the setting takes.
    for (const { key } of STATUS_BAR_COLOUR_KEYS) {
      expect(reading.diagnostics[0]?.message).toContain(key);
    }
    expect(reading.diagnostics[1]?.message).toBe(
      "Setting 'statusBarColors.vimMode.normal' is not accepted (a colour is written #rgb or " +
        '#rrggbb, opaque); its default applies.',
    );
  });

  it('refuses a value that is not an object, and the theme applies', async () => {
    const text = '{ "statusBarColors": "#000000" }';
    writeFileSync(file, text, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.settings.statusBarColors).toEqual({});
    expect(reading.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', rangeOf(text, '"#000000"')],
    ]);
  });

  it('is in a new settings.json commented out, with every key and an example colour', async () => {
    const example = statusBarColorsExample();
    const uncommented = example
      .replace(/^ {2}\/\/ (?=\s*["}])/gmu, '  ')
      .replace(/ +\/\/ .*$/gmu, '');
    writeFileSync(file, `{\n${uncommented}\n}\n`, 'utf8');

    const reading = await fileSettingsStore(file).load();

    expect(reading.diagnostics).toEqual([]);
    expect(Object.keys(reading.settings.statusBarColors)).toEqual(
      STATUS_BAR_COLOUR_KEYS.map((entry) => entry.key),
    );
    for (const entry of STATUS_BAR_COLOUR_KEYS) expect(example).toContain(entry.description);
  });
});

/** The contrast of a vim badge colour, measured against the themes in force (TYTO-301). */
describe('the vim badge colours of statusBarColors', () => {
  // Tyto Light's three candidates for a badge's text.
  const light = {
    id: 'tyto-light',
    colors: { surface: '#fafafa', text: '#242529', 'accent-text': '#ffffff' },
  };

  it('says nothing when a text colour of the theme reads 4.5:1 on the badge', () => {
    const text = '{ "statusBarColors": { "vimMode.normal": "#1d4ed8" } }';
    expect(
      validateSettingsText(text, BUILT_IN_SETTINGS, (entries) =>
        statusBarColorsContrast(entries, [light]),
      ),
    ).toEqual([]);
  });

  it('applies a colour no text reads on, and warns at the value with the ratio measured', () => {
    // Mid grey: white reads 3.94:1 on it, the best of the three, and the dark text less.
    const text = '{ "statusBarColors": { "vimMode.insert": "#808080" } }';

    const problems = validateSettingsText(text, BUILT_IN_SETTINGS, (entries) =>
      statusBarColorsContrast(entries, [light]),
    );

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_LOW_CONTRAST', rangeOf(text, '"#808080"')],
    ]);
    expect(problems[0]?.message).toBe(
      "Setting 'statusBarColors.vimMode.insert' applies, but the best text on it reads 3.94:1 " +
        "in theme 'tyto-light', under 4.5:1.",
    );
  });

  const rangeOf = (text: string, fragment: string) => {
    const start = text.indexOf(fragment);
    return { start, end: start + fragment.length };
  };
});

/** The bar's own text on its background, when the override sets either (TYTO-301). */
describe("the bar's own colours of statusBarColors", () => {
  // Tyto Light's and Tyto Dark's bar pair, as their theme files set it.
  const light = {
    id: 'tyto-light',
    colors: { 'status-bar': '#ebebec', 'status-bar-text': '#58585a' },
  };
  const dark = {
    id: 'tyto-dark',
    colors: { 'status-bar': '#2f343e', 'status-bar-text': '#a9afbc' },
  };
  const check = (text: string, themes = [light]) =>
    validateSettingsText(text, BUILT_IN_SETTINGS, (entries) =>
      statusBarColorsContrast(entries, themes),
    );
  const rangeOf = (text: string, fragment: string) => {
    const start = text.indexOf(fragment);
    return { start, end: start + fragment.length };
  };

  it("warns at a background the theme's text does not read on, with the ratio", () => {
    const text = '{ "statusBarColors": { "background": "#1e3a5f" } }';

    const problems = check(text);

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_LOW_CONTRAST', rangeOf(text, '"#1e3a5f"')],
    ]);
    expect(problems[0]?.message).toBe(
      "Setting 'statusBarColors.background' applies, but the bar's text on its background " +
        "reads 1.62:1 in theme 'tyto-light', under 4.5:1.",
    );
  });

  it("warns at a foreground that does not read on the theme's background", () => {
    const text = '{ "statusBarColors": { "foreground": "#c8c8c8" } }';

    expect(check(text).map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_LOW_CONTRAST', rangeOf(text, '"#c8c8c8"')],
    ]);
  });

  it('warns at the foreground when both are set and they do not read together', () => {
    const text = '{ "statusBarColors": { "background": "#1e3a5f", "foreground": "#3a5f8a" } }';

    expect(check(text).map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_LOW_CONTRAST', rangeOf(text, '"#3a5f8a"')],
    ]);
  });

  it('says nothing for a pair that reads, and measures each theme the mode can show', () => {
    expect(
      check('{ "statusBarColors": { "background": "#1e3a5f", "foreground": "#f0f0f0" } }'),
    ).toEqual([]);
    // A light background: fine under Tyto Light's dark text, unreadable under Tyto Dark's.
    const problems = check('{ "statusBarColors": { "background": "#fafafa" } }', [light, dark]);
    expect(problems.map((item) => item.message)).toEqual([
      expect.stringContaining("in theme 'tyto-dark'"),
    ]);
  });
});

/**
 * An installed plugin's keys in the file (TYTO-254, ADR 0145): checked like a built-in's while
 * the plugin runs, and named — not called unknown — while it does not.
 */
describe("an installed plugin's setting in the file", () => {
  const BASE_URL = declaredSetting('demo', true, {
    id: 'baseUrl',
    form: { type: 'string', format: 'uri' },
    default: 'https://default.example',
    description: 'Where the service is.',
  });

  it('is W_SETTING_INVALID at the value when its form refuses it, and never unknown', () => {
    const text = '{ "demo.baseUrl": "not a uri" }';
    const diagnostics = validateSettingsText(text, [...BUILT_IN_SETTINGS, BASE_URL]);
    const value = text.indexOf('"not a uri"');
    expect(diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', { start: value, end: value + '"not a uri"'.length }],
    ]);
  });

  it('names the plugin that is not running instead of calling its key unknown', () => {
    const text = '{ "parado.token": "x", "nobody.key": 1 }';
    const diagnostics = validateSettingsText(text, BUILT_IN_SETTINGS, undefined, ['parado']);
    expect(diagnostics.map((item) => [item.code, item.message, item.range])).toEqual([
      ['W_SETTING_UNKNOWN', "Unknown setting 'nobody.key'.", { start: 23, end: 35 }],
      [
        'W_SETTING_PLUGIN_NOT_RUNNING',
        "Setting 'parado.token' belongs to plugin 'parado', which is not running.",
        { start: 2, end: 16 },
      ],
    ]);
  });

  it('names it in the reading the log gets too', async () => {
    writeFileSync(file, '{ "parado.token": "x" }');
    const reading = await fileSettingsStore(
      file,
      () => BUILT_IN_SETTINGS,
      () => undefined,
      () => ['parado'],
    ).load();
    expect(reading.diagnostics.map((item) => item.code)).toEqual(['W_SETTING_PLUGIN_NOT_RUNNING']);
  });
});
