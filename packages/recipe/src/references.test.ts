import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import { leavesFolder, referencesOf } from './references.js';

function recipe(lines: readonly string[]) {
  const parsed = parseRecipe(['recipe probe', ...lines].join('\n'));
  if (!parsed.ok) throw new Error(parsed.error.map((problem) => problem.message).join('\n'));
  return parsed.value;
}

describe('referencesOf', () => {
  it('lists the data files and included recipes, in the order written', () => {
    const references = referencesOf(
      recipe([
        'run campaign-map team=design',
        'rules into=kind using=@./company.vocab.json#/rules/kinds',
        'map status using=@../shared/flows.json#/map also=@./company.vocab.json into=target',
        'show board by=status order=@./order.json',
      ]),
    );
    expect(references.recipes.map((reference) => reference.name)).toEqual(['campaign-map']);
    expect(
      references.data.map(({ path, pointer, verb, leavesFolder: leaves }) => [
        path,
        pointer,
        verb,
        leaves,
      ]),
    ).toEqual([
      ['./company.vocab.json', '/rules/kinds', 'rules', false],
      ['../shared/flows.json', '/map', 'map', true],
      ['./company.vocab.json', '', 'map', false],
      ['./order.json', '', 'show', false],
    ]);
    expect(references.refused).toEqual([]);
  });

  it('points each reference at the argument that wrote it', () => {
    const text = 'recipe probe\nrules into=kind using=@./v.vocab.json#/rules/kinds';
    const parsed = parseRecipe(text);
    if (!parsed.ok) throw new Error('does not parse');
    const [reference] = referencesOf(parsed.value).data;
    expect(reference && text.slice(reference.range.start, reference.range.end)).toBe(
      'using=@./v.vocab.json#/rules/kinds',
    );
  });

  it('reports a reference it cannot read instead of listing it', () => {
    const references = referencesOf(recipe(['map status using=@C:/elsewhere.json into=x']));
    expect(references.data).toEqual([]);
    expect(references.refused.map((reference) => reference.text)).toEqual(['@C:/elsewhere.json']);
  });

  it('reads no reference inside inline JSON', () => {
    const references = referencesOf(
      recipe(['rules into=kind using=[{"when": "", "set": {"kind": "@./not-a-file.json"}}]']),
    );
    expect(references.data).toEqual([]);
  });
});

describe('leavesFolder', () => {
  it.each([
    ['./a.json', false],
    ['a/../b.json', false],
    ['../a.json', true],
    ['./a/../../b.json', true],
    ['a\\..\\..\\b.json', true],
  ])('%s leaves the folder: %s', (path, expected) => {
    expect(leavesFolder(path)).toBe(expected);
  });
});
