import { describe, expect, it } from 'vitest';

import { ansiPresentation, applySgr, freshAnsiState, readAnsi } from './ansi.js';

/** A command's SGR colours, read into runs the command panel draws (TYTO-496). */

const ESC = '\u001b';

describe('reading a command’s colours', () => {
  it('turns SGR sequences into styled runs and resets on 0', () => {
    const runs = readAnsi(freshAnsiState(), `ok ${ESC}[31merror${ESC}[0m done`);
    expect(runs).toEqual([
      { text: 'ok ', style: {} },
      { text: 'error', style: { foreground: 1 } },
      { text: ' done', style: {} },
    ]);
  });

  it('reads bright, background, bold and the 256 and true colours', () => {
    expect(applySgr({}, '1;92;44')).toEqual({ bold: true, foreground: 10, background: 4 });
    expect(applySgr({}, '38;5;196')).toEqual({ foreground: '#ff0000' });
    expect(applySgr({}, '38;5;244')).toEqual({ foreground: '#808080' });
    expect(applySgr({}, '48;2;12;34;56')).toEqual({ background: '#0c2238' });
    expect(applySgr({ bold: true, foreground: 1 }, '22;39')).toEqual({});
  });

  it('drops every escape that is not a colour, instead of printing it', () => {
    const runs = readAnsi(
      freshAnsiState(),
      `${ESC}[2K${ESC}[1Gline${ESC}]0;title${ESC}\\ and ${ESC}]8;;https://x\u0007link`,
    );
    expect(runs.map((run) => run.text).join('')).toBe('line and link');
  });

  it('carries a style, and an escape cut in half, into the next chunk', () => {
    const state = freshAnsiState();
    expect(readAnsi(state, `a${ESC}[3`)).toEqual([{ text: 'a', style: {} }]);
    expect(readAnsi(state, `3mb`)).toEqual([{ text: 'b', style: { foreground: 3 } }]);
    expect(readAnsi(state, 'c')).toEqual([{ text: 'c', style: { foreground: 3 } }]);
  });
});

describe('drawing a run', () => {
  it('uses the theme’s classes for a named colour and inline CSS for an exact one', () => {
    expect(ansiPresentation({ foreground: 9, bold: true })).toEqual({
      classes: 'ansi-fg-9 ansi-bold',
      css: '',
    });
    expect(ansiPresentation({ foreground: '#ff0000' })).toEqual({
      classes: '',
      css: 'color: #ff0000',
    });
  });

  it('swaps the two colours for inverse', () => {
    expect(ansiPresentation({ inverse: true, foreground: 2 })).toEqual({
      classes: 'ansi-inverse ansi-bg-2',
      css: '',
    });
  });
});
