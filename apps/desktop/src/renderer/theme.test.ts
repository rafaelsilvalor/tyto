// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyTheme, themeSheet, withThemeRows } from './theme.js';

/** Invented colours: what matters is where each lands. */
const APPLIED = {
  light: { id: 'tyto-light', colors: { surface: '#fafafa', text: '#242529' } },
  dark: { id: 'tyto-dark', colors: { surface: '#282c33', text: '#dce0e5' } },
};

describe('the theme sheet (TYTO-208)', () => {
  it('sets light at the root and dark under the system dark mode, as the token file does', () => {
    expect(themeSheet(APPLIED)).toBe(
      [
        ':root:root {',
        '  --tyto-surface: #fafafa;',
        '  --tyto-text: #242529;',
        '}',
        '@media (prefers-color-scheme: dark) {',
        ':root:root {',
        '  --tyto-surface: #282c33;',
        '  --tyto-text: #dce0e5;',
        '}',
        '}',
      ].join('\n'),
    );
  });

  it('writes one sheet, and replaces it rather than adding a second', () => {
    applyTheme(APPLIED);
    applyTheme({ ...APPLIED, light: { id: 'x', colors: { surface: '#000000' } } });
    const sheets = document.head.querySelectorAll('style#tyto-theme');
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.textContent).toContain('--tyto-surface: #000000;');
  });
});

describe('the icon stroke on the theme sheet (TYTO-288)', () => {
  it('sets the setting over the token default, once, for both modes', () => {
    const sheet = themeSheet({ ...APPLIED, iconStrokeWidth: 1 });
    expect(sheet.match(/--tyto-icon-stroke: 1;/g)).toHaveLength(1);
    expect(sheet.indexOf('--tyto-icon-stroke')).toBeLessThan(sheet.indexOf('@media'));
  });

  it('leaves the token default alone when the answer carries none', () => {
    expect(themeSheet(APPLIED)).not.toContain('--tyto-icon-stroke');
  });
});

describe("vim's bar style on the theme sheet (TYTO-301, ADR 0091)", () => {
  const MODES = {
    surface: '#fafafa',
    text: '#242529',
    'accent-text': '#ffffff',
    'status-bar-vim-normal': '#506ee0',
    'status-bar-vim-insert': '#4b8340',
    'status-bar-vim-visual': '#a449ab',
    'status-bar-vim-replace': '#c4473a',
  };
  const APPLIED_MODES = {
    light: { id: 'tyto-light', colors: MODES },
    dark: { id: 'tyto-dark', colors: { ...MODES, 'status-bar-vim-insert': '#ffe066' } },
  };

  it('writes the bar’s text for each mode only under the bar style', () => {
    expect(themeSheet({ ...APPLIED_MODES, vimModeStyle: 'badge' })).not.toContain('mode-text');
    expect(themeSheet({ ...APPLIED_MODES, vimModeStyle: 'border' })).not.toContain('mode-text');
    const sheet = themeSheet({ ...APPLIED_MODES, vimModeStyle: 'bar' });
    expect(sheet.match(/--status-bar-mode-text/g)).toHaveLength(8);
  });

  it('chooses, per theme and mode, the candidate that reads best on the mode’s colour', () => {
    const [light = '', dark = ''] = themeSheet({ ...APPLIED_MODES, vimModeStyle: 'bar' }).split(
      '@media',
    );
    expect(light).toContain(
      ".shell__foot.shell__foot[data-vim-style='bar'][data-vim-mode='insert'] {\n" +
        '  --status-bar-mode-text: #ffffff;\n}',
    );
    // A pale INSERT in the dark block: the dark text reads best on it.
    expect(dark).toContain(
      ".shell__foot.shell__foot[data-vim-style='bar'][data-vim-mode='insert'] {\n" +
        '  --status-bar-mode-text: #242529;\n}',
    );
  });

  it('follows an override of the mode’s colour', () => {
    const sheet = themeSheet({
      ...APPLIED_MODES,
      vimModeStyle: 'bar',
      statusBarColors: { 'vimMode.normal': '#ffe066' },
    });
    expect(sheet).toContain(
      ".shell__foot.shell__foot[data-vim-style='bar'][data-vim-mode='normal'] {\n" +
        '  --status-bar-mode-text: #242529;\n}',
    );
  });
});

describe('the status bar colours on the theme sheet (TYTO-301, ADR 0091)', () => {
  const COLOURED = {
    light: {
      id: 'tyto-light',
      colors: { surface: '#fafafa', text: '#242529', 'accent-text': '#ffffff' },
    },
    dark: {
      id: 'tyto-dark',
      colors: { surface: '#282c33', text: '#dce0e5', 'accent-text': '#1c1f24' },
    },
  };
  const sheetWith = (statusBarColors: Record<string, string>) =>
    themeSheet({ ...COLOURED, statusBarColors });

  it('writes nothing for the bar when the setting is empty or absent', () => {
    expect(sheetWith({})).not.toContain('shell__foot');
    expect(themeSheet(COLOURED)).not.toContain('shell__foot');
  });

  it('sets the bar’s colours on the bar, in both modes, over the theme', () => {
    const sheet = sheetWith({
      background: '#1e3a5f',
      foreground: '#f0f0f0',
      itemHoverBackground: '#2b4f7e',
      itemActiveForeground: '#ffffff',
    });
    const [light = '', dark = ''] = sheet.split('@media');
    for (const block of [light, dark]) {
      expect(block).toContain('.shell__foot.shell__foot {');
      expect(block).toContain('--tyto-status-bar: #1e3a5f;');
      expect(block).toContain('--tyto-status-bar-text: #f0f0f0;');
      expect(block).toContain('--status-bar-hover: #2b4f7e;');
      expect(block).toContain('--status-bar-on-text: #ffffff;');
    }
  });

  it('gives an item its own text colour on that item alone', () => {
    expect(sheetWith({ 'item.problems': '#ffd866' })).toContain(
      ".shell__foot [data-item='problems'] {\n  --status-bar-item-text: #ffd866;\n}",
    );
  });

  it('colours a vim badge and picks, per theme, the text that reads best on it', () => {
    // A light yellow badge: the dark text of each theme reads best on it, not white.
    const [light = '', dark = ''] = sheetWith({ 'vimMode.insert': '#ffe066' }).split('@media');
    expect(light).toContain('--tyto-status-bar-vim-insert: #ffe066;');
    expect(light).toContain('--tyto-status-bar-vim-insert-text: #242529;');
    expect(dark).toContain('--tyto-status-bar-vim-insert: #ffe066;');
    expect(dark).toContain('--tyto-status-bar-vim-insert-text: #1c1f24;');
    // And a dark badge takes the light candidate.
    expect(sheetWith({ 'vimMode.normal': '#1d4ed8' })).toContain(
      '--tyto-status-bar-vim-normal-text: #ffffff;',
    );
  });
});

describe("the theme's rows in the problems panel (TYTO-208)", () => {
  const row = (code: string) => ({ code, message: code });

  it('replaces the last answer’s theme rows and keeps every other row', () => {
    const before = [row('E_FILE_NOT_FOUND'), row('E_THEME_INVALID'), row('W_THEME_TOKEN_UNKNOWN')];
    expect(withThemeRows(before, [row('W_THEME_COLOR_INVALID')]).map(({ code }) => code)).toEqual([
      'E_FILE_NOT_FOUND',
      'W_THEME_COLOR_INVALID',
    ]);
    expect(withThemeRows(before, []).map(({ code }) => code)).toEqual(['E_FILE_NOT_FOUND']);
  });
});
