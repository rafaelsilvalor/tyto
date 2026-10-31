import { describe, expect, it } from 'vitest';

import { terminalFont, terminalTheme } from './terminal-theme.js';

/** Two schemes' tokens, as `getComputedStyle` would answer them, with its leading space. */
const LIGHT: Record<string, string> = {
  '--tyto-surface': ' #fafafa',
  '--tyto-text': ' #242529',
  '--tyto-text-muted': ' #58585a',
  '--tyto-selection': ' #cdd6f8',
  '--tyto-error': ' #c62828',
  '--tyto-success': ' #2e7d32',
  '--tyto-warning': ' #8a6100',
  '--tyto-info': ' #1565c0',
  '--tyto-syntax-keyword': ' #7b1fa2',
  '--tyto-syntax-constant': ' #00838f',
  '--tyto-font-mono': " 'IBM Plex Mono', monospace",
  '--tyto-code-size': ' 14px',
};
const DARK: Record<string, string> = {
  ...LIGHT,
  '--tyto-surface': ' #1e1f22',
  '--tyto-text': ' #e6e6e8',
};

describe("a terminal's colours (ADR 0164 decision 7)", () => {
  it("follow the window's tokens, the command panel's sixteen, in light and dark", () => {
    const light = terminalTheme((name) => LIGHT[name] ?? '');
    const dark = terminalTheme((name) => DARK[name] ?? '');

    expect(light).toMatchObject({
      background: '#fafafa',
      foreground: '#242529',
      selectionBackground: '#cdd6f8',
      black: '#58585a',
      red: '#c62828',
      green: '#2e7d32',
      yellow: '#8a6100',
      blue: '#1565c0',
      magenta: '#7b1fa2',
      cyan: '#00838f',
      white: '#242529',
      brightRed: '#c62828',
    });
    expect(dark.background).toBe('#1e1f22');
    expect(dark.foreground).toBe('#e6e6e8');
    expect(dark.cursor).toBe(dark.foreground);
  });

  it("use the editor's code font and size, with a fallback for an unreadable size", () => {
    expect(terminalFont((name) => LIGHT[name] ?? '')).toEqual({
      family: "'IBM Plex Mono', monospace",
      size: 14,
    });
    expect(terminalFont(() => '')).toEqual({ family: 'monospace', size: 14 });
  });
});
