import type { CellOutput } from '@tyto/editor';

import { type Locale, translate } from '../../shared/i18n/index.js';
import type { RecipeRunAnswer, TogetherState } from './recipe-notebook.js';
import { type ApplyProgressShown, offersApply, progressLine } from './recipe-plan-view.js';

/**
 * Apply all (TYTO-758, ADR 0219): under the `apply together` line of a recipe's header, one
 * Apply for every plan of the run, in order, with a long write's progress and Cancel (ADR 0216)
 * and why main refused it or where it stopped.
 *
 * Under that header **the window draws no Apply per plan** (`recipe-cell-view.ts`): a lower
 * plan was planned against the files the plans above it leave, so applying it first fails it,
 * and a lone Apply would skip the rule that stops at the first plan that does not go through.
 * The plans are still drawn, each under its line, so the person reads what Apply all will do.
 *
 * Offered while at least one plan may be applied; while it runs the button stays,
 * `aria-disabled`, so a second click asks nothing.
 */

/** The `apply together` header line, or `undefined` when the text has none. */
const TOGETHER_LINE = /^[ \t]*apply[ \t]+together[ \t]*$/mu;

export interface TogetherViewContext {
  readonly locale: Locale;
  readonly state: TogetherState;
  /** The progress main pushed for the cell being applied, if a long write is under way. */
  readonly progress: ReadonlyMap<number, ApplyProgressShown>;
  readonly apply: () => void;
  readonly cancel: () => void;
}

/**
 * The output drawn under the `apply together` line, or `undefined` when the answer is not a
 * together recipe's or the text holds no such line.
 */
export function togetherOutputOf(
  text: string,
  answer: Pick<RecipeRunAnswer, 'cells' | 'together'>,
  context: TogetherViewContext,
): CellOutput | undefined {
  if (answer.together !== true) return undefined;
  const found = TOGETHER_LINE.exec(text);
  if (found === null) return undefined;
  const offered = answer.cells.filter(offersApply).length;
  const [progress] = [...context.progress.values()];
  return {
    at: found.index,
    key: [
      'together',
      context.locale,
      String(offered),
      context.state.applying ? 'applying' : '',
      context.state.said ?? '',
      JSON.stringify(progress ?? null),
    ].join('\u0000'),
    render: () => renderTogether(offered, progress, context),
  };
}

function renderTogether(
  offered: number,
  progress: ApplyProgressShown | undefined,
  context: TogetherViewContext,
): HTMLElement {
  const { locale, state } = context;
  const root = document.createElement('div');
  root.className = 'recipe-together';
  const row = document.createElement('div');
  row.className = 'recipe-together__row';
  if (offered > 0 || state.applying) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recipe-cell__action';
    button.dataset['action'] = 'apply-together';
    button.textContent = translate(locale, 'recipe.together.apply');
    if (state.applying) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      button.setAttribute('aria-disabled', 'true');
      context.apply();
    });
    row.append(button);
  }
  const hint = document.createElement('span');
  hint.className = 'recipe-together__hint';
  hint.textContent = translate(locale, 'recipe.together.hint');
  row.append(hint);
  root.append(row);
  if (state.applying && progress !== undefined) {
    root.append(progressLine(progress, locale, context.cancel));
  }
  if (state.said !== undefined) {
    const said = document.createElement('div');
    said.className = 'recipe-plan__refusal';
    said.setAttribute('role', 'alert');
    said.textContent = state.said;
    root.append(said);
  }
  return root;
}
