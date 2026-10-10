import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ThemeContribution } from '@tyto/plugin-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  it('are what the service answers for each mode', async () => {
    const service = createThemeService({
      sources: () =>
        Object.values(BUILT_IN_THEMES).map((theme) => ({
          plugin: 'desktop',
          theme,
          read: builtInThemeReader,
        })),
      report: () => undefined,
    });
    const current = await service.current();
    expect([current.light.id, current.dark.id]).toEqual(['tyto-light', 'tyto-dark']);
    expect(current.dark.colors).toEqual(BASE_COLORS.dark);
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
