import { GENERIC_VERB_FORMS, formTexts } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { RECIPE_FORM_TEXTS, formText } from './recipe-forms.js';

/**
 * TYTO-685: the step forms' Portuguese is held to `GENERIC_VERB_FORMS` in both directions, so a
 * verb or a field added in `@tyto/recipe` without its sentence here fails, and so does a
 * sentence left behind by a renamed field.
 */
describe("the recipe forms' Portuguese (TYTO-685)", () => {
  const english = Object.values(GENERIC_VERB_FORMS).flatMap(formTexts);
  const portuguese = RECIPE_FORM_TEXTS['pt-BR'] ?? {};

  it("has a sentence for every generic form's key, and none the forms do not have", () => {
    expect(Object.keys(portuguese).sort()).toEqual(english.map((text) => text.key).sort());
  });

  it('says each one in Portuguese, never blank and never the English left in place', () => {
    for (const { key, text } of english) {
      expect(portuguese[key], key).not.toBe('');
      expect(portuguese[key], key).not.toBe(text);
    }
  });

  it("falls back to the English it was given for a key the locale lacks, a plugin verb's", () => {
    expect(formText('pt-BR', 'recipe.verb.acme.pull.field.board.help', 'The board.')).toBe(
      'The board.',
    );
    expect(formText('en', 'recipe.verb.where.summary', 'Keeps rows.')).toBe('Keeps rows.');
    expect(formText('pt-BR', 'recipe.verb.where.summary', 'Keeps rows.')).toBe(
      'Mantém as linhas que satisfazem uma expressão.',
    );
  });
});
