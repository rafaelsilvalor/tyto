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

  it("shows a generic verb's summary and help in the window's language (TYTO-685)", async () => {
    const dialog = open();
    void dialog.ask({ locale: 'pt-BR', catalog: CATALOG, columns: [] });
    await settle(dialog);
    const pickerSummary = dialog.querySelector(
      '[data-verb="where"] .recipe-step__verb-summary',
    )?.textContent;
    click(dialog, '[data-verb="where"]');
    await settle(dialog);

    expect(pickerSummary).toBe('Mantém as linhas que satisfazem uma expressão.');
    expect(dialog.querySelector('.recipe-step-form__summary')?.textContent).toBe(pickerSummary);
    expect(
      dialog.querySelector('[data-field="expression"] .recipe-step-form__help')?.textContent,
    ).toBe('Predicados unidos por AND, como em status = done AND team = print.');
  });

  it("keeps the English of a sentence the locale has none for, and English in 'en'", async () => {
    const dialog = open();
    const described: VerbEntry = {
      ...PLUGIN,
      fields: PLUGIN.fields.map((field) => ({ ...field, help: 'The board to read.' })),
    };
    void dialog.ask({ locale: 'pt-BR', catalog: [described], columns: [] });
    await settle(dialog);
    click(dialog, '[data-verb="acme.pull"]');
    await settle(dialog);
    expect(dialog.querySelector('[data-field="board"] .recipe-step-form__help')?.textContent).toBe(
      'The board to read.',
    );

    void dialog.ask({
      locale: 'en',
      catalog: CATALOG,
      columns: [],
      edit: { entry: entry('where'), values: {} },
    });
    await settle(dialog);
    expect(
      dialog.querySelector('[data-field="expression"] .recipe-step-form__help')?.textContent,
    ).toBe('Predicates joined by AND, as in status = done AND team = print.');
  });

  it("offers decide's clear like tie, and writes clear= and clear-limit= only when set (TYTO-715)", async () => {
    const dialog = open();
    const answer = dialog.ask({
      locale: 'pt-BR',
      catalog: CATALOG,
      columns: [],
      edit: {
        entry: entry('decide'),
        values: { column: 'status', local: 'sheet', remote: 'tracker', last: 'last_status' },
      },
    });
    await settle(dialog);
    const base = 'decide status local=sheet remote=tracker last=last_status';
    const line = (): string | null | undefined =>
      dialog.querySelector('.recipe-step-form__line')?.textContent;
    const choose = async (field: string, value: string): Promise<void> => {
      const select = dialog.querySelector<HTMLSelectElement>(`[data-field="${field}"] select`);
      if (select === null) throw new Error(`no choice ${field}`);
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle(dialog);
    };
    const shown = (field: string): Record<string, unknown> => {
      const box = dialog.querySelector(`[data-field="${field}"]`);
      const select = box?.querySelector('select');
      return {
        options: [...(select?.options ?? [])].map((option) => option.value),
        selected: select?.value,
        help: box?.querySelector('.recipe-step-form__help')?.textContent,
        default: box?.querySelector('.recipe-step-form__default')?.textContent?.trim(),
      };
    };

    // A line with neither tie= nor clear=: both left unset, each naming its default.
    expect(shown('clear')).toEqual({
      options: ['', 'push', 'pull'],
      selected: '',
      help: 'Se um valor apagado desde a última execução é enviado.',
      default: 'Se ficar em branco: pull',
    });
    expect(shown('tie')).toMatchObject({ options: ['', 'local', 'remote'], selected: '' });
    expect(line()).toBe(base);

    const lines: Record<string, string | null | undefined> = {};
    for (const [field, value] of [
      ['clear', 'push'],
      ['clear', 'pull'],
      ['clear', ''],
      ['tie', 'remote'],
      ['tie', ''],
    ] as const) {
      await choose(field, value);
      lines[`${field}=${value}`] = line();
    }
    expect(lines).toEqual({
      'clear=push': `${base} clear=push`,
      'clear=pull': `${base} clear=pull`,
      'clear=': base,
      'tie=remote': `${base} tie=remote`,
      'tie=': base,
    });

    const limit = dialog.querySelector<HTMLInputElement>('[data-field="clear-limit"] input');
    expect(limit?.placeholder).toBe('5');
    expect(
      dialog.querySelector('[data-field="clear-limit"] .recipe-step-form__help')?.textContent,
    ).toBe(
      'Com clear=push, o máximo de valores apagados que uma execução envia, ou none para não limitar.',
    );
    type(dialog, 'clear-limit', '');
    await settle(dialog);
    expect(line()).toBe(base);
    await choose('clear', 'push');
    type(dialog, 'clear-limit', '3');
    await settle(dialog);
    click(dialog, '.recipe-step__write');
    expect(await answer).toBe(`${base} clear=push clear-limit=3`);
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
