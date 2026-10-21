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
      'stickyScroll',
      'formatBriefOnSave',
      'tabSize',
      'briefColumns',
      'zoom',
      'uiFontFamily',
      'uiFontSize',
      'codeFontFamily',
      'codeFontSize',
      'fontSizes',
      'fontFamilies',
    ]);
  });

  it('explains the zoom, the two faces and the two sizes (TYTO-272)', () => {
    expect(setting('zoom')?.default).toBe('0');
    expect(setting('zoom')?.options.map((option) => option.value)).toEqual([0, 1, 2, -1]);
    expect(setting('zoom')?.description).toMatch(/steps of 20%/u);
    expect(setting('uiFontFamily')?.default).toBe('"Source Sans 3"');
    expect(setting('codeFontFamily')?.default).toBe('"IBM Plex Mono"');
    expect(setting('uiFontSize')?.description).toMatch(/9 to 24/u);
    expect(setting('codeFontSize')?.description).toMatch(/9 to 32/u);
    expect(setting('codeFontFamily')?.description).toMatch(/does not have/u);
  });

  it('offers formatBriefOnSave and tabSize with what each value does (TYTO-297)', () => {
    const onSave = setting('formatBriefOnSave');
    expect(onSave?.options.map((option) => option.value)).toEqual([true, false]);
    expect(onSave?.options[0]?.description).toMatch(/blank lines/u);
    expect(onSave?.default).toBe('false');
    const tabSize = setting('tabSize');
    expect(tabSize?.options.map((option) => option.value)).toEqual([2, 4]);
    expect(tabSize?.default).toBe('2');
  });

  it('offers the four briefColumns looks, each saying what it does (TYTO-298)', () => {
    const columns = setting('briefColumns');
    expect(columns?.options.map((option) => option.value)).toEqual([
      'off',
      'separator',
      'alternate',
      'perColumn',
    ]);
    expect(columns?.options[2]?.description).toMatch(/barely differs/u);
    expect(columns?.options[3]?.description).toMatch(/below comfortable reading contrast/u);
    expect(columns?.default).toBe('"separator"');
  });

  it('offers stickyScroll on and off, each with what it does (TYTO-295)', () => {
    const sticky = setting('stickyScroll');
    expect(sticky?.options.map((option) => option.value)).toEqual([true, false]);
    expect(sticky?.options[0]?.description).toMatch(/pinned/u);
    expect(sticky?.default).toBe('true');
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
    expect(setting('statusBarItems')?.entries?.options).toHaveLength(14);
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
