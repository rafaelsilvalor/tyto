import { describe, expect, it } from 'vitest';

import { freshAnsiState } from './ansi.js';
import {
  EMPTY_SCROLLBACK,
  SCROLLBACK_LIMIT,
  type Scrollback,
  findMatches,
  lineText,
  piecesOf,
  scrollbackText,
  withNote,
  withOutput,
} from './command-output.js';

/** A session's scrollback (TYTO-496): chunks into lines, the cap, find and the pieces drawn. */

const texts = (scrollback: Scrollback) =>
  scrollback.lines.map((line) => `${line.stream}:${lineText(line)}`);

describe('building lines from chunks', () => {
  it('joins a line printed in two chunks and starts one per line break', () => {
    const ansi = freshAnsiState();
    let back = withOutput(EMPTY_SCROLLBACK, 'out', 'rendering ', ansi);
    back = withOutput(back, 'out', 'cartaz\r\nwrote 2 files\n', ansi);
    back = withOutput(back, 'out', 'done', ansi);
    expect(texts(back)).toEqual(['out:rendering cartaz', 'out:wrote 2 files', 'out:done']);
    expect(back.open).toBe(true);
  });

  it('keeps a line open across an empty chunk', () => {
    const ansi = freshAnsiState();
    let back = withOutput(EMPTY_SCROLLBACK, 'out', 'half', ansi);
    back = withOutput(back, 'out', '', ansi);
    back = withOutput(back, 'out', ' line\n', ansi);
    expect(texts(back)).toEqual(['out:half line']);
  });

  it('starts a new line when the other stream prints, and for the panel’s own notes', () => {
    const ansi = freshAnsiState();
    let back = withOutput(EMPTY_SCROLLBACK, 'out', 'progress', ansi);
    back = withOutput(back, 'err', 'error E_X\n', ansi);
    back = withNote(back, '— ended with exit code 1');
    expect(texts(back)).toEqual(['out:progress', 'err:error E_X', 'note:— ended with exit code 1']);
  });

  it('redraws a line on a carriage return, as a progress counter does', () => {
    const back = withOutput(EMPTY_SCROLLBACK, 'out', '1/3\r2/3\r3/3\n', freshAnsiState());
    expect(texts(back)).toEqual(['out:3/3']);
  });

  it('lets the oldest lines go past the limit, and counts them', () => {
    const many = Array.from({ length: SCROLLBACK_LIMIT + 5 }, (_, index) => `l${String(index)}`);
    const back = withOutput(EMPTY_SCROLLBACK, 'out', `${many.join('\n')}\n`, freshAnsiState());
    expect(back.lines).toHaveLength(SCROLLBACK_LIMIT);
    expect(back.dropped).toBe(5);
    expect(lineText(back.lines[0]!)).toBe('l5');
  });

  it('copies as plain text, without the colours', () => {
    const back = withOutput(
      EMPTY_SCROLLBACK,
      'out',
      '\u001b[31mred\u001b[0m\nplain\n',
      freshAnsiState(),
    );
    expect(scrollbackText(back)).toBe('red\nplain');
  });
});

describe('finding in the output', () => {
  it('finds every match in every line, ignoring case', () => {
    const back = withOutput(
      EMPTY_SCROLLBACK,
      'out',
      'Error one\nno\nerror, error\n',
      freshAnsiState(),
    );
    expect(findMatches(back, 'ERROR')).toEqual([
      { line: 0, start: 0, end: 5 },
      { line: 2, start: 0, end: 5 },
      { line: 2, start: 7, end: 12 },
    ]);
    expect(findMatches(back, '')).toEqual([]);
  });
});

describe('cutting a line into pieces', () => {
  it('cuts at styles, links and matches, keeping each piece’s three', () => {
    const runs = [
      { text: 'error ', style: { foreground: 1 } },
      { text: 'a.brief:3 failed', style: {} },
    ];
    const link = { kind: 'path', segments: ['a.brief'], line: 3 } as const;
    const pieces = piecesOf(runs, [{ start: 6, end: 15, link }], [{ start: 3, end: 8, index: 4 }]);
    expect(pieces).toEqual([
      { text: 'err', style: { foreground: 1 } },
      { text: 'or ', style: { foreground: 1 }, match: 4 },
      { text: 'a.', style: {}, link, match: 4 },
      { text: 'brief:3', style: {}, link },
      { text: ' failed', style: {} },
    ]);
  });
});
