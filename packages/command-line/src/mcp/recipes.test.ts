import type { RunnerCell } from '@tyto/io';
import { describe, expect, it } from 'vitest';

import { RECIPE_TEXT_MAX, cellAnswer } from './recipes.js';

/** TYTO-727, ADR 0199: what `run_recipe` answers of a `set` cell. */
describe("run_recipe's answer of a set cell", () => {
  const source = { shown: 'recipes/named.recipe', text: 'recipe named\nset x = max due\n' };
  const cell = (more: Partial<RunnerCell>): RunnerCell => ({
    index: 0,
    line: 2,
    status: 'ok',
    diagnostics: [],
    ...more,
  });

  it('answers the value it set and its note, each cut as a value is', () => {
    const answered = cellAnswer(
      cell({
        named: { name: 'x', value: 'y'.repeat(RECIPE_TEXT_MAX + 10) },
        note: "the table has no rows, so 'x' is empty",
      }),
      source,
    );
    expect(answered.named?.name).toBe('x');
    expect(answered.named?.value).toHaveLength(RECIPE_TEXT_MAX);
    expect(answered.named?.value.endsWith('…')).toBe(true);
    expect(answered.note).toBe("the table has no rows, so 'x' is empty");
  });

  it('control: a cell that set nothing answers neither', () => {
    const answered = cellAnswer(cell({}), source);
    expect(answered).not.toHaveProperty('named');
    expect(answered).not.toHaveProperty('note');
  });
});
