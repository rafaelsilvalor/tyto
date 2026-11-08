import { remeasureCellOutput } from '@tyto/editor';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { FacetsAnswer, FacetsRequest } from './recipe-board-view.js';
import {
  type CalendarOptions,
  type CalendarSpan,
  DAY_ROWS,
  NO_DATE,
  UNDATED_PAGE,
  UNREADABLE_DATE,
  calendarColumns,
  firstWeekday,
  hiddenRows,
  inMonth,
  localToday,
  shiftAnchor,
  spanDays,
} from './recipe-calendar-model.js';
import { type WireValue, showValue } from './recipe-table-model.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * The Calendar view under a recipe's cell (TYTO-383, ADR 0177): each row on the day its `date=`
 * falls on, a week or a month at a time, and the rows with no day listed apart with their count.
 *
 * **Main reads the dates.** One `recipe:facets` call with `bucket: 'day'` counts the span's days
 * in the run's zone, the rows before and after it, and the undated ones; one `recipe:rows` call
 * brings each shown day's first rows, by time. The calendar opens on the span holding today, as
 * main's zone reckons it. View only: a row is not dragged to another day (ADR 0129).
 */

type PageRow = Extract<RowsAnswer, { rows: unknown }>['rows'][number];

/** Rows one `recipe:rows` page may hold (`RECIPE_WIRE_LIMITS.page`). */
const PAGE = 500;

export interface CalendarViewOptions {
  readonly index: number;
  /** The run the window was shown; main answers `stale` once the cell ran again. */
  readonly ranAt: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly total: number;
  readonly locale: Locale;
  readonly calendar: CalendarOptions;
  readonly facets: (request: FacetsRequest) => Promise<FacetsAnswer>;
  readonly rows: (request: RowsRequest) => Promise<RowsAnswer>;
  /** This machine's today, until main says the zone's; injected so a test fixes it. */
  readonly today?: string;
}

interface Undated {
  count: number;
  keys: string[];
  rows: PageRow[];
  columns: readonly string[];
  asking: boolean;
}

export function calendarView(options: CalendarViewOptions): HTMLElement {
  const { locale, calendar } = options;
  const say = (key: CatalogueKey): string => translate(locale, key);
  const count = (value: number): string => new Intl.NumberFormat(locale).format(value);
  const types = new Map(options.columns.map((column) => [column.name, column.type]));
  const asked = calendarColumns(calendar);
  const firstDay = firstWeekday(locale);

  let today = options.today ?? localToday();
  let anchor = today;
  let span: CalendarSpan = calendar.span;
  let anchored = false;
  let filter = '';
  let total = options.total;
  let matched = options.total;
  let earlier = 0;
  let later = 0;
  let note = '';
  let counts = new Map<string, number>();
  /** Each shown day's first rows, then all of a day once "+k more" asked for them. */
  let dayRows = new Map<string, PageRow[]>();
  let answered: readonly string[] = asked;
  let undated: Undated = { count: 0, keys: [], rows: [], columns: asked, asking: false };
  let generation = 0;

  const root = element('div', 'recipe-cell__body recipe-calendar');
  root.dataset['view'] = 'calendar';
  const bar = element('div', 'recipe-table__bar');
  const search = element('input', 'recipe-table__filter');
  search.type = 'search';
  search.placeholder = say('recipe.table.filter');
  search.setAttribute('aria-label', say('recipe.table.filter'));
  const counter = element('span', 'recipe-table__count');
  const said = element('span', 'recipe-table__note');
  bar.append(search, counter, said);
  const navigation = element('div', 'recipe-calendar__navigation');
  const previous = button('recipe-calendar__previous', say('recipe.calendar.previous'));
  const title = element('span', 'recipe-calendar__title');
  const next = button('recipe-calendar__next', say('recipe.calendar.next'));
  const week = button('recipe-calendar__span', say('recipe.calendar.week'));
  week.dataset['span'] = 'week';
  const month = button('recipe-calendar__span', say('recipe.calendar.month'));
  month.dataset['span'] = 'month';
  const outside = element('span', 'recipe-calendar__outside');
  navigation.append(previous, title, next, week, month, outside);
  const grid = element('div', 'recipe-calendar__grid');
  const list = element('section', 'recipe-calendar__undated');
  root.append(bar, navigation, grid, list);

  const shown = (): string[] => spanDays(anchor, span, firstDay);

  /** Asks main for the span's days again: every drawn row belongs to the old span or filter. */
  function load(): void {
    generation += 1;
    const asking = generation;
    const days = shown();
    void options
      .facets({
        index: options.index,
        ranAt: options.ranAt,
        column: calendar.date,
        columns: asked,
        bucket: 'day',
        days: { from: days[0] ?? anchor, to: days.at(-1) ?? anchor },
        ...(filter === '' ? {} : { filter }),
      })
      .then((answer) => {
        if (asking !== generation) return;
        if ('stale' in answer) {
          note = say('recipe.table.stale');
          draw();
          return;
        }
        today = answer.today ?? today;
        // Once: the first span was this machine's today; main's zone may be a day off it.
        if (!anchored) {
          anchored = true;
          if (!days.includes(today)) {
            anchor = today;
            load();
            return;
          }
        }
        total = answer.total;
        matched = answer.matched;
        earlier = answer.earlier ?? 0;
        later = answer.later ?? 0;
        counts = new Map(answer.facets.map((facet) => [facet.key, facet.count]));
        dayRows = new Map();
        const keys = [UNREADABLE_DATE, NO_DATE].filter((key) => counts.has(key));
        undated = {
          count: keys.reduce((sum, key) => sum + (counts.get(key) ?? 0), 0),
          keys,
          rows: [],
          columns: asked,
          asking: false,
        };
        draw();
        askDays(days.filter((day) => counts.has(day)));
        askUndated();
      });
  }

  /** The first rows of each shown day, by time, in one page. */
  function askDays(days: readonly string[]): void {
    if (days.length === 0) return;
    const asking = generation;
    void options
      .rows({
        index: options.index,
        ranAt: options.ranAt,
        offset: 0,
        limit: Math.min(PAGE, days.length * DAY_ROWS),
        columns: asked,
        ...(filter === '' ? {} : { filter }),
        facet: { ...dayFacet(days), perDay: DAY_ROWS },
      })
      .then((answer) => {
        if (asking !== generation) return;
        if ('stale' in answer) note = say('recipe.table.stale');
        else {
          answered = answer.columns;
          for (const row of answer.rows) {
            const day = row.day ?? '';
            dayRows.set(day, [...(dayRows.get(day) ?? []), row]);
          }
        }
        draw();
      });
  }

  /** Every row of one day, after the ones its cell drew: what "+k more" asks for. */
  function askDay(day: string): void {
    const asking = generation;
    const drawn = dayRows.get(day) ?? [];
    void options
      .rows({
        index: options.index,
        ranAt: options.ranAt,
        offset: drawn.length,
        limit: Math.min(PAGE, Math.max(1, (counts.get(day) ?? 0) - drawn.length)),
        columns: asked,
        ...(filter === '' ? {} : { filter }),
        facet: dayFacet([day]),
      })
      .then((answer) => {
        if (asking !== generation) return;
        if ('stale' in answer) note = say('recipe.table.stale');
        else dayRows.set(day, [...drawn, ...answer.rows]);
        draw();
      });
  }

  /** The next page of the rows with no day. */
  function askUndated(): void {
    const left = hiddenRows(undated.count, undated.rows.length);
    if (left === 0 || undated.asking) return;
    undated.asking = true;
    const asking = generation;
    const holding = undated;
    void options
      .rows({
        index: options.index,
        ranAt: options.ranAt,
        offset: holding.rows.length,
        limit: Math.min(UNDATED_PAGE, left),
        columns: asked,
        ...(filter === '' ? {} : { filter }),
        facet: dayFacet(holding.keys),
      })
      .then((answer) => {
        if (asking !== generation) return;
        holding.asking = false;
        if ('stale' in answer) note = say('recipe.table.stale');
        else {
          holding.rows.push(...answer.rows);
          holding.columns = answer.columns;
        }
        draw();
      })
      .catch(() => {
        // "N more" asks again: a failed page is not a page.
        holding.asking = false;
        draw();
      });
  }

  function dayFacet(keys: readonly string[]): NonNullable<RowsRequest['facet']> {
    return {
      column: calendar.date,
      keys: [...keys],
      bucket: 'day',
      ...(calendar.time === undefined ? {} : { time: calendar.time }),
    };
  }

  function draw(): void {
    counter.textContent =
      matched === total
        ? say('recipe.table.rows').replace('{count}', count(total))
        : say('recipe.table.matched')
            .replace('{matched}', count(matched))
            .replace('{total}', count(total));
    said.textContent = note;
    const days = shown();
    title.textContent = spanTitle(days);
    week.setAttribute('aria-pressed', String(span === 'week'));
    month.setAttribute('aria-pressed', String(span === 'month'));
    outside.textContent = [
      earlier > 0 ? say('recipe.calendar.earlier').replace('{count}', count(earlier)) : '',
      later > 0 ? say('recipe.calendar.later').replace('{count}', count(later)) : '',
    ]
      .filter((part) => part !== '')
      .join(' · ');
    grid.dataset['span'] = span;
    grid.replaceChildren(...days.slice(0, 7).map(weekdayHeading), ...days.map(drawDay));
    drawUndated();
    remeasureCellOutput(root.closest<HTMLElement>('.cm-cell-output') ?? root);
  }

  function spanTitle(days: readonly string[]): string {
    const first = utc(days[0] ?? anchor);
    if (span === 'month') {
      return new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(utc(anchor));
    }
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).formatRange(first, utc(days.at(-1) ?? anchor));
  }

  function weekdayHeading(day: string): HTMLElement {
    const heading = element('div', 'recipe-calendar__weekday');
    heading.textContent = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(utc(day));
    return heading;
  }

  function drawDay(day: string): HTMLElement {
    const cell = element('div', 'recipe-calendar__day');
    cell.dataset['day'] = day;
    if (span === 'month' && !inMonth(day, anchor)) cell.classList.add('recipe-calendar__day--out');
    if (day === today) cell.classList.add('recipe-calendar__day--today');
    const number = element('span', 'recipe-calendar__date');
    number.textContent = count(utc(day).getUTCDate());
    cell.append(number);
    const rows = dayRows.get(day) ?? [];
    cell.append(...rows.map((row) => drawRow(row, answered)));
    const left = hiddenRows(counts.get(day) ?? 0, rows.length);
    if (left > 0) {
      const more = button('recipe-calendar__more', '');
      more.textContent = say('recipe.calendar.more').replace('{count}', count(left));
      more.addEventListener('click', () => {
        askDay(day);
      });
      cell.append(more);
    }
    return cell;
  }

  function drawRow(row: PageRow, columns: readonly string[]): HTMLElement {
    const line = element('div', 'recipe-calendar__row');
    line.dataset['key'] = row.key;
    if (row.time !== undefined) {
      const time = element('span', 'recipe-calendar__time');
      time.textContent = row.time;
      line.append(time);
    }
    const name = element('span', 'recipe-calendar__name');
    name.textContent = valueText(row, columns, calendar.title) || row.key;
    line.append(name);
    // A date that names no day is shown as written, so the person sees what to fix.
    if (row.day === UNREADABLE_DATE) {
      const written = element('span', 'recipe-calendar__written');
      written.textContent = valueText(row, columns, calendar.date);
      line.append(written);
    }
    line.title = name.textContent;
    return line;
  }

  function valueText(row: PageRow, columns: readonly string[], column?: string): string {
    if (column === undefined) return '';
    const at = columns.indexOf(column);
    const value: WireValue = at < 0 ? null : (row.values[at] ?? null);
    return showValue(value, types.get(column) ?? 'text', locale).text;
  }

  function drawUndated(): void {
    list.hidden = undated.count === 0;
    if (undated.count === 0) {
      list.replaceChildren();
      return;
    }
    const heading = element('header', 'recipe-calendar__heading');
    heading.textContent = say('recipe.calendar.undated').replace('{count}', count(undated.count));
    const rows = element('div', 'recipe-calendar__rows');
    rows.append(...undated.rows.map((row) => drawRow(row, undated.columns)));
    list.replaceChildren(heading, rows);
    const left = hiddenRows(undated.count, undated.rows.length);
    if (left > 0 && !undated.asking) {
      const more = button('recipe-calendar__more', '');
      more.textContent = say('recipe.board.more').replace('{count}', count(left));
      more.addEventListener('click', askUndated);
      list.append(more);
    }
  }

  function move(direction: -1 | 1): void {
    anchor = shiftAnchor(anchor, span, direction);
    load();
  }

  previous.addEventListener('click', () => {
    move(-1);
  });
  next.addEventListener('click', () => {
    move(1);
  });
  for (const toggle of [week, month]) {
    toggle.addEventListener('click', () => {
      const wanted = toggle.dataset['span'] === 'week' ? 'week' : 'month';
      if (wanted === span) return;
      span = wanted;
      load();
    });
  }
  search.addEventListener('input', () => {
    filter = search.value;
    load();
  });

  draw();
  load();
  return root;
}

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function button(className: string, text: string): HTMLButtonElement {
  const made = element('button', `recipe-cell__action ${className}`);
  made.type = 'button';
  made.textContent = text;
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
