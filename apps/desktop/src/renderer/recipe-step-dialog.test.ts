// @vitest-environment jsdom
import { GENERIC_VERB_FORMS, parseRecipe } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { type RecipeStepDialog, RECIPE_STEP_TAG } from './recipe-step-dialog.js';
import {
  fieldOfProblem,
  formOfEntry,
  valuesOfLine,
  withColumn,
  writeStep,
} from './recipe-step-form.js';
import { type VerbEntry, movedChoice, pickerGroups, pickerOrder } from './recipe-step-picker.js';

/**
 * TYTO-402, ADR 0176: the step picker, the step form and the dialog that holds them, as jsdom
 * sees them. The catalog is what `recipe:verbs` answers: every generic verb's form, and a
 * plugin's source with the one argument it declared. How it looks is the real window's
 * question (`e2e/recipe-steps.desktop.test.ts`).
 */

const PLUGIN: VerbEntry = {
  name: 'acme.pull',
  kind: 'source',
  summary: '',
  fields: [{ name: 'board', kind: 'text', placement: 'named', required: true, help: '' }],
};

const CATALOG: readonly VerbEntry[] = [
  ...Object.values(GENERIC_VERB_FORMS).map((form) => ({
    name: form.verb,
    kind: form.kind,
    summary: form.summary,
    fields: form.fields.map((field) => ({ ...field, values: field.values?.slice() })),
  })),
  PLUGIN,
] as VerbEntry[];

const entry = (name: string): VerbEntry => {
  const found = CATALOG.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no ${name} in the catalog`);
  return found;
};

describe('the step picker (TYTO-402)', () => {
  it("groups every verb by kind, sources first, a plugin's among them", () => {
    const groups = pickerGroups(CATALOG, '');

    expect(groups.map((group) => group.kind)).toEqual(['source', 'transform', 'action', 'sink']);
    expect(groups[0]?.verbs.map((verb) => verb.name)).toEqual(['acme.pull']);
    expect(pickerOrder(groups)).toHaveLength(CATALOG.length);
  });

  it('narrows to the verbs whose name or summary holds every word typed', () => {
    const names = pickerOrder(pickerGroups(CATALOG, 'ROWS keeps')).map((verb) => verb.name);

    expect(names).toContain('where');
    expect(names).not.toContain('select');
    expect(pickerGroups(CATALOG, 'nothing matches this')).toEqual([]);
  });

  it('keeps the arrow keys inside the list', () => {
    expect(movedChoice(0, -1, 3)).toBe(0);
    expect(movedChoice(1, 1, 3)).toBe(2);
    expect(movedChoice(2, 1, 3)).toBe(2);
    expect(movedChoice(0, 1, 0)).toBe(-1);
  });
});

describe('the step form (TYTO-402)', () => {
  it('writes the line a form describes, which reads back as its values', () => {
    const form = formOfEntry(entry('select'));
    const written = writeStep(form, { columns: 'key title', without: '' });

    expect(written).toEqual({ ok: true, line: 'select key title' });
    const parsed = parseRecipe(`recipe r\n${written.ok ? written.line : ''}\n`);
    const step = parsed.ok ? parsed.value.steps[0] : undefined;
    expect(step === undefined ? undefined : valuesOfLine(form, step)).toEqual({
      columns: 'key title',
    });
  });

  it("writes a plugin verb's line from its declared argument", () => {
    expect(writeStep(formOfEntry(PLUGIN), { board: 'Design team' })).toEqual({
      ok: true,
      line: 'acme.pull board="Design team"',
    });
  });

  it("refuses a value one line cannot carry, at its field, with formatStep's code", () => {
    const form = formOfEntry(entry('rollup'));
    const written = writeStep(form, { column: 'open', parent: 'parent', when: 'a = "b c"' });

    expect(written).toMatchObject({ ok: false, field: 'when', code: 'E_RECIPE_FORM' });
    const missing = writeStep(formOfEntry(entry('where')), {});
    expect(missing).toMatchObject({ ok: false, field: 'expression', code: 'E_RECIPE_FORM' });
    expect(
      fieldOfProblem(form, { severity: 'error', code: 'E_RECIPE_SYNTAX', message: 'when x' }),
    ).toBeUndefined();
  });

  it('takes a column offered as a column field, a columns field and an expression do', () => {
    const [column, columns] = formOfEntry(entry('collect')).fields;
    const expression = formOfEntry(entry('where')).fields[0];
    if (column === undefined || columns === undefined || expression === undefined) {
      throw new Error('collect and where have their fields');
    }

    expect(withColumn(column, 'old', 'title')).toBe('title');
    expect(withColumn(columns, 'key', 'title')).toBe('key,title');
    expect(withColumn(columns, 'key,title', 'title')).toBe('key,title');
    expect(withColumn(expression, 'status =', 'title')).toBe('status = title');
  });
});

describe('the step dialog (TYTO-402)', () => {
  function open(): RecipeStepDialog {
    const dialog = document.createElement(RECIPE_STEP_TAG) as RecipeStepDialog;
    document.body.replaceChildren(dialog);
    return dialog;
  }
  const settle = (dialog: RecipeStepDialog): Promise<boolean> => dialog.updateComplete;
  const click = (dialog: RecipeStepDialog, selector: string): void => {
    const found = dialog.querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`nothing matches ${selector}`);
    found.click();
  };
  const type = (dialog: RecipeStepDialog, field: string, value: string): void => {
    const input = dialog.querySelector<HTMLInputElement>(
      `[data-field="${field}"] .recipe-step-form__input`,
    );
    if (input === null) throw new Error(`no field ${field}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('picks a verb, offers the columns before it, and answers the line the form showed', async () => {
    const dialog = open();
    const answer = dialog.ask({ locale: 'en', catalog: CATALOG, columns: ['key', 'title'] });
    await settle(dialog);
    expect(dialog.querySelectorAll('.recipe-step__kind')[0]?.textContent).toBe('Sources');

    click(dialog, '[data-verb="select"]');
    await settle(dialog);
    click(dialog, '[data-field="columns"] [data-column="key"]');
    await settle(dialog);
    click(dialog, '[data-field="columns"] [data-column="title"]');
    await settle(dialog);
    const shown = dialog.querySelector('.recipe-step-form__line')?.textContent;
    click(dialog, '.recipe-step__write');

    expect(await answer).toBe('select key,title');
    expect(shown).toBe('select key,title');
    expect(dialog.open).toBe(false);
  });

  it('shows a refusal next to its field and answers nothing until it is fixed', async () => {
    const dialog = open();
    let answered = false;
    const answer = dialog.ask({
      locale: 'pt-BR',
      catalog: CATALOG,
      columns: [],
      edit: { entry: entry('where'), values: { expression: 'status = done' } },
    });
    void answer.then(() => {
      answered = true;
    });
    await settle(dialog);
    type(dialog, 'expression', '');
    await settle(dialog);
    click(dialog, '.recipe-step__write');
    await settle(dialog);

    const problem = dialog.querySelector('[data-field="expression"] .recipe-step-form__problem');
    expect(problem?.getAttribute('data-code')).toBe('E_RECIPE_FORM');
    expect(dialog.querySelector('.recipe-step__write')?.textContent?.trim()).toBe('Escrever passo');
    await Promise.resolve();
    expect(answered).toBe(false);

    type(dialog, 'expression', 'status != done');
    await settle(dialog);
    click(dialog, '.recipe-step__write');
    expect(await answer).toBe('where status != done');
  });

  it('answers nothing when cancelled with Escape from the search field', async () => {
    const dialog = open();
    const answer = dialog.ask({ locale: 'en', catalog: CATALOG, columns: [] });
    await settle(dialog);
    dialog
      .querySelector('.recipe-step__search')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(await answer).toBeUndefined();
  });
});
