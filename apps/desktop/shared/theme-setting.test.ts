import { declaredSetting, resolveSettings } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_SETTING,
  type ThemeLookup,
  chosenThemeSetting,
  modeOf,
  resolveThemeSetting,
  themeSettingContribution,
} from './theme-setting.js';

/**
 * The `theme` setting's rules (TYTO-208, ADR 0077), as values: what the file may say, what a
 * value comes to, and what a choice in the picker writes. That the window follows them is
 * `e2e/theme-pick.desktop.test.ts`.
 */

/** The built-in two and Sepia, with every plugin started. */
const KNOWN = new Map<string, 'light' | 'dark'>([
  ['tyto-light', 'light'],
  ['tyto-dark', 'dark'],
  ['sepia', 'light'],
]);
const lookup: ThemeLookup = (id) => KNOWN.get(id) ?? 'unknown';

const read = (value: unknown, known: ThemeLookup = lookup) => {
  const setting = declaredSetting('desktop', false, themeSettingContribution(known));
  return resolveSettings(
    [setting],
    [
      {
        key: 'theme',
        value,
        keyRange: { start: 1, end: 8 },
        valueRange: { start: 10, end: 40 },
      },
    ],
  );
};

describe('what the file may say', () => {
  it.each([
    ['a fixed id', 'sepia'],
    ['slots and a mode', { mode: 'dark', light: 'sepia', dark: 'tyto-dark' }],
    ['the default written out', DEFAULT_THEME_SETTING],
  ])('accepts %s', (_, value) => {
    const resolved = read(value);
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.values['theme']).toEqual(value);
  });

  it.each([
    ['an id no plugin offers', 'solarized', "no installed theme is called 'solarized'"],
    [
      'an unknown id in a slot',
      { mode: 'system', light: 'solarized', dark: 'tyto-dark' },
      "'solarized'",
    ],
    [
      'a dark theme in the light slot',
      { mode: 'system', light: 'tyto-dark', dark: 'tyto-dark' },
      "'tyto-dark' is a dark theme and cannot be the light one",
    ],
    [
      'a mode that is not one of the three',
      { mode: 'auto', light: 'sepia', dark: 'tyto-dark' },
      '',
    ],
    ['a number', 3, ''],
  ])('refuses %s at the value, and the default applies', (_, value, words) => {
    const resolved = read(value);
    expect(resolved.values['theme']).toEqual(DEFAULT_THEME_SETTING);
    expect(resolved.diagnostics.map((item) => item.code)).toEqual(['W_SETTING_INVALID']);
    expect(resolved.diagnostics[0]?.range).toEqual({ start: 10, end: 40 });
    expect(resolved.diagnostics[0]?.message).toContain(words);
  });

  it('lets an id through while the installed plugins are still starting', () => {
    expect(read('sepia', () => 'not-yet-known').diagnostics).toEqual([]);
  });
});

describe('what a value comes to', () => {
  it('makes a fixed id the mode of its kind, with the default in the other slot', () => {
    expect(resolveThemeSetting('sepia', lookup)).toEqual({
      mode: 'light',
      light: 'sepia',
      dark: 'tyto-dark',
    });
    expect(modeOf('tyto-dark', lookup)).toBe('dark');
  });

  it('keeps the mode of the slots, which is the in-app override', () => {
    const slots = { mode: 'dark', light: 'sepia', dark: 'tyto-dark' } as const;
    expect(resolveThemeSetting(slots, lookup)).toEqual(slots);
    expect(modeOf(slots, lookup)).toBe('dark');
  });

  it('puts the default in a slot whose theme has gone since the file was written', () => {
    expect(
      resolveThemeSetting({ mode: 'system', light: 'gone', dark: 'tyto-dark' }, lookup),
    ).toEqual(DEFAULT_THEME_SETTING);
    expect(resolveThemeSetting('gone', lookup)).toEqual(DEFAULT_THEME_SETTING);
  });

  it('waits on the system for a fixed id nobody has registered yet', () => {
    expect(modeOf('sepia', () => 'not-yet-known')).toBe('system');
  });
});

describe('what a choice in the picker writes', () => {
  it('keeps a fixed id fixed', () => {
    expect(chosenThemeSetting('tyto-dark', { id: 'sepia', kind: 'light' }, 'dark')).toBe('sepia');
  });

  it('keeps following the system when the system is already in the theme’s kind', () => {
    expect(
      chosenThemeSetting(DEFAULT_THEME_SETTING, { id: 'sepia', kind: 'light' }, 'light'),
    ).toEqual({ mode: 'system', light: 'sepia', dark: 'tyto-dark' });
  });

  it('switches the mode when the chosen theme would otherwise not show', () => {
    expect(
      chosenThemeSetting(DEFAULT_THEME_SETTING, { id: 'sepia', kind: 'light' }, 'dark'),
    ).toEqual({ mode: 'light', light: 'sepia', dark: 'tyto-dark' });
    expect(
      chosenThemeSetting(
        { mode: 'light', light: 'tyto-light', dark: 'tyto-dark' },
        { id: 'tyto-dark', kind: 'dark' },
        'light',
      ),
    ).toEqual({ mode: 'dark', light: 'tyto-light', dark: 'tyto-dark' });
  });
});
