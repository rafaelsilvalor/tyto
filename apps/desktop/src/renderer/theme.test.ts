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
