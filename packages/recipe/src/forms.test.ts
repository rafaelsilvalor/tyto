import { describe, expect, it } from 'vitest';

import { GENERIC_VERB_FORMS, formOfArguments, formTexts, helpKey, summaryKey } from './forms.js';

/**
 * TYTO-685: every sentence a generic verb's form shows has a key a host translates it by. The
 * keys are derived from names, so what is held here is that they reach every sentence and never
 * name two of them.
 */
describe("the forms' keyed sentences (TYTO-685)", () => {
  const forms = Object.values(GENERIC_VERB_FORMS);

  it("keys every generic verb's summary and every field's help, each key once", () => {
    const texts = forms.flatMap(formTexts);
    const sentences = forms.reduce(
      (count, form) => count + 1 + form.fields.filter((field) => field.help !== '').length,
      0,
    );

    expect(texts).toHaveLength(sentences);
    expect(new Set(texts.map((text) => text.key)).size).toBe(texts.length);
    expect(texts.every((text) => text.text !== '')).toBe(true);
  });

  it('names the key by the verb and the field', () => {
    const where = GENERIC_VERB_FORMS['where'];
    expect(where === undefined ? [] : formTexts(where)).toEqual([
      { key: 'recipe.verb.where.summary', text: 'Keeps the rows that satisfy an expression.' },
      {
        key: 'recipe.verb.where.field.expression.help',
        text: 'Predicates joined by AND, as in status = done AND team = print.',
      },
    ]);
    expect(summaryKey('decide')).toBe('recipe.verb.decide.summary');
    expect(helpKey('decide', 'clear')).toBe('recipe.verb.decide.field.clear.help');
  });

  it('keys nothing a form leaves blank', () => {
    const form = formOfArguments('acme.pull', 'source', [{ name: 'board', type: 'text' }]);
    expect(formTexts(form)).toEqual([]);
  });
});
