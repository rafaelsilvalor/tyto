import { remeasureCellOutput } from '@tyto/editor';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import { type IpcRequest, type IpcResponse, RECIPE_WIRE_LIMITS } from '../../shared/ipc.js';
import {
  COLUMN_WIDTH,
  type CellPlace,
  PAGE_SIZE,
  ROW_HEIGHT,
  type Selection,
  type SortState,
  VIEWPORT_ROWS,
  type WireValue,
  boundsOf,
  createPageCache,
  isSelected,
  nextSort,
  queryOf,
  select,
  selectAll,
  showValue,
  shownColumns,
  toggleHidden,
  visibleRange,
} from './recipe-table-model.js';

/**
 * The Table view under a recipe's cell (TYTO-379, ADR 0171): a viewport of fixed height in which
 * only the rows in sight are drawn, each at its place, over a canvas as tall as every matched row.
 *
 * Every row comes from main a page at a time (`recipe:rows`); a header click, the quick filter
 * and the column picker change the query main is sent and **never reorder a row here**: the
 * page is drawn in the order it arrived. Copy hands main the selected rectangle and main writes
 * the clipboard (`recipe:copy`). An answer to a query since replaced is dropped, by generation.
 *
 * The element lives as long as its cell's key (`recipe-cell-view.ts`): a new run, another
 * language or a fold built again draws a new one, with the recipe's order and no selection.
 */

export type RowsRequest = Omit<IpcRequest<'recipe:rows'>, 'documentId'>;
export type RowsAnswer = IpcResponse<'recipe:rows'>;
export type CopyRequest = Omit<IpcRequest<'recipe:copy'>, 'documentId'>;
export type CopyAnswer = IpcResponse<'recipe:copy'>;

type PageRow = Extract<RowsAnswer, { rows: unknown }>['rows'][number];

export interface TableViewOptions {
  readonly index: number;
  /** The run the window was shown; main answers `stale` once the cell ran again. */
  readonly ranAt: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  /** Every row the kept table has, before the first page tells. */
  readonly total: number;
  readonly locale: Locale;
  /** Summary: a totals line under the rows, main's sums over the rows the filter keeps. */
  readonly summary: boolean;
  readonly rows: (request: RowsRequest) => Promise<RowsAnswer>;
  readonly copy: (request: CopyRequest) => Promise<CopyAnswer>;
  /**
   * Drawn in a tab of its own (TYTO-379): the viewport takes the height the tab gives it, read
   * on every draw and drawn again when it changes, instead of a fixed number of rows.
   */
  readonly fullSize?: boolean;
}

export function tableView(options: TableViewOptions): HTMLElement {
  const { locale } = options;
  const say = (key: CatalogueKey): string => translate(locale, key);
  const count = (value: number): string => new Intl.NumberFormat(locale).format(value);
  const types = new Map(options.columns.map((column) => [column.name, column.type]));
  const all = options.columns.map((column) => column.name);

  let sort: SortState | undefined;
  let filter = '';
  let hidden: ReadonlySet<string> = new Set();
  let selection: Selection | undefined;
  let total = options.total;
  let matched = options.total;
  /** The columns the drawn values follow: main's answer, or the shown ones before it. */
  let columns: readonly string[] = all;
  let totals: Readonly<Record<string, number>> | undefined;
  let note = '';
  let generation = 0;
  const pages = createPageCache<PageRow>();
  const asked = new Set<number>();

  const root = element('div', 'recipe-cell__body recipe-table');
  root.dataset['view'] = options.summary ? 'summary' : 'table';
  // The stylesheet reads both: every row and every column the same size, from the model.
  root.style.setProperty('--recipe-table-row', `${String(ROW_HEIGHT)}px`);
  root.style.setProperty('--recipe-table-column', `${String(COLUMN_WIDTH)}px`);
  const bar = element('div', 'recipe-table__bar');
  const search = element('input', 'recipe-table__filter');
  search.type = 'search';
  search.placeholder = say('recipe.table.filter');
  search.setAttribute('aria-label', say('recipe.table.filter'));
  const pick = barButton(say('recipe.table.columns'), 'columns');
  pick.setAttribute('aria-expanded', 'false');
  const copyButton = barButton(say('recipe.table.copy'), 'copy');
  const counter = element('span', 'recipe-table__count');
  const said = element('span', 'recipe-table__note');
  bar.append(search, pick, copyButton, counter, said);

  const picker = element('div', 'recipe-table__picker');
  picker.hidden = true;
  for (const name of all) {
    const label = element('label', 'recipe-table__pick');
    const box = element('input', 'recipe-table__pick-box');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset['column'] = name;
    box.addEventListener('change', () => {
      hidden = toggleHidden(hidden, name, all);
      box.checked = !hidden.has(name);
      requery();
    });
    label.append(box, ` ${name}`);
    picker.append(label);
  }

  const viewport = element('div', 'recipe-table__viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'grid');
  const fixedHeight = Math.min(VIEWPORT_ROWS, Math.max(1, total)) * ROW_HEIGHT;
  const fullSize = options.fullSize === true;
  // The header row is sticky inside the viewport, so the rows get the height under it. Full
  // size, the stylesheet stretches the viewport and the rows get what is under its header.
  if (fullSize) root.classList.add('recipe-table--full');
  else viewport.style.height = `${String(fixedHeight + ROW_HEIGHT)}px`;
  const viewportHeight = (): number =>
    fullSize ? Math.max(viewport.clientHeight - ROW_HEIGHT, ROW_HEIGHT) : fixedHeight;
  const head = element('div', 'recipe-table__head');
  head.setAttribute('role', 'row');
  const canvas = element('div', 'recipe-table__canvas');
  viewport.append(head, canvas);
  const foot = element('div', 'recipe-table__totals');
  foot.hidden = true;
  root.append(bar, picker, viewport, foot);

  const query = () => queryOf({ sort, filter, all, hidden });

  /** A new question for main: every kept page belongs to the old one. */
  function requery(): void {
    generation += 1;
    pages.clear();
    asked.clear();
    selection = undefined;
    columns = shownColumns(all, hidden);
    viewport.scrollTop = 0;
    draw();
  }

  function ask(page: number): void {
    if (asked.has(page)) return;
    asked.add(page);
    const asking = generation;
    const offset = page * PAGE_SIZE;
    options
      .rows({ index: options.index, ranAt: options.ranAt, offset, limit: PAGE_SIZE, ...query() })
      .then((answer) => {
        if (asking !== generation) return;
        if ('stale' in answer) {
          note = say('recipe.table.stale');
          draw();
          return;
        }
        pages.set(page, answer.rows);
        total = answer.total;
        matched = answer.matched;
        columns = answer.columns;
        totals = answer.totals;
        draw();
      })
      .catch(() => {
        // Asked again on the next draw: a failed page is not a page.
        asked.delete(page);
      });
  }

  function draw(): void {
    const width = `calc(${String(columns.length)} * var(--recipe-table-column))`;
    const template = `repeat(${String(columns.length)}, var(--recipe-table-column))`;
    drawHead(template, width);
    canvas.style.height = `${String(matched * ROW_HEIGHT)}px`;
    canvas.style.width = width;
    const range = visibleRange(viewport.scrollTop, viewportHeight(), matched);
    const lines: HTMLElement[] = [];
    for (let row = range.start; row < range.end; row += 1) {
      const page = Math.floor(row / PAGE_SIZE);
      const rows = pages.get(page);
      if (rows === undefined) ask(page);
      lines.push(drawRow(row, rows?.[row - page * PAGE_SIZE], template));
    }
    canvas.replaceChildren(...lines);
    counter.textContent =
      matched === total
        ? say('recipe.table.rows').replace('{count}', count(total))
        : say('recipe.table.matched')
            .replace('{matched}', count(matched))
            .replace('{total}', count(total));
    said.textContent = note;
    copyButton.setAttribute('aria-disabled', String(selection === undefined));
    drawTotals(template, width);
  }

  function drawHead(template: string, width: string): void {
    head.style.gridTemplateColumns = template;
    head.style.width = width;
    head.replaceChildren(
      ...columns.map((name) => {
        const heading = element('button', 'recipe-table__heading');
        heading.type = 'button';
        heading.dataset['column'] = name;
        heading.setAttribute('role', 'columnheader');
        heading.title = types.get(name) ?? '';
        const direction = sort?.column === name ? sort.direction : undefined;
        heading.setAttribute(
          'aria-sort',
          direction === undefined ? 'none' : direction === 'asc' ? 'ascending' : 'descending',
        );
        heading.textContent =
          direction === undefined ? name : `${name} ${direction === 'asc' ? '▲' : '▼'}`;
        if (types.get(name) === 'number') heading.classList.add('recipe-table__cell--number');
        return heading;
      }),
    );
  }

  function drawRow(row: number, data: PageRow | undefined, template: string): HTMLElement {
    const line = element('div', 'recipe-table__row');
    line.setAttribute('role', 'row');
    line.dataset['row'] = String(row);
    line.style.top = `${String(row * ROW_HEIGHT)}px`;
    line.style.gridTemplateColumns = template;
    columns.forEach((name, column) => {
      const cell = element('div', 'recipe-table__cell');
      cell.setAttribute('role', 'gridcell');
      cell.dataset['column'] = String(column);
      if (data !== undefined) {
        const value: WireValue = data.values[column] ?? null;
        const shown = showValue(value, types.get(name) ?? 'text', locale);
        if (shown.numeric) cell.classList.add('recipe-table__cell--number');
        if (shown.href === undefined) cell.textContent = shown.text;
        else {
          const anchor = element('a', 'recipe-table__link');
          anchor.href = shown.href;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          anchor.textContent = shown.text;
          cell.append(anchor);
        }
        cell.title = value === null ? '' : String(value);
      }
      const chosen = isSelected(selection, { row, column });
      cell.classList.toggle('recipe-table__cell--selected', chosen);
      cell.setAttribute('aria-selected', String(chosen));
      line.append(cell);
    });
    return line;
  }

  function drawTotals(template: string, width: string): void {
    const shown = options.summary && totals !== undefined;
    if (foot.hidden === shown) {
      foot.hidden = !shown;
      remeasure();
    }
    if (!shown) return;
    foot.style.gridTemplateColumns = template;
    foot.style.width = width;
    foot.replaceChildren(
      ...columns.map((name, column) => {
        const cell = element('div', 'recipe-table__cell');
        const sum = totals?.[name];
        if (sum !== undefined) {
          cell.textContent = count(sum);
          cell.classList.add('recipe-table__cell--number');
        } else if (column === 0) cell.textContent = say('recipe.table.total');
        return cell;
      }),
    );
  }

  function placeOf(target: EventTarget | null): CellPlace | undefined {
    if (!(target instanceof Element)) return undefined;
    const cell = target.closest<HTMLElement>('.recipe-table__cell');
    const line = cell?.closest<HTMLElement>('.recipe-table__row');
    if (cell === null || cell === undefined || line === null || line === undefined) {
      return undefined;
    }
    return { row: Number(line.dataset['row']), column: Number(cell.dataset['column']) };
  }

  function copySelection(): void {
    if (selection === undefined) return;
    const bounds = boundsOf(selection);
    const { columns: shown, ...rest } = query();
    void options
      .copy({
        index: options.index,
        ranAt: options.ranAt,
        offset: bounds.top,
        limit: Math.min(bounds.bottom - bounds.top + 1, RECIPE_WIRE_LIMITS.copy),
        ...rest,
        columns: [...shown],
        copyColumns: columns.slice(bounds.left, bounds.right + 1),
      })
      .then((answer) => {
        note =
          'stale' in answer
            ? say('recipe.table.stale')
            : say('recipe.table.copied').replace('{count}', count(answer.rows));
        draw();
      });
  }

  function remeasure(): void {
    remeasureCellOutput(root.closest<HTMLElement>('.cm-cell-output') ?? root);
  }

  search.addEventListener('input', () => {
    filter = search.value;
    requery();
  });
  pick.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
    pick.setAttribute('aria-expanded', String(!picker.hidden));
    remeasure();
  });
  copyButton.addEventListener('click', copySelection);
  head.addEventListener('click', (event) => {
    const heading = (event.target as Element | null)?.closest<HTMLElement>(
      '.recipe-table__heading',
    );
    const name = heading?.dataset['column'];
    if (name === undefined) return;
    sort = nextSort(sort, name);
    requery();
  });
  canvas.addEventListener('click', (event) => {
    const place = placeOf(event.target);
    if (place === undefined) return;
    selection = select(selection, place, event.shiftKey);
    viewport.focus({ preventScroll: true });
    draw();
  });
  viewport.addEventListener('scroll', () => {
    foot.scrollLeft = viewport.scrollLeft;
    draw();
  });
  viewport.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'a') {
      selection = selectAll(matched, columns.length);
      draw();
    } else if (key === 'c' && selection !== undefined) copySelection();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  // A tab resized, or shown after it was hidden, has another number of rows in sight.
  if (fullSize && typeof ResizeObserver !== 'undefined') {
    let drawnHeight = -1;
    new ResizeObserver(() => {
      if (viewport.clientHeight === drawnHeight) return;
      drawnHeight = viewport.clientHeight;
      draw();
    }).observe(viewport);
  }

  draw();
  return root;
}

function barButton(label: string, action: string): HTMLButtonElement {
  const made = element('button', 'recipe-cell__action');
  made.type = 'button';
  made.dataset['action'] = action;
  made.textContent = label;
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
