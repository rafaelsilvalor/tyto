import { html, nothing } from 'lit';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The step picker (TYTO-402, ADR 0176): every verb a recipe may name here, the generic ones and
 * each running plugin's, grouped by kind and narrowed by what the person types. Arrow keys move
 * the choice, Enter takes it. What it lists is `recipe:verbs`' catalog, so a plugin verb is
 * offered as soon as main has it.
 *
 * The model is pure and the drawing a Lit template, so a host other than a recipe tab (the
 * notebook's blocks, TYTO-676) draws the same picker.
 */

export type VerbEntry = IpcResponse<'recipe:verbs'>['catalog'][number];
export type VerbKindName = VerbEntry['kind'];

/** The order the groups are shown in: where rows come from first, where they go last. */
export const PICKER_KINDS: readonly VerbKindName[] = ['source', 'transform', 'action', 'sink'];

const KIND_LABELS: Readonly<Record<VerbKindName, CatalogueKey>> = {
  source: 'recipe.step.kind.source',
  transform: 'recipe.step.kind.transform',
  action: 'recipe.step.kind.action',
  sink: 'recipe.step.kind.sink',
};

export interface PickerGroup {
  readonly kind: VerbKindName;
  readonly verbs: readonly VerbEntry[];
}

/**
 * The verbs whose name or summary holds every word typed, case aside, grouped by kind in
 * {@link PICKER_KINDS}' order and by name inside a group. An empty group is left out.
 */
export function pickerGroups(catalog: readonly VerbEntry[], query: string): PickerGroup[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const matches = catalog.filter((entry) => {
    const haystack = `${entry.name} ${entry.summary}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return PICKER_KINDS.map((kind) => ({
    kind,
    verbs: matches
      .filter((entry) => entry.kind === kind)
      .sort((left, right) => left.name.localeCompare(right.name)),
  })).filter((group) => group.verbs.length > 0);
}

/** The verbs in the order the list shows them, which the arrow keys walk. */
export const pickerOrder = (groups: readonly PickerGroup[]): readonly VerbEntry[] =>
  groups.flatMap((group) => group.verbs);

/** The choice after an arrow key, kept inside the list; `-1` for an empty one. */
export function movedChoice(current: number, step: number, count: number): number {
  if (count === 0) return -1;
  return Math.min(count - 1, Math.max(0, current + step));
}

export interface PickerView {
  readonly catalog: readonly VerbEntry[];
  readonly query: string;
  /** The chosen verb's place in {@link pickerOrder}. */
  readonly choice: number;
  readonly say: (key: CatalogueKey) => string;
  readonly onQuery: (query: string) => void;
  readonly onChoice: (choice: number) => void;
  readonly onPick: (entry: VerbEntry) => void;
  readonly onCancel: () => void;
}

/** The picker: a search field over the grouped list, the field keeping the keyboard. */
export function renderStepPicker(view: PickerView): unknown {
  const groups = pickerGroups(view.catalog, view.query);
  const order = pickerOrder(groups);
  const chosen = order[view.choice];
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      view.onChoice(movedChoice(view.choice, event.key === 'ArrowDown' ? 1 : -1, order.length));
    } else if (event.key === 'Enter' && chosen !== undefined) {
      event.preventDefault();
      view.onPick(chosen);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      view.onCancel();
    }
  };
  return html`<div class="recipe-step__picker">
    <input
      class="recipe-step__search"
      type="search"
      autofocus
      placeholder=${view.say('recipe.step.search')}
      aria-label=${view.say('recipe.step.search')}
      .value=${view.query}
      @input=${(event: Event) => view.onQuery((event.target as HTMLInputElement).value)}
      @keydown=${onKey}
    />
    ${
      order.length === 0
        ? html`<p class="recipe-step__none">${view.say('recipe.step.none')}</p>`
        : nothing
    }
    <div class="recipe-step__list" role="listbox" aria-label=${view.say('recipe.step.title')}>
      ${groups.map(
        (group) =>
          html`<div class="recipe-step__group" data-kind=${group.kind}>
            <h3 class="recipe-step__kind">${view.say(KIND_LABELS[group.kind])}</h3>
            ${group.verbs.map((entry) => {
              const place = order.indexOf(entry);
              return html`<button
                class="recipe-step__verb"
                type="button"
                role="option"
                data-verb=${entry.name}
                aria-selected=${place === view.choice ? 'true' : 'false'}
                @mouseenter=${() => view.onChoice(place)}
                @click=${() => view.onPick(entry)}
              >
                <span class="recipe-step__verb-name">${entry.name}</span>
                <span class="recipe-step__verb-summary">${entry.summary}</span>
              </button>`;
            })}
          </div>`,
      )}
    </div>
  </div>`;
}
