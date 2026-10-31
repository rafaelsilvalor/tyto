import { describe, expect, it } from 'vitest';

import { joinCommandLine, splitCommandLine } from './command-words.js';

/**
 * The line typed in the command panel, as the words `cli:run` takes (TYTO-496, ADR 0159
 * decision 8): spaces separate, quotes keep a word whole, and nothing else means anything.
 */

const words = (line: string): readonly string[] => {
  const split = splitCommandLine(line);
  if (!split.ok) throw new Error(`refused: ${line}`);
  return split.words;
};

describe('splitting the command line', () => {
  it('splits on runs of spaces and drops a leading tyto', () => {
    expect(words('  render   lista.brief --types svg ')).toEqual([
      'render',
      'lista.brief',
      '--types',
      'svg',
    ]);
    expect(words('tyto render lista.brief')).toEqual(['render', 'lista.brief']);
  });

  it('keeps a quoted path with spaces as one word', () => {
    expect(words('render "C:\\Meus documentos\\cartaz novo.brief" --out \'saída final\'')).toEqual([
      'render',
      'C:\\Meus documentos\\cartaz novo.brief',
      '--out',
      'saída final',
    ]);
  });

  it('keeps every backslash: a Windows path is not an escape', () => {
    expect(words('check C:\\briefs\\a.brief')).toEqual(['check', 'C:\\briefs\\a.brief']);
  });

  it('gives a shell character no meaning', () => {
    expect(words('render a.brief | rm -rf $HOME && *.brief > out')).toEqual([
      'render',
      'a.brief',
      '|',
      'rm',
      '-rf',
      '$HOME',
      '&&',
      '*.brief',
      '>',
      'out',
    ]);
  });

  it('joins quotes inside a word, and keeps an empty pair as an empty word', () => {
    expect(words('--title="Hello world" ""')).toEqual(['--title=Hello world', '']);
    expect(words(`say 'he said "hi"'`)).toEqual(['say', 'he said "hi"']);
  });

  it('refuses a quote that is never closed, naming where it opened', () => {
    expect(splitCommandLine('render "C:\\Meus documentos\\cartaz.brief')).toEqual({
      ok: false,
      problem: 'unclosed-quote',
      at: 7,
    });
    expect(splitCommandLine("check 'a.brief").ok).toBe(false);
  });
});

describe('joining words back into a line', () => {
  it('quotes only the words that need it, and splits back to the same words', () => {
    const original = ['render', 'C:\\Meus docs\\a.brief', '', 'say "hi"', '--types', 'svg'];
    const line = joinCommandLine(original);
    expect(line).toBe(`render "C:\\Meus docs\\a.brief" "" 'say "hi"' --types svg`);
    expect(words(line)).toEqual(original);
  });
});
