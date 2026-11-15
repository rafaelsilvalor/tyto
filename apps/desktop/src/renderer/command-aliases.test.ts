import { describe, expect, it } from 'vitest';

import type { PanelAlias } from '../../shared/command-aliases.js';
import { expandAliases, expandVariables } from './command-aliases.js';
import { type LineStep, parseCommandLine } from './command-steps.js';

/** Aliases and variables in the command panel (TYTO-536, ADR 0200 note of 2026-11-15). */

const stepsOf = (line: string): readonly LineStep[] => {
  const parsed = parseCommandLine(line);
  if (!parsed.ok) throw new Error(`unreadable: ${line}`);
  return parsed.steps;
};

const alias = (name: string, body: string, definedIn: PanelAlias['definedIn'] = 'user') => ({
  name,
  body,
  definedIn,
});

const RESERVED = new Set(['ls', 'cd', 'alias', 'tyto']);
const reserved = (name: string): boolean => RESERVED.has(name);

const texts = (step: LineStep | undefined): string[] => (step?.words ?? []).map((w) => w.text);

describe('expandAliases', () => {
  it('replaces the first word by the alias line, keeps the words after it, and names the alias', () => {
    const expanded = expandAliases(
      stepsOf('entrega cartaz.brief'),
      [alias('entrega', 'render --delivery', 'workspace')],
      reserved,
    );
    expect(expanded.ok && expanded.steps.map(texts)).toEqual([
      ['render', '--delivery', 'cartaz.brief'],
    ]);
    expect(expanded.ok && expanded.steps[0]?.origin).toEqual({
      alias: 'entrega',
      definedIn: 'workspace',
    });
    expect(expanded.ok && expanded.steps[0]?.source).toBe('render --delivery cartaz.brief');
  });

  it('expands once: an alias whose line starts with another alias is not looked up again', () => {
    const expanded = expandAliases(
      stepsOf('a'),
      [alias('a', 'b x'), alias('b', 'render --trust')],
      reserved,
    );
    expect(expanded.ok && expanded.steps.map(texts)).toEqual([['b', 'x']]);
  });

  it('takes an alias line literally: its $ is never a variable', () => {
    const expanded = expandAliases(stepsOf('show'), [alias('show', 'render $file')], reserved);
    const words = expanded.ok ? (expanded.steps[0]?.words ?? []) : [];
    expect(words.map((word) => word.dollars)).toEqual([undefined, undefined]);
    const read = expandVariables(words, new Map([['file', 'other.brief']]));
    expect(read.ok && read.words.map((word) => word.text)).toEqual(['render', '$file']);
  });

  it('spreads an alias holding && into its steps, the typed words after the last', () => {
    const expanded = expandAliases(
      stepsOf('both x.brief && ls'),
      [alias('both', 'check x.brief && render')],
      reserved,
    );
    expect(expanded.ok && expanded.steps.map(texts)).toEqual([
      ['check', 'x.brief'],
      ['render', 'x.brief'],
      ['ls'],
    ]);
  });

  it('never expands a quoted first word, a word after the first, or a reserved name', () => {
    const aliases = [alias('entrega', 'render'), alias('ls', 'render --trust')];
    for (const line of ['"entrega" x', 'check entrega', 'ls', 'tyto entrega']) {
      const expanded = expandAliases(stepsOf(line), aliases, reserved);
      expect(expanded.ok && expanded.steps.map(texts), line).toEqual(stepsOf(line).map(texts));
    }
  });

  it('refuses a line whose alias cannot be read, naming it', () => {
    expect(expandAliases(stepsOf('bad'), [alias('bad', "render 'open")], reserved)).toEqual({
      ok: false,
      alias: 'bad',
      at: 7,
    });
  });
});

describe('expandVariables', () => {
  const variables = new Map([
    ['brief', 'cartaz.brief'],
    ['odd', 'a && b "c'],
  ]);
  const read = (line: string) => {
    const words = stepsOf(line)[0]?.words ?? [];
    return expandVariables(words, variables);
  };

  it('replaces $name inside a word, unquoted or in double quotes', () => {
    const answer = read('render $brief "entregas/$brief" x$brief.png');
    expect(answer.ok && answer.words.map((word) => word.text)).toEqual([
      'render',
      'cartaz.brief',
      'entregas/cartaz.brief',
      'xcartaz.brief.png',
    ]);
  });

  it('keeps a $ in single quotes, and a $ with no name, as they are', () => {
    const answer = read("render '$brief' $ $5");
    expect(answer.ok && answer.words.map((word) => word.text)).toEqual([
      'render',
      '$brief',
      '$',
      '$5',
    ]);
  });

  it('never lets a value add a word, an && or a quote: it is one quoted word', () => {
    const answer = read('render $odd');
    expect(answer.ok && answer.words).toEqual([
      { text: 'render', quoted: false },
      { text: 'a && b "c', quoted: true },
    ]);
  });

  it('refuses a name this session never set, the environment included', () => {
    expect(read('render $HOME')).toEqual({ ok: false, name: 'HOME' });
  });
});
