import { externalUrlAllowed } from '../../shared/external-url.js';
import type { Locale } from '../../shared/i18n/index.js';

/**
 * The Table view's arithmetic and state, with no DOM (TYTO-379, ADR 0171).
 *
 * The window never holds a whole table: main keeps it, sorts and filters it, and answers pages
 * over `recipe:rows`. What is left here is which rows to draw for a scroll position, which pages
 * to keep, the next sort a header asks for, the columns shown, and the rectangle the person
 * selected. **Nothing here sorts or filters a row**: the sort and the filter only become the
 * query main is sent.
 */

/** Every row is this tall, so a scroll position names its rows without measuring any. */
export const ROW_HEIGHT = 24;

/** Every column is this wide, so the header, the rows and the totals line up. */
export const COLUMN_WIDTH = 192;

/** Rows a cell's viewport shows at once; a shorter table shows all of its rows. */
export const VIEWPORT_ROWS = 12;

/** Rows drawn beyond each edge of the viewport, so a short scroll shows no gap. */
export const OVERSCAN = 8;

/** Rows asked of main at a time. */
export const PAGE_SIZE = 100;

/** Pages kept; the least recently read is dropped first. */
export const CACHED_PAGES = 12;

/** Rows `start` (included) to `end` (excluded). */
export interface RowRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The rows to draw at `scrollTop`: those the viewport shows, `overscan` more on each side,
 * within `0 … count`.
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN,
): RowRange {
  if (count <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight);
  return {
    start: Math.min(count, Math.max(0, first - overscan)),
    end: Math.min(count, last + overscan),
  };
}

/** The pages holding a range's rows, in order. */
export function pagesOf(range: RowRange, pageSize = PAGE_SIZE): number[] {
  if (range.end <= range.start) return [];
  const pages: number[] = [];
  const last = Math.floor((range.end - 1) / pageSize);
  for (let page = Math.floor(range.start / pageSize); page <= last; page += 1) pages.push(page);
  return pages;
}

/** Pages of rows by number, the least recently read dropped once more than `capacity` are kept. */
export interface PageCache<Row> {
  get(page: number): readonly Row[] | undefined;
  set(page: number, rows: readonly Row[]): void;
  clear(): void;
  readonly size: number;
}

export function createPageCache<Row>(capacity = CACHED_PAGES): PageCache<Row> {
  // A Map iterates in insertion order: reading a page moves it to the end, so the first key is
  // always the least recently read.
  const pages = new Map<number, readonly Row[]>();
  return {
    get(page) {
      const rows = pages.get(page);
      if (rows !== undefined) {
        pages.delete(page);
        pages.set(page, rows);
      }
      return rows;
    },
    set(page, rows) {
      pages.delete(page);
      pages.set(page, rows);
      while (pages.size > capacity) {
        const oldest = pages.keys().next().value;
        if (oldest === undefined) break;
        pages.delete(oldest);
      }
    },
    clear() {
      pages.clear();
    },
    get size() {
      return pages.size;
    },
  };
}

export interface SortState {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

/** A header click: a new column sorts ascending, then descending, then the recipe's order. */
export function nextSort(current: SortState | undefined, column: string): SortState | undefined {
  if (current?.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : undefined;
}

/** The columns shown, in the table's order. */
export function shownColumns(all: readonly string[], hidden: ReadonlySet<string>): string[] {
  return all.filter((column) => !hidden.has(column));
}

/** The column picker's click; the last shown column stays, so the table never draws empty. */
export function toggleHidden(
  hidden: ReadonlySet<string>,
  column: string,
  all: readonly string[],
): Set<string> {
  const next = new Set(hidden);
  if (next.has(column)) next.delete(column);
  else if (shownColumns(all, next).length > 1) next.add(column);
  return next;
}

export interface TableQuery {
  readonly sort?: SortState;
  readonly filter?: string;
  /** The shown columns: the filter matches only in these (ADR 0171 decision 3). */
  readonly columns: string[];
}

/** What main is asked, from the view's state: always the shown columns, a filter only if any. */
export function queryOf(state: {
  readonly sort: SortState | undefined;
  readonly filter: string;
  readonly all: readonly string[];
  readonly hidden: ReadonlySet<string>;
}): TableQuery {
  const filter = state.filter.trim();
  return {
    ...(state.sort === undefined ? {} : { sort: state.sort }),
    ...(filter === '' ? {} : { filter }),
    columns: shownColumns(state.all, state.hidden),
  };
}

/** A cell of the view, by its place among the matched rows and the shown columns. */
export interface CellPlace {
  readonly row: number;
  readonly column: number;
}

/** Where a selection started and where it reaches; the rectangle between them is selected. */
export interface Selection {
  readonly anchor: CellPlace;
  readonly focus: CellPlace;
}

export interface Bounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** A click selects one cell; Shift-click stretches the rectangle from where it started. */
export function select(previous: Selection | undefined, at: CellPlace, extend: boolean): Selection {
  return extend && previous !== undefined
    ? { anchor: previous.anchor, focus: at }
    : { anchor: at, focus: at };
}

/** Ctrl+A: every matched row, every shown column; nothing when there is nothing to select. */
export function selectAll(rows: number, columns: number): Selection | undefined {
  if (rows <= 0 || columns <= 0) return undefined;
  return { anchor: { row: 0, column: 0 }, focus: { row: rows - 1, column: columns - 1 } };
}

export function boundsOf(selection: Selection): Bounds {
  const { anchor, focus } = selection;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

export function isSelected(selection: Selection | undefined, at: CellPlace): boolean {
  if (selection === undefined) return false;
  const bounds = boundsOf(selection);
  return (
    at.row >= bounds.top &&
    at.row <= bounds.bottom &&
    at.column >= bounds.left &&
    at.column <= bounds.right
  );
}

/** A value as the wire carries it: a list already joined, a long text already cut. */
export type WireValue = string | number | boolean | null;

/** How a cell draws a value of its column's type. */
export interface ShownValue {
  readonly text: string;
  /** Right-aligned: a number. */
  readonly numeric: boolean;
  /** An anchor's address: only for a `link` an `http:` or `https:` address. */
  readonly href?: string;
}

/**
 * A value in the window's language: numbers grouped, a `date` as a date (it has no time, so no
 * time zone moves its day), a `datetime` in the person's own zone, and a `link` as an anchor
 * only when the browser may open it. A value that does not read as its type is shown as is.
 */
export function showValue(value: WireValue, type: string, locale: Locale): ShownValue {
  if (value === null) return { text: '', numeric: false };
  if (typeof value === 'number') {
    return { text: new Intl.NumberFormat(locale).format(value), numeric: true };
  }
  const raw = String(value);
  if (typeof value === 'string' && type === 'date' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const day = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(day.getTime())) {
      const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
      return { text: format.format(day), numeric: false };
    }
  }
  if (typeof value === 'string' && type === 'datetime') {
    const moment = Date.parse(value);
    if (!Number.isNaN(moment)) {
      const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
      return { text: format.format(moment), numeric: false };
    }
  }
  if (typeof value === 'string' && type === 'link' && externalUrlAllowed(value)) {
    return { text: raw, numeric: false, href: value };
  }
  return { text: raw, numeric: false };
}
