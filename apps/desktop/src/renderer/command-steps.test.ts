import { describe, expect, it } from 'vitest';

import { expandHistory, historyReference, parseCommandLine } from './command-steps.js';

/** The command panel's line as steps (TYTO-535, ADR 0200): `&&`, quotes and `!N`. */

const texts = (line: string) => {
  const parsed = parseCommandLine(line);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.steps.map((step) => step.words.map((word) => word.text));
};

describe('parseCommandLine', () => {
  it('splits on && with or without spaces around it', () => {
    expect(texts('check a.brief && render a.brief')).toEqual([
      ['check', 'a.brief'],
      ['render', 'a.brief'],
    ]);
    expect(texts('check a.brief&&render a.brief')).toEqual([
      ['check', 'a.brief'],
      ['render', 'a.brief'],
    ]);
  });

  it('keeps an && inside quotes as part of the word', () => {
    expect(texts('render "a && b.brief"')).toEqual([['render', 'a && b.brief']]);
  });

  it('marks a word quoted when any part of it was, so a quoted * is never a glob', () => {
    const parsed = parseCommandLine('render "*.brief" *.brief x"y"');
    expect(parsed.ok && parsed.steps[0]?.words).toEqual([
      { text: 'render', quoted: false },
      { text: '*.brief', quoted: true },
      { text: '*.brief', quoted: false },
      { text: 'xy', quoted: true },
    ]);
  });

  it('keeps each step as typed, trimmed, for its header and the history', () => {
    const parsed = parseCommandLine('  check a.brief   &&  render "b c.brief" ');
    expect(parsed.ok && parsed.steps.map((step) => step.source)).toEqual([
      'check a.brief',
      'render "b c.brief"',
    ]);
  });

  it('refuses an && with nothing on one side, and says where', () => {
    expect(parseCommandLine('&& render')).toEqual({ ok: false, problem: 'empty-step', at: 0 });
    expect(parseCommandLine('check && && render')).toEqual({
      ok: false,
      problem: 'empty-step',
      at: 9,
    });
    expect(parseCommandLine('check &&  ')).toEqual({ ok: false, problem: 'empty-step', at: 6 });
  });

  it('refuses an unclosed quote at the quote', () => {
    expect(parseCommandLine('render "a.brief && check')).toEqual({
      ok: false,
      problem: 'unclosed-quote',
      at: 7,
    });
  });

  it('reads an empty line as no step', () => {
    expect(parseCommandLine('   ')).toEqual({ ok: true, steps: [] });
  });
});

describe('history references', () => {
  const step = (line: string) => {
    const parsed = parseCommandLine(line);
    if (!parsed.ok) throw new Error(parsed.problem);
    return parsed.steps[0]!;
  };

  it('reads !N as a whole unquoted step only', () => {
    expect(historyReference(step('!3'))).toBe(3);
    expect(historyReference(step('"!3"'))).toBeUndefined();
    expect(historyReference(step('!3 more'))).toBeUndefined();
    expect(historyReference(step('!x'))).toBeUndefined();
  });

  it('replaces !N with entry N, counted from 1, and gives the line the history keeps', () => {
    const history = ['check a.brief', 'render a.brief && check b.brief'];
    const parsed = parseCommandLine('!2 && history');
    if (!parsed.ok) throw new Error('parse');
    const expanded = expandHistory(parsed.steps, history);
    expect(expanded.ok && expanded.steps.map((each) => each.source)).toEqual([
      'render a.brief',
      'check b.brief',
      'history',
    ]);
    expect(expanded.ok && expanded.line).toBe('render a.brief && check b.brief && history');
  });

  it('refuses an entry the history does not have', () => {
    const parsed = parseCommandLine('!0');
    if (!parsed.ok) throw new Error('parse');
    expect(expandHistory(parsed.steps, ['a'])).toEqual({
      ok: false,
      problem: 'no-entry',
      entry: 0,
    });
    const far = parseCommandLine('!2');
    if (!far.ok) throw new Error('parse');
    expect(expandHistory(far.steps, ['a'])).toEqual({ ok: false, problem: 'no-entry', entry: 2 });
  });
});
