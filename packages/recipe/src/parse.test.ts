import type { SourceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';

const slice = (text: string, range: SourceRange | undefined) =>
  range === undefined ? undefined : text.slice(range.start, range.end);

describe('parseRecipe', () => {
  const text = [
    '# a comment line',
    'recipe open-work',
    '  | The open work of one project.',
    '  | Second line.',
    'param project = DEMO',
    'param owner',
    '',
    'where project = {project} AND status != done',
    'demo.pull  left="kind = ad" bring=key,status extra',
  ].join('\n');

  it('reads the header, the description, the parameters and one step per line', () => {
    const parsed = parseRecipe(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { name, description, params, steps } = parsed.value;
    expect(name).toBe('open-work');
    expect(description).toBe('The open work of one project.\nSecond line.');
    expect(params.map(({ name: param, defaultValue }) => [param, defaultValue])).toEqual([
      ['project', 'DEMO'],
      ['owner', undefined],
    ]);
    expect(steps.map((step) => step.verb)).toEqual(['where', 'demo.pull']);
    expect(steps[0]?.text).toBe('project = {project} AND status != done');
    expect(slice(text, steps[0]?.textRange)).toBe(steps[0]?.text);
    expect(slice(text, steps[1]?.verbRange)).toBe('demo.pull');
  });

  it('splits words, quoted values and name=value pairs, each with its range', () => {
    const parsed = parseRecipe(text);
    if (!parsed.ok) throw new Error('expected the recipe to parse');
    const pull = parsed.value.steps[1];
    expect(pull?.named.map(({ name, value }) => [name, value])).toEqual([
      ['left', 'kind = ad'],
      ['bring', 'key,status'],
    ]);
    expect(slice(text, pull?.named[0]?.range)).toBe('left="kind = ad"');
    expect(pull?.positional.map(({ value }) => value)).toEqual(['extra']);
    expect(slice(text, pull?.positional[0]?.range)).toBe('extra');
  });

  it('keeps offsets true across Windows line breaks', () => {
    const crlf = 'recipe x\r\nshow table\r\n';
    const parsed = parseRecipe(crlf);
    if (!parsed.ok) throw new Error('expected the recipe to parse');
    expect(slice(crlf, parsed.value.steps[0]?.range)).toBe('show table');
  });

  it.each([
    ['a file without its header', 'show table', 'show table', "starts with a 'recipe <name>'"],
    ['an empty file', '', '', 'the file is empty'],
    ['a quote left open', 'recipe x\nkeep "open', '"open', 'quoted value is not closed'],
    ['a second header', 'recipe x\nrecipe y', 'recipe y', 'holds one recipe'],
    ['a parameter declared twice', 'recipe x\nparam a\nparam a = 1', 'param a = 1', 'twice'],
    ['a parameter without a name', 'recipe x\nparam = 1', 'param = 1', "'param <name>'"],
    ['a description after a step', 'recipe x\nshow table\n| late', '| late', 'right under'],
  ])('refuses %s, at the line that is wrong', (_case, source, wrong, message) => {
    const parsed = parseRecipe(source);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error[0]?.code).toBe('E_RECIPE_SYNTAX');
    expect(parsed.error[0]?.message).toContain(message);
    expect(slice(source, parsed.error[0]?.range)).toBe(wrong);
  });

  it('refuses a placeholder that no param line declares, pointing at the placeholder', () => {
    const source = 'recipe x\nparam a\nwhere b = {a} AND c = {missing}';
    const parsed = parseRecipe(source);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.map(({ code }) => code)).toEqual(['E_RECIPE_PARAM']);
    expect(slice(source, parsed.error[0]?.range)).toBe('{missing}');
  });
});
