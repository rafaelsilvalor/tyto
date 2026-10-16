import { declaredSetting } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { settingContributions } from '../../shared/settings.js';
import { settingsOutline } from './settings-outline.js';

/**
 * What the settings tab is told about the app's own settings (TYTO-304): the options come from
 * the same tables the commented example in a new `settings.json` is written from.
 */
const outline = settingsOutline(
  settingContributions().map((contribution) => declaredSetting('desktop', false, contribution)),
  [
    { id: 'tyto-light', label: 'Tyto Light', kind: 'light', path: 'light.json' },
    { id: 'nord', label: 'Nord', kind: 'dark', path: 'nord.json' },
  ],
);
const setting = (key: string) => outline.find((each) => each.key === key);

describe("the app's settings outline", () => {
  it('lists every setting the desktop plugin declares', () => {
    expect(outline.map((each) => each.key)).toEqual([
      'templatesFolder',
      'queueFolder',
      'queueAutoRun',
      'queueKinds',
      'theme',
      'iconStrokeWidth',
      'statusBarItems',
      'statusBarColors',
      'vimModeStyle',
      'indentGuides',
    ]);
  });

  it('offers indentGuides on and off, each with what it does (TYTO-293)', () => {
    const guides = setting('indentGuides');
    expect(guides?.options.map((option) => option.value)).toEqual([true, false]);
    expect(guides?.options[0]?.description).toMatch(/indent level/u);
    expect(guides?.default).toBe('true');
  });

  it("offers vimModeStyle's three styles with what each does", () => {
    expect(setting('vimModeStyle')?.options.map((option) => option.value)).toEqual([
      'badge',
      'border',
      'bar',
    ]);
    expect(setting('vimModeStyle')?.options[2]?.description).toMatch(/whole bar/u);
    expect(setting('vimModeStyle')?.default).toBe('"badge"');
  });

  it("offers the status bar's ids as entries and its colour keys as members", () => {
    expect(setting('statusBarItems')?.entries?.options).toHaveLength(13);
    expect(setting('statusBarColors')?.members?.options.map((option) => option.value)).toContain(
      'vimMode.insert',
    );
  });

  it('offers the registered themes as the theme setting’s values', () => {
    expect(setting('theme')?.options).toEqual([
      { value: 'tyto-light', description: 'Tyto Light, a light theme.' },
      { value: 'nord', description: 'Nord, a dark theme.' },
    ]);
  });

  it('says a bounded number and a boolean in words', () => {
    expect(setting('iconStrokeWidth')?.type).toBe('number from 0.75 to 2');
    expect(setting('queueAutoRun')?.options.map((option) => option.value)).toEqual([true, false]);
  });
});
