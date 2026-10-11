import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ThemeContribution } from '@tyto/plugin-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_THEME_SETTING, type ThemeSetting } from '../../shared/theme-setting.js';
import {
  BASE_COLORS,
  BUILT_IN_THEMES,
  builtInThemeReader,
  createThemeService,
  folderThemeReader,
  loadTheme,
} from './themes.js';

/** A dark theme a plugin might ship; its colours are invented. */
const DUSK: ThemeContribution = { id: 'dusk', label: 'Dusk', kind: 'dark', path: 'dusk.json' };

const fromText = (text: string) => () => Promise.resolve(text);

let scratch: string;
let root: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-themes-'));
  root = join(scratch, 'plugins', 'dusk');
  mkdirSync(join(root, 'themes'), { recursive: true });
  writeFileSync(
    join(root, 'themes', 'dusk.json'),
    JSON.stringify({ name: 'Dusk', kind: 'dark', colors: { surface: '#101010' } }),
  );
  mkdirSync(join(scratch, 'secret'));
  writeFileSync(
    join(scratch, 'secret', 'dusk.json'),
    JSON.stringify({ name: 'Stolen', kind: 'dark', colors: { surface: '#202020' } }),
  );
  // A junction, which Windows creates without elevation, pointing out of the plugin's folder.
  symlinkSync(join(scratch, 'secret'), join(root, 'escape'), 'junction');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the built-in themes', () => {
  it.each(['light', 'dark'] as const)('load the %s file with nothing to say', async (kind) => {
    const loaded = await loadTheme(BUILT_IN_THEMES[kind], builtInThemeReader);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.colors).toEqual(BASE_COLORS[kind]);
    expect(Object.keys(loaded.colors)).toHaveLength(30);
  });

  it('are what the service answers for each mode by default', async () => {
    const { service, modes } = serviceWith({});
    const current = await service.current();
    expect([current.mode, current.light.id, current.dark.id]).toEqual([
      'system',
      'tyto-light',
      'tyto-dark',
    ]);
    expect(current.dark.colors).toEqual(BASE_COLORS.dark);
    expect(modes).toEqual(['system']);
  });
});

/** A light theme a plugin ships, read from a string. */
const SEPIA: ThemeContribution = { id: 'sepia', label: 'Sepia', kind: 'light', path: 'sepia.json' };
const SEPIA_TEXT = JSON.stringify({ name: 'Sepia', kind: 'light', colors: { surface: '#f4ecd8' } });

/**
 * The service over the built-in two and Sepia, an installed plugin's, with the setting and
 * the system's kind as given. `modes` is every mode it told Electron, in order.
 */
function serviceWith(options: {
  setting?: ThemeSetting;
  shown?: 'light' | 'dark';
  sepia?: string;
  ready?: Promise<void>;
}) {
  const modes: string[] = [];
  const reported: string[] = [];
  const setting: ThemeSetting = options.setting ?? DEFAULT_THEME_SETTING;
  const service = createThemeService({
    sources: () => [
      ...Object.values(BUILT_IN_THEMES).map((theme) => ({
        plugin: 'desktop',
        theme,
        read: builtInThemeReader,
      })),
      { plugin: 'sepia', theme: SEPIA, read: fromText(options.sepia ?? SEPIA_TEXT) },
    ],
    ready: options.ready ?? Promise.resolve(),
    setting: () => setting,
    setMode: (mode) => modes.push(mode),
    shown: () => options.shown ?? 'light',
    report: (problem) => reported.push(problem.code),
  });
  return { service, modes, reported };
}

describe('the theme the setting chooses (TYTO-208)', () => {
  it('applies an installed theme named in its slot', async () => {
    const { service } = serviceWith({ setting: { ...DEFAULT_THEME_SETTING, light: 'sepia' } });
    const current = await service.current();
    expect(current.light.id).toBe('sepia');
    expect(current.light.colors.surface).toBe('#f4ecd8');
    // Every other token is Tyto Light's.
    expect(current.light.colors['text']).toBe(BASE_COLORS.light['text']);
  });

  it('tells Electron the mode a fixed id or an override asks for', async () => {
    const fixed = serviceWith({ setting: 'tyto-dark' });
    expect((await fixed.service.current()).mode).toBe('dark');
    const forced = serviceWith({ setting: { ...DEFAULT_THEME_SETTING, mode: 'dark' } });
    await forced.service.current();
    expect(forced.modes).toEqual(['dark']);
  });

  it('applies the base of the kind when the theme file is malformed, and reports it', async () => {
    const { service, reported } = serviceWith({ setting: 'sepia', sepia: '{ not json' });
    const current = await service.current();
    expect(current.light.id).toBe('sepia');
    expect(current.light.colors).toEqual(BASE_COLORS.light);
    expect(current.light.diagnostics.map((item) => item.code)).toContain('E_THEME_INVALID');
    expect(reported).toContain('E_THEME_INVALID');
  });

  it('waits for the installed plugins before it gives up on an id that may be theirs', async () => {
    let start: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      start = resolve;
    });
    const { service } = serviceWith({ setting: 'sepia', ready });
    expect(service.lookup('sepia')).toBe('light');
    expect(service.lookup('gone')).toBe('not-yet-known');
    start();
    await service.list();
    expect(service.lookup('gone')).toBe('unknown');
  });

  it('lists every theme once, the built-in two first', async () => {
    const { service } = serviceWith({});
    expect((await service.list()).map((theme) => theme.id)).toEqual([
      'tyto-light',
      'tyto-dark',
      'sepia',
    ]);
  });
});

describe('the picker’s preview and choice (TYTO-208)', () => {
  it('shows a previewed theme and goes back to the setting on cancel', async () => {
    const { service, modes } = serviceWith({ shown: 'light' });
    const previewed = await service.preview('tyto-dark');
    expect([previewed.mode, previewed.dark.id]).toEqual(['dark', 'tyto-dark']);
    const back = await service.preview(undefined);
    expect(back.mode).toBe('system');
    expect(modes).toEqual(['dark', 'system']);
  });

  it('chooses from the kind the window was in before the preview moved it', async () => {
    // The system is light; previewing Tyto Dark forced Electron dark, and the choice must
    // still know the system was light, or it would keep `system` and the dark theme vanish.
    const { service } = serviceWith({ shown: 'light' });
    await service.preview('tyto-dark');
    expect(await service.choose('tyto-dark', DEFAULT_THEME_SETTING)).toEqual({
      ...DEFAULT_THEME_SETTING,
      mode: 'dark',
    });
    expect(await service.choose('nobody', DEFAULT_THEME_SETTING)).toBeUndefined();
  });
});

describe('a theme that sets some tokens', () => {
  it('takes the base of its kind for every token it leaves out', async () => {
    const loaded = await loadTheme(
      DUSK,
      fromText('{ "name": "Dusk", "kind": "dark", "colors": { "surface": "#101010" } }'),
    );
    expect(loaded.colors).toEqual({ ...BASE_COLORS.dark, surface: '#101010' });
    expect(loaded.diagnostics).toEqual([]);
  });

  it('names an unknown token and a value that is not a colour where they were written', async () => {
    const text =
      '{ "name": "Dusk", "kind": "dark", "colors": { "panel.border": "#111", "text": "#000;}" } }';
    const loaded = await loadTheme(DUSK, fromText(text));
    expect(loaded.colors).toEqual(BASE_COLORS.dark);
    expect(
      loaded.diagnostics.map((item) => [item.code, text.slice(item.range!.start, item.range!.end)]),
    ).toEqual([
      ['W_THEME_TOKEN_UNKNOWN', '"panel.border"'],
      ['W_THEME_COLOR_INVALID', '"#000;}"'],
    ]);
  });
});

describe('a theme that cannot be used falls back to the base theme whole', () => {
  it.each([
    [
      'a syntax error',
      '{ "name": "Dusk", "kind": "dark", "colors": { "surface": } }',
      'not valid JSON',
    ],
    ['an array', '[]', 'not an object'],
    ['no name', '{ "kind": "dark", "colors": {} }', "no 'name'"],
    ['a bad kind', '{ "name": "Dusk", "kind": "dim", "colors": {} }', 'not light or dark'],
    ['the other kind', '{ "name": "Dusk", "kind": "light", "colors": {} }', "says 'light'"],
    ['no colours', '{ "name": "Dusk", "kind": "dark" }', "'colors' is not an object"],
  ])('with %s', async (_, text, problem) => {
    const loaded = await loadTheme(DUSK, fromText(text));
    expect(loaded.colors).toEqual(BASE_COLORS.dark);
    expect(loaded.diagnostics.map((item) => item.code)).toContain('E_THEME_INVALID');
    expect(loaded.diagnostics[0]?.message).toContain(problem);
    expect(loaded.diagnostics[0]?.range).toBeDefined();
  });

  it('when the file cannot be read', async () => {
    const loaded = await loadTheme(DUSK, () => Promise.reject(new Error('the disk said no')));
    expect(loaded.colors).toEqual(BASE_COLORS.dark);
    expect(loaded.diagnostics.map((item) => item.message)).toEqual([
      "Theme 'dusk' cannot be used: the disk said no. The base dark theme applies.",
    ]);
  });
});

describe("an installed plugin's theme file", () => {
  it('is read from inside its folder', async () => {
    const loaded = await loadTheme({ ...DUSK, path: 'themes/dusk.json' }, folderThemeReader(root));
    expect(loaded.colors.surface).toBe('#101010');
    expect(loaded.diagnostics).toEqual([]);
  });

  it.each([
    ['a junction out of the folder', 'escape/dusk.json'],
    ['a path that climbs out by name', '../../secret/dusk.json'],
    ['a file that is not there', 'themes/none.json'],
  ])('is refused through %s, and the base applies', async (_, path) => {
    const loaded = await loadTheme({ ...DUSK, path }, folderThemeReader(root));
    expect(loaded.colors).toEqual(BASE_COLORS.dark);
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(['E_THEME_INVALID']);
  });
});
