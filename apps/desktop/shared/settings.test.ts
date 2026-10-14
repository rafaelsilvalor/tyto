import { declaredSetting, resolveSettings } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  ICON_STROKE_WIDTH,
  settingContributions,
  settingsFrom,
} from './settings.js';

/**
 * The `iconStrokeWidth` setting (TYTO-288, ADR 0085), as values: its default, its bounds and
 * what a value it refuses comes to. That the window draws with it is
 * `e2e/icon-stroke.desktop.test.ts`.
 */

const contribution = () => {
  const found = settingContributions().find((each) => each.id === 'iconStrokeWidth');
  if (found === undefined) throw new Error('the desktop plugin declares no iconStrokeWidth');
  return found;
};

const read = (value: unknown) =>
  resolveSettings(
    [declaredSetting('desktop', false, contribution())],
    [
      {
        key: 'iconStrokeWidth',
        value,
        keyRange: { start: 1, end: 18 },
        valueRange: { start: 20, end: 25 },
      },
    ],
  );

describe('the icon stroke setting', () => {
  it('defaults to 1.25, the width Rafael chose from the sheet', () => {
    expect(ICON_STROKE_WIDTH.default).toBe(1.25);
    expect(contribution().default).toBe(1.25);
    expect(DEFAULT_SETTINGS.iconStrokeWidth).toBe(1.25);
    expect(settingsFrom({}).iconStrokeWidth).toBe(1.25);
  });

  it.each([0.75, 1, 1.25, 1.5, 2])('accepts %s', (value) => {
    const resolved = read(value);
    expect(resolved.diagnostics).toEqual([]);
    expect(settingsFrom(resolved.values).iconStrokeWidth).toBe(value);
  });

  it.each([
    ['below the floor', 0.5],
    ['above the ceiling', 2.5],
    ['zero', 0],
    ['a string', '1.25'],
    ['null', null],
  ])('refuses %s at the value and falls back to the default', (_, value) => {
    const resolved = read(value);
    expect(resolved.diagnostics.map((item) => item.code)).toEqual(['W_SETTING_INVALID']);
    // The value's own span, so the settings tab underlines the number and not the key.
    expect(resolved.diagnostics[0]?.range).toEqual({ start: 20, end: 25 });
    expect(settingsFrom(resolved.values).iconStrokeWidth).toBe(1.25);
  });
});
