import { type CellOutput, cellOutputLineStart, remeasureCellOutput } from '@tyto/editor';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { CellStatus } from './recipe-notebook.js';
import { type PlanViewState, applyButton, planBody } from './recipe-plan-view.js';
import type { FacetsAnswer, FacetsRequest } from './recipe-board-view.js';
import type { CopyAnswer, CopyRequest, RowsAnswer, RowsRequest } from './recipe-table-view.js';
import { viewBody } from './recipe-views.js';

/**
 * What goes under a recipe's cell (TYTO-377, ADR 0148): a header line and the cell's table.
 *
 * The header is the line pull request C drew (`.recipe-cell-status`): a fold toggle when there
 * is a table, the cell's summary, its age, and two buttons, **Run from here** on any cell with a
 * table or a plan and **Fetch again** on a cell that fetches. The buttons are always shown, not
 * on hover: a person should see what a cell offers before reaching for it. A plan cell's header
 * also carries **Apply**, and its body the plan's lines (`recipe-plan-view.ts`, TYTO-378).
 *
 * A cell under `show table` or `show summary` draws its view instead of the table
 * (`recipe-views.ts`, TYTO-379). Under no `show`, the table is a preview: the first
 * {@link SHOWN_ROWS} of the rows the wire carries, then how many it leaves out. It scrolls sideways inside the cell, and a long value is cut with an
 * ellipsis, its whole text in the cell's `title`.
 *
 * **The element is built once per key** (`cell-outputs.ts`), so the key holds everything the
 * element shows except the age, which {@link tickAges} rewrites in place: the cell, its status,
 * when it ran, why it was held, the language, and whether it was folded when built; for a plan,
 * its id, when it was applied, whether its Apply is on its way and its refusal. A cell main
 * kept and did not rerun keeps its `ranAt`, so its element stays and does not flicker.
 *
 * Pure apart from `document`: what a click does is the host's, through {@link CellViewActions}.
 */

/** Rows the table shows of the up to 50 the wire carries. */
export const SHOWN_ROWS = 20;

/** How often the window rewrites every age it shows. */
export const AGE_TICK = 30_000;

export interface CellViewActions {
  /** Run from here: this cell down, as Run is. */
  readonly runFrom: (index: number) => void;
  /** Fetch again: the whole document, forgetting every kept cell. */
  readonly fetchAgain: () => void;
  /**
   * The person folded or unfolded a cell's table: `at` is the start of the cell's line in the
   * text as it is now, read from the editor on the click (TYTO-451).
   */
  readonly toggled: (at: number, collapsed: boolean) => void;
  /** Apply: the plan main stamped `planId` on this cell (TYTO-378). */
  readonly apply: (index: number, planId: number) => void;
  /** A page of a kept cell's table, for its view: `recipe:rows` for this tab (TYTO-379). */
  readonly rows: (request: RowsRequest) => Promise<RowsAnswer>;
  /** Copy rows of a kept cell's table: `recipe:copy` for this tab (TYTO-379). */
  readonly copy: (request: CopyRequest) => Promise<CopyAnswer>;
  /** A column's groups of a kept cell's table: `recipe:facets` for this tab (TYTO-381). */
  readonly facets: (request: FacetsRequest) => Promise<FacetsAnswer>;
}

export interface CellViewContext {
  readonly locale: Locale;
  /** The cells folded in this tab, by the start of their line ({@link CellStatus.at}). */
  readonly collapsed: ReadonlySet<number>;
  /** The cells whose Apply is on its way, by index. */
  readonly applying: ReadonlySet<number>;
  /** Why a cell's last Apply was refused, by index, until the next answer. */
  readonly refusals: ReadonlyMap<number, string>;
  /** Milliseconds since the epoch; injected so a test fixes the clock. */
  readonly now: () => number;
  readonly actions: CellViewActions;
}

type WireCell = CellStatus['cell'];
type WireTable = NonNullable<WireCell['table']>;

/** The table a cell shows: an ok cell's, and a stale cell's when it kept one. */
const tableOf = (cell: WireCell): WireTable | undefined =>
  cell.status === 'ok' || cell.status === 'stale' ? cell.table : undefined;

export function cellOutputOf(status: CellStatus, context: CellViewContext): CellOutput {
  const collapsed = context.collapsed.has(status.at);
  const { cell } = status;
  return {
    at: status.at,
    key: [
      status.index,
      cell.status,
      cell.ranAt ?? '',
      status.held ?? '',
      cell.source === true ? 'source' : '',
      context.locale,
      collapsed ? 'folded' : 'open',
      cell.plan?.planId ?? '',
      cell.plan?.applicable === true ? 'applicable' : '',
      cell.applied?.at ?? '',
      context.applying.has(status.index) ? 'applying' : '',
      context.refusals.get(status.index) ?? '',
      cell.view?.name ?? '',
      // TYTO-381: `show board by=status` and `by=owner` draw different boards.
      JSON.stringify(cell.view?.options ?? {}),
    ].join('\u0000'),
    render: () => renderCell(status, context, collapsed),
  };
}

function renderCell(status: CellStatus, context: CellViewContext, collapsed: boolean): HTMLElement {
  const { cell } = status;
  const { locale, actions } = context;
  const say = (key: CatalogueKey): string => translate(locale, key);
  const plan: PlanViewState = {
    locale,
    applying: context.applying.has(status.index),
    refusal: context.refusals.get(status.index),
  };
  const root = element('div', 'recipe-cell');
  root.classList.toggle('recipe-cell--collapsed', collapsed);
  const header = element('div', 'recipe-cell-status');
  if (status.failed) header.dataset['failed'] = '';
  root.append(header);

  const table = tableOf(cell);
  if (table !== undefined) {
    const toggle = element('button', 'recipe-cell__toggle');
    toggle.type = 'button';
    const label = (folded: boolean): void => {
      const words = say(folded ? 'recipe.cell.expand' : 'recipe.cell.collapse');
      toggle.setAttribute('aria-expanded', String(!folded));
      toggle.setAttribute('aria-label', words);
      toggle.title = words;
      toggle.textContent = folded ? '▸' : '▾';
    };
    label(collapsed);
    toggle.addEventListener('click', () => {
      const folded = !root.classList.contains('recipe-cell--collapsed');
      root.classList.toggle('recipe-cell--collapsed', folded);
      label(folded);
      // The line as it is now: `status.at` is the text the answer ran, which typing since may
      // have moved, and the next answer looks the fold up where the line is then.
      actions.toggled(cellOutputLineStart(root) ?? status.at, folded);
      remeasureCellOutput(root);
    });
    header.append(toggle);
  }

  header.append(text(element('span', 'recipe-cell-summary'), status.text));
  const age = ageOf(cell, locale, context.now());
  if (age !== undefined) header.append(age);

  if (table !== undefined || cell.plan !== undefined) {
    const apply = applyButton(cell, plan, (planId) => {
      actions.apply(status.index, planId);
    });
    if (apply !== undefined) header.append(apply);
    header.append(
      button(say('recipe.cell.runFrom'), 'run-from', () => {
        actions.runFrom(status.index);
      }),
    );
    if (cell.source === true) {
      header.append(
        button(say('recipe.cell.fetchAgain'), 'fetch-again', () => {
          actions.fetchAgain();
        }),
      );
    }
  }

  // TYTO-379: a cell under `show` is drawn by its view (`recipe-views.ts`); one under none
  // keeps the preview. Only the body changes: the header and a plan's lines stay as they are.
  if (table !== undefined) {
    const view = viewBody(cell, table, {
      locale,
      rows: actions.rows,
      copy: actions.copy,
      facets: actions.facets,
    });
    root.append(view ?? tableBody(table, locale));
  }
  const planned = planBody(cell, status.held, plan);
  if (planned !== undefined) root.append(planned);
  return root;
}

function tableBody(table: WireTable, locale: Locale): HTMLElement {
  const body = element('div', 'recipe-cell__body');
  const scroll = element('div', 'recipe-cell__scroll');
  const grid = element('table', 'recipe-cell__table');
  const head = grid.createTHead().insertRow();
  for (const column of table.columns) {
    const name = text(document.createElement('th'), column.name);
    name.title = column.type;
    head.append(name);
  }
  const rows = grid.createTBody();
  const shown = table.rows.slice(0, SHOWN_ROWS);
  for (const row of shown) {
    const line = rows.insertRow();
    for (const value of row.values) {
      const said = value === null ? '' : String(value);
      text(line.insertCell(), said).title = said;
    }
  }
  scroll.append(grid);
  body.append(scroll);
  const more = table.total - shown.length;
  if (more > 0) {
    const key = more === 1 ? 'recipe.cell.more.one' : 'recipe.cell.more';
    const words = translate(locale, key).replace('{count}', String(more));
    body.append(text(element('div', 'recipe-cell__more'), words));
  }
  return body;
}

/** When the cell ran and how old its data is, each in a span the ticker rewrites. */
function ageOf(cell: WireCell, locale: Locale, now: number): HTMLElement | undefined {
  const parts: HTMLElement[] = [];
  if (cell.ranAt !== undefined) parts.push(agePart('ran', cell.ranAt, locale, now));
  if (cell.oldestFetchedAt !== undefined) {
    parts.push(agePart('fetched', cell.oldestFetchedAt, locale, now));
  }
  if (parts.length === 0) return undefined;
  const age = element('span', 'recipe-cell-age');
  parts.forEach((part, index) => {
    if (index > 0) age.append(' · ');
    age.append(part);
  });
  return age;
}

type AgeKind = 'ran' | 'fetched';

function agePart(kind: AgeKind, at: string, locale: Locale, now: number): HTMLElement {
  const part = text(document.createElement('span'), ageText(kind, at, locale, now));
  part.dataset['at'] = at;
  part.dataset['age'] = kind;
  return part;
}

/** "ran 2 min. ago", "data fetched 3 hr. ago", in the window's language. */
export function ageText(kind: AgeKind, at: string, locale: Locale, now: number): string {
  const key = kind === 'ran' ? 'recipe.cell.ran' : 'recipe.cell.fetched';
  return translate(locale, key).replace('{when}', relativeTime(at, locale, now));
}

/** `at` from `now`, in the largest unit that fits; a moment in the future reads as now. */
export function relativeTime(at: string, locale: Locale, now: number): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const seconds = Math.round((now - Date.parse(at)) / 1000);
  if (Number.isNaN(seconds) || seconds < 45) return format.format(0, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return format.format(-hours, 'hour');
  return format.format(-Math.round(hours / 24), 'day');
}

/**
 * Rewrites every age under `root` in place, so a cell's element and its key stay as they are:
 * the window calls it every {@link AGE_TICK}.
 */
export function tickAges(root: ParentNode, locale: Locale, now: number): void {
  for (const part of root.querySelectorAll<HTMLElement>('.recipe-cell-age [data-at]')) {
    const kind = part.dataset['age'] === 'fetched' ? 'fetched' : 'ran';
    part.textContent = ageText(kind, part.dataset['at'] ?? '', locale, now);
  }
}

function button(label: string, action: string, run: () => void): HTMLButtonElement {
  const made = text(element('button', 'recipe-cell__action'), label);
  made.type = 'button';
  made.dataset['action'] = action;
  made.addEventListener('click', run);
  return made;
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
