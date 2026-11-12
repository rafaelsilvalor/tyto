import { type Diagnostic } from '@tyto/core';
import { type Step, type VerbField, type VerbForm, formatStep, valuesOfStep } from '@tyto/recipe';
import { html, nothing } from 'lit';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { VerbEntry } from './recipe-step-picker.js';

/**
 * A step's form (TYTO-402, ADR 0176): one field per argument of the verb, drawn by what it
 * holds, and the one line `formatStep` writes from them. **The text stays the source of truth**:
 * the form is filled from a line by `valuesOfStep`, and writes one line back; a value one line
 * cannot carry is refused with `formatStep`'s own `E_RECIPE_FORM`, shown next to its field,
 * and nothing is written.
 *
 * A `column`, `columns` or `expression` field offers the columns of the cell before the step,
 * from the notebook's last answer: a click puts the name in, as typed.
 */

export type StepValues = Record<string, string>;

/** The catalog's entry as `@tyto/recipe`'s form, which `formatStep` writes from. */
export function formOfEntry(entry: VerbEntry): VerbForm {
  return {
    verb: entry.name,
    kind: entry.kind,
    summary: entry.summary,
    example: '',
    fields: entry.fields.map((field): VerbField => ({
      name: field.name,
      kind: field.kind,
      placement: field.placement,
      required: field.required,
      help: field.help,
      ...(field.default === undefined ? {} : { default: field.default }),
      ...(field.values === undefined ? {} : { values: field.values }),
      ...(field.inline === undefined ? {} : { inline: field.inline }),
    })),
  };
}

/** A line's values in the form's fields, or none when the line is not this verb's to read. */
export function valuesOfLine(form: VerbForm, step: Step): StepValues | undefined {
  const read = valuesOfStep(form, step);
  return read.ok ? read.value : undefined;
}

export type Written =
  | { readonly ok: true; readonly line: string }
  | {
      readonly ok: false;
      /** The field the problem is about, or `undefined` for the step as a whole. */
      readonly field: string | undefined;
      readonly code: string;
      readonly message: string;
    };

/** The line the values describe, or the first problem `formatStep` found, at its field. */
export function writeStep(form: VerbForm, values: StepValues): Written {
  const written = formatStep(form, values);
  if (written.ok) return { ok: true, line: written.value };
  const [first] = written.error;
  if (first === undefined) return { ok: false, field: undefined, code: '', message: '' };
  return {
    ok: false,
    field: fieldOfProblem(form, first),
    code: first.code,
    message: first.message,
  };
}

/**
 * The field a refusal is about: `E_RECIPE_FORM` names it first (`columns holds …`, `into= is
 * written twice`) or, for a missing value, after `needs`. A problem that names none is the
 * step's.
 */
export function fieldOfProblem(form: VerbForm, problem: Diagnostic): string | undefined {
  if (problem.code !== 'E_RECIPE_FORM') return undefined;
  const said = problem.message.slice(problem.message.indexOf(': ') + 2);
  const named = /^([\w-]+)[\s=]/u.exec(said)?.[1];
  const needs = /^'[^']*' needs ([\w-]+)/u.exec(said)?.[1];
  return [named, needs].find((name) => form.fields.some((field) => field.name === name));
}

/** Whether a field offers the columns of the cell before the step. */
export const offersColumns = (field: VerbField): boolean =>
  field.kind === 'column' || field.kind === 'columns' || field.kind === 'expression';

/**
 * A field's value once a column offered is clicked: a `column` field takes it, a `columns`
 * field adds it after a comma when it is not there yet, an expression gets it at its end.
 */
export function withColumn(field: VerbField, current: string, column: string): string {
  const value = current.trim();
  if (field.kind === 'column' || value === '') return column;
  if (field.kind === 'columns') {
    const names = value.split(',').map((name) => name.trim());
    return names.includes(column) ? value : `${value},${column}`;
  }
  return `${value} ${column}`;
}

export interface FormView {
  readonly form: VerbForm;
  readonly values: StepValues;
  /** The columns of the cell before the step, offered beside each column field. */
  readonly columns: readonly string[];
  /** The refusal of the last Write, kept until the values change. */
  readonly refused: Extract<Written, { ok: false }> | undefined;
  readonly say: (key: CatalogueKey) => string;
  readonly onValue: (field: string, value: string) => void;
  readonly onWrite: () => void;
  readonly onCancel: () => void;
}

/** The form: its fields, the line it would write, and Write and Cancel. */
export function renderStepForm(view: FormView): unknown {
  const { form, values, refused, say } = view;
  const preview = writeStep(form, values);
  const problemAt = (field: string | undefined): unknown =>
    refused !== undefined && refused.field === field
      ? html`<p class="recipe-step-form__problem" role="alert" data-code=${refused.code}>
          <span class="recipe-step-form__code">${refused.code}</span> ${refused.message}
        </p>`
      : nothing;
  return html`<form
    class="recipe-step-form"
    data-verb=${form.verb}
    @submit=${(event: Event) => {
      event.preventDefault();
      view.onWrite();
    }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        view.onCancel();
      }
    }}
  >
    <h3 class="recipe-step-form__verb">${form.verb}</h3>
    ${form.summary === '' ? nothing : html`<p class="recipe-step-form__summary">${form.summary}</p>`}
    ${
      form.fields.length === 0
        ? html`<p class="recipe-step-form__empty">${say('recipe.step.noFields')}</p>`
        : nothing
    }
    ${form.fields.map(
      (field) =>
        html`<div class="recipe-step-form__field" data-field=${field.name}>
          <label class="recipe-step-form__label">
            <span class="recipe-step-form__name">${field.name}</span>
            ${
              field.required
                ? html`<span class="recipe-step-form__required"
                    >${say('recipe.step.required')}</span
                  >`
                : nothing
            }
            ${fieldInput(field, values[field.name] ?? '', say, view.onValue)}
          </label>
          ${field.help === '' ? nothing : html`<p class="recipe-step-form__help">${field.help}</p>`}
          ${
            field.default === undefined
              ? nothing
              : html`<p class="recipe-step-form__default">
                  ${say('recipe.step.default').replace('{value}', field.default)}
                </p>`
          }
          ${
            offersColumns(field) && view.columns.length > 0
              ? html`<div
                  class="recipe-step-form__columns"
                  aria-label=${say('recipe.step.columns')}
                >
                  ${view.columns.map(
                    (column) =>
                      html`<button
                        class="recipe-step-form__column"
                        type="button"
                        data-column=${column}
                        @click=${() =>
                          view.onValue(
                            field.name,
                            withColumn(field, values[field.name] ?? '', column),
                          )}
                      >
                        ${column}
                      </button>`,
                  )}
                </div>`
              : nothing
          }
          ${problemAt(field.name)}
        </div>`,
    )}
    ${problemAt(undefined)}
    <p class="recipe-step-form__line-label">${say('recipe.step.line')}</p>
    <code class="recipe-step-form__line">${preview.ok ? preview.line : ''}</code>
    <div class="recipe-step__actions">
      <button class="recipe-step__cancel" type="button" @click=${() => view.onCancel()}>
        ${say('recipe.step.cancel')}
      </button>
      <button class="recipe-step__write" type="submit">${say('recipe.step.write')}</button>
    </div>
  </form>`;
}

function fieldInput(
  field: VerbField,
  value: string,
  say: (key: CatalogueKey) => string,
  onValue: (field: string, value: string) => void,
): unknown {
  if (field.kind === 'flag') {
    return html`<input
      class="recipe-step-form__input"
      type="checkbox"
      .checked=${value === 'true'}
      @change=${(event: Event) =>
        onValue(field.name, (event.target as HTMLInputElement).checked ? 'true' : '')}
    />`;
  }
  if (field.values !== undefined) {
    return html`<select
      class="recipe-step-form__input"
      @change=${(event: Event) => onValue(field.name, (event.target as HTMLSelectElement).value)}
    >
      <option value="" ?selected=${value === ''}>${say('recipe.step.unset')}</option>
      ${field.values.map(
        (choice) => html`<option value=${choice} ?selected=${choice === value}>${choice}</option>`,
      )}
    </select>`;
  }
  return html`<input
    class="recipe-step-form__input"
    type="text"
    spellcheck="false"
    placeholder=${field.default ?? ''}
    .value=${value}
    @input=${(event: Event) => onValue(field.name, (event.target as HTMLInputElement).value)}
  />`;
}
