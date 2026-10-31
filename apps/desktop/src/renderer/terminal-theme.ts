import type { ITheme } from '@xterm/xterm';

/**
 * A terminal's colours, from the window's own tokens (TYTO-497, ADR 0164 decision 7): the same
 * sixteen the command panel's `ansi-*` classes use in `shell.css`, so a theme that changes its red
 * changes both, in light and dark alike. Black is the muted text and white the text, which keeps
 * both readable on either scheme's surface. A type import only: the xterm code stays out of the
 * window's start-up bundle.
 */

/** Reads one custom property off the page, already resolved by the theme in force. */
export type TokenReader = (name: string) => string;

export function terminalTheme(read: TokenReader): ITheme {
  const token = (name: string): string => read(`--tyto-${name}`).trim();
  const black = token('text-muted');
  const red = token('error');
  const green = token('success');
  const yellow = token('warning');
  const blue = token('info');
  const magenta = token('syntax-keyword');
  const cyan = token('syntax-constant');
  const white = token('text');
  return {
    background: token('surface'),
    foreground: white,
    cursor: white,
    cursorAccent: token('surface'),
    selectionBackground: token('selection'),
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: black,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: white,
  };
}

/** The code font and size the editor uses, which the settings may change (ADR 0099). */
export function terminalFont(read: TokenReader): { family: string; size: number } {
  const size = Number.parseFloat(read('--tyto-code-size'));
  return {
    family: read('--tyto-font-mono').trim() || 'monospace',
    size: Number.isFinite(size) && size > 0 ? size : 14,
  };
}
