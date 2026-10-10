// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyTheme, themeSheet } from './theme.js';

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
