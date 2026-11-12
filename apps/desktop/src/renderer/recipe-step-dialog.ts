import { type VerbForm } from '@tyto/recipe';
import { LitElement, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import {
  type StepValues,
  type Written,
  formOfEntry,
  localizedEntry,
  renderStepForm,
  writeStep,
} from './recipe-step-form.js';
import {
  type VerbEntry,
  pickerGroups,
  pickerOrder,
  renderStepPicker,
} from './recipe-step-picker.js';

/**
 * Add step and Edit step (TYTO-402, ADR 0176): the step picker, then the chosen verb's form, in
 * one small dialog. {@link RecipeStepDialog.ask} answers the one line the form wrote, or
 * `undefined` when the person cancelled; the caller decides where it goes in the text, so a
 * recipe tab's commands and the notebook's blocks (TYTO-676) open the same dialog.
 */

export const RECIPE_STEP_TAG = 'tyto-recipe-step';

export interface StepRequest {
  readonly locale: Locale;
  readonly catalog: readonly VerbEntry[];
  /** The columns of the cell before the step, which column fields offer. */
  readonly columns: readonly string[];
  /** Edit step: the form opened straight on this verb, filled from its line. */
  readonly edit?: { readonly entry: VerbEntry; readonly values: StepValues };
}

type Refusal = Extract<Written, { ok: false }>;

export class RecipeStepDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    query: { state: true },
    choice: { state: true },
    form: { state: true },
    values: { state: true },
    refused: { state: true },
  };

  declare open: boolean;
  declare query: string;
  declare choice: number;
  declare form: VerbForm | undefined;
  declare values: StepValues;
  declare refused: Refusal | undefined;
  private request: StepRequest | undefined;
  private answer: ((line: string | undefined) => void) | undefined;

  constructor() {
    super();
    this.open = false;
    this.query = '';
    this.choice = 0;
    this.form = undefined;
    this.values = {};
    this.refused = undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Opens the dialog; a dialog already open is cancelled first. */
  ask(asked: StepRequest): Promise<string | undefined> {
    this.finish(undefined);
    // Translated once here, so the picker searches and shows the same words the form does.
    const localize = (entry: VerbEntry): VerbEntry => localizedEntry(entry, asked.locale);
    const request: StepRequest = {
      ...asked,
      catalog: asked.catalog.map(localize),
      ...(asked.edit === undefined
        ? {}
        : { edit: { ...asked.edit, entry: localize(asked.edit.entry) } }),
    };
    this.request = request;
    this.query = '';
    this.choice = 0;
    this.refused = undefined;
    this.form = request.edit === undefined ? undefined : formOfEntry(request.edit.entry);
    this.values = request.edit === undefined ? {} : { ...request.edit.values };
    this.open = true;
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  private finish(line: string | undefined): void {
    const answer = this.answer;
    this.answer = undefined;
    this.open = false;
    answer?.(line);
  }

  private write(): void {
    if (this.form === undefined) return;
    const written = writeStep(this.form, this.values);
    if (written.ok) this.finish(written.line);
    else this.refused = written;
  }

  protected override updated(changed: Map<string, unknown>): void {
    // The keyboard goes to the search field, then to the form's first field.
    if (!this.open || !(changed.has('open') || changed.has('form'))) return;
    this.querySelector<HTMLElement>('.recipe-step__search, .recipe-step-form__input')?.focus();
  }

  protected override render(): unknown {
    const request = this.request;
    if (!this.open || request === undefined) return nothing;
    const say = (key: CatalogueKey): string => translate(request.locale ?? DEFAULT_LOCALE, key);
    const form = this.form;
    return html`<div
      class="recipe-step__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('recipe.step.title')}
    >
      <h2 class="recipe-step__title">${say('recipe.step.title')}</h2>
      ${
        form === undefined
          ? renderStepPicker({
              catalog: request.catalog,
              query: this.query,
              choice: this.choice,
              say,
              onQuery: (query) => {
                this.query = query;
                this.choice = pickerOrder(pickerGroups(request.catalog, query)).length > 0 ? 0 : -1;
              },
              onChoice: (choice) => {
                this.choice = choice;
              },
              onPick: (entry) => {
                this.form = formOfEntry(entry);
                this.values = {};
              },
              onCancel: () => this.finish(undefined),
            })
          : renderStepForm({
              form,
              values: this.values,
              columns: request.columns,
              refused: this.refused,
              say,
              onValue: (field, value) => {
                this.values = { ...this.values, [field]: value };
                this.refused = undefined;
              },
              onWrite: () => this.write(),
              onCancel: () => this.finish(undefined),
            })
      }
    </div>`;
  }
}

customElements.define(RECIPE_STEP_TAG, RecipeStepDialog);
