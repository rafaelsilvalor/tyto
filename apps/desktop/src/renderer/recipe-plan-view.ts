import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { CellStatus } from './recipe-notebook.js';

/**
 * What goes under a plan cell (TYTO-378, ADR 0170): the plan's operations, Apply, and how the
 * Apply went; `recipe-cell-view.ts` puts it in the cell.
 *
 * - **The plan's count and target** (`recipe.cell.plan`) head it when the cell also has a table:
 *   an action passes its table on, so the header's summary counts the rows instead. A cell with
 *   only a plan says them in the header already.
 * - **The lines** are the first {@link SHOWN_OPERATIONS} the wire carries, then how many it
 *   leaves out of the plan's count, as a table's rows are.
 * - **Apply** is offered only when main says the plan may be applied now (`applicable`) and
 *   it was not: main refuses a plan applied already, and a button that can only be refused
 *   would be a lie. While its Apply is on its way the button stays, `aria-disabled`, so a
 *   second click asks nothing.
 * - **Afterwards** each line carries its mark, applied, failed or skipped, with the reason main
 *   gave, and a summary counts them.
 * - **A refusal** (a stale plan, a verb that cannot apply) is said once, on the cell, from the
 *   `recipe:apply` answer: main keeps no refusal, so the next run's answer drops it.
 * - **`apply auto` held** (a Run outside a trusted folder) is one discreet line.
 *
 * Pure apart from `document`: what a click does is the host's.
 */

/** Operations the plan shows of the up to 50 the wire carries. */
export const SHOWN_OPERATIONS = 20;

type WireCell = CellStatus['cell'];
type WirePlan = NonNullable<WireCell['plan']>;

/** What the plan view needs of the window, besides the cell: its Apply and how it is going. */
export interface PlanViewState {
  readonly locale: Locale;
  /** This cell's Apply is on its way. */
  readonly applying: boolean;
  /** Why this cell's last Apply was refused, as main said it; shown until the next answer. */
  readonly refusal: string | undefined;
}

/** Apply is offered: the plan may be applied, main stamped it, and it was not applied. */
export const offersApply = (cell: WireCell): boolean =>
  cell.plan?.applicable === true && cell.plan.planId !== undefined && cell.applied === undefined;

/** The Apply button for the header, or `undefined` when the cell offers none. */
export function applyButton(
  cell: WireCell,
  state: PlanViewState,
  apply: (planId: number) => void,
): HTMLButtonElement | undefined {
  const planId = cell.plan?.planId;
  if (!offersApply(cell) || planId === undefined) return undefined;
  const made = element('button', 'recipe-cell__action');
  made.type = 'button';
  made.dataset['action'] = 'apply';
  made.textContent = translate(state.locale, 'recipe.plan.apply');
  if (state.applying) made.setAttribute('aria-disabled', 'true');
  made.addEventListener('click', () => {
    if (made.getAttribute('aria-disabled') === 'true') return;
    made.setAttribute('aria-disabled', 'true');
    apply(planId);
  });
  return made;
}

/** The plan's lines, their marks and the notes under them; `undefined` for a cell with no plan. */
export function planBody(
  cell: WireCell,
  held: CellStatus['held'],
  state: PlanViewState,
): HTMLElement | undefined {
  const plan = cell.plan;
  if (plan === undefined) return undefined;
  const say = (key: CatalogueKey): string => translate(state.locale, key);
  const body = element('div', 'recipe-plan');
  if (cell.table !== undefined) {
    const heading = say('recipe.cell.plan')
      .replace('{count}', String(plan.count))
      .replace('{target}', plan.target);
    body.append(text(element('div', 'recipe-plan__heading'), heading));
  }
  if (held === 'apply') {
    body.append(text(element('div', 'recipe-plan__held'), say('recipe.plan.held')));
  }
  body.append(operationList(plan, cell.applied, state.locale));
  const more = plan.count - Math.min(plan.operations.length, SHOWN_OPERATIONS);
  if (more > 0) {
    const key = more === 1 ? 'recipe.plan.more.one' : 'recipe.plan.more';
    const words = say(key).replace('{count}', String(more));
    body.append(text(element('div', 'recipe-plan__more'), words));
  }
  if (cell.applied !== undefined) {
    body.append(
      text(element('div', 'recipe-plan__summary'), summaryOf(cell.applied, state.locale)),
    );
  }
  if (state.refusal !== undefined) {
    const refusal = text(element('div', 'recipe-plan__refusal'), state.refusal);
    refusal.setAttribute('role', 'alert');
    body.append(refusal);
  }
  return body;
}

function operationList(plan: WirePlan, applied: WireCell['applied'], locale: Locale): HTMLElement {
  const list = element('ol', 'recipe-plan__operations');
  plan.operations.slice(0, SHOWN_OPERATIONS).forEach((operation, index) => {
    const line = element('li', 'recipe-plan__operation');
    line.append(text(element('span', 'recipe-plan__write'), operation.write));
    if (operation.rowKey !== undefined) {
      line.append(text(element('span', 'recipe-plan__row'), operation.rowKey));
    }
    line.append(text(element('span', 'recipe-plan__description'), operation.description));
    const outcome = applied?.operations[index];
    if (outcome !== undefined) {
      line.dataset['status'] = outcome.status;
      line.append(
        text(element('span', 'recipe-plan__mark'), translate(locale, MARKS[outcome.status])),
      );
      if (outcome.reason !== undefined) {
        line.append(text(element('span', 'recipe-plan__reason'), outcome.reason));
      }
    }
    list.append(line);
  });
  return list;
}

type Outcome = NonNullable<WireCell['applied']>;
type OperationStatus = Outcome['operations'][number]['status'];

const MARKS: Readonly<Record<OperationStatus, CatalogueKey>> = {
  applied: 'recipe.plan.mark.applied',
  failed: 'recipe.plan.mark.failed',
  skipped: 'recipe.plan.mark.skipped',
};

const SUMMARY: Readonly<Record<OperationStatus, CatalogueKey>> = {
  applied: 'recipe.plan.summary.applied',
  failed: 'recipe.plan.summary.failed',
  skipped: 'recipe.plan.summary.skipped',
};

/** "2 applied · 1 failed": every count that is not zero, from main's totals, not the lines'. */
export function summaryOf(applied: Outcome, locale: Locale): string {
  const counts: [OperationStatus, number][] = [
    ['applied', applied.applied],
    ['failed', applied.failed],
    ['skipped', applied.skipped],
  ];
  const said = counts
    .filter(([, count]) => count > 0)
    .map(([status, count]) => translate(locale, SUMMARY[status]).replace('{count}', String(count)));
  return said.length === 0 ? translate(locale, 'recipe.plan.summary.none') : said.join(' · ');
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
): HTMLElementTagNameMap[Tag] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function text<Made extends HTMLElement>(made: Made, words: string): Made {
  made.textContent = words;
  return made;
}
