import { describe, expect, it } from 'vitest';

import { freshAnsiState, readAnsi } from './ansi.js';
import type { OutputLine, OutputStream } from './command-output.js';
import { readLine, readLines } from './command-tone.js';

/** What a line means, not the stream it came on (TYTO-725). */

const line = (text: string, stream: OutputStream = 'err'): OutputLine => ({
  stream,
  runs: readAnsi(freshAnsiState(), text),
});

describe('reading a line', () => {
  it('reads a diagnostic with its place as an error, and finds its code', () => {
    const text = 'cartaz.brief:5:1: error E_SLOT_MISSING The slot title is required.';
    const reading = readLine(line(text));
    expect(reading.tone).toBe('error');
    expect(text.slice(reading.code!.start, reading.code!.end)).toBe('E_SLOT_MISSING');
  });

  it('reads a warning, on stdout as on stderr', () => {
    for (const stream of ['out', 'err'] as const) {
      const reading = readLine(line('a.brief:2:3: warning W_FONT_SUBSTITUTED Used Sans.', stream));
      expect(reading.tone).toBe('warning');
    }
  });

  it('reads a diagnostic with no place, or a place with no line, or a Windows path', () => {
    expect(readLine(line('error E_TEMPLATE_UNKNOWN No template named poster.')).tone).toBe('error');
    expect(readLine(line('a.brief: warning W_THING Something.')).tone).toBe('warning');
    const windows = 'C:\\work\\a.brief:5:1: error E_X Broken.';
    const reading = readLine(line(windows));
    expect(reading.tone).toBe('error');
    expect(windows.slice(reading.code!.start, reading.code!.end)).toBe('E_X');
  });

  it('leaves plain stderr plain: the question plugin install asks is not an error', () => {
    expect(readLine(line('This plugin asks to read files. Install it? [y/N]')).tone).toBe('plain');
    expect(readLine(line('an error happened somewhere')).tone).toBe('plain');
    expect(readLine(line('error: E_LOWERCASE is not a code')).tone).toBe('plain');
  });

  it("lets a command's own colours win", () => {
    expect(readLine(line('\u001b[32mInstalled.\u001b[0m')).tone).toBe('ansi');
    expect(readLine(line('\u001b[41m \u001b[0m done')).tone).toBe('ansi');
    expect(readLine(line('\u001b[31merror E_X red already\u001b[0m'))).toEqual({ tone: 'ansi' });
  });

  it('reads a line only bold or underlined by its text, as it carries no colour', () => {
    expect(readLine(line('\u001b[1merror E_X Bold.\u001b[0m')).tone).toBe('error');
    expect(readLine(line('\u001b[4mJust underlined\u001b[0m')).tone).toBe('plain');
  });

  it("reads the panel's own lines as notes", () => {
    expect(readLine(line('error E_X looks like one', 'note')).tone).toBe('note');
  });
});

describe('a hint under a diagnostic', () => {
  it('is a hint right under its diagnostic, and under another hint of it', () => {
    const tones = readLines([
      line('a.brief:1:1: error E_X Broken.'),
      line('    Add the missing slot.'),
      line('    Or remove the field.'),
      line('done'),
    ]).map((reading) => reading.tone);
    expect(tones).toEqual(['error', 'hint', 'hint', 'plain']);
  });

  it('is plain anywhere else, indented or not', () => {
    const tones = readLines([line('Usage:'), line('    tyto render <brief>')]).map(
      (reading) => reading.tone,
    );
    expect(tones).toEqual(['plain', 'plain']);
    expect(readLine(line('    indented'), { tone: 'plain' }).tone).toBe('plain');
  });
});
