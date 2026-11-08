import { remeasureCellOutput } from '@tyto/editor';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import { CARDS_PAGE, nextCards, rowLink } from './recipe-cards-model.js';
import { type WireValue, showValue } from './recipe-table-model.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * The Cards view under a recipe's cell (TYTO-384, ADR 0177 note of 2026-11-08): a grid of loose
 * cards of one height, each showing `fields=`, paged from main (`recipe:rows` with
 * `columns=fields`) forty-eight at a time under the quick filter.
 *
 * **Opening a card asks main for the whole row** (`recipe:row`): every column the table has,
 * those `fields=` left out included, and where the row came from. It opens over the window as
 * its other dialogs do, and Escape closes it. View only: nothing on a card writes (ADR 0129).
 */

export type RowRequest = Omit<IpcRequest<'recipe:row'>, 'documentId'>;
export type RowAnswer = IpcResponse<'recipe:row'>;
type OpenedRow = Extract<RowAnswer, { values: unknown }>;

type PageRow = Extract<RowsAnswer, { rows: unknown }>['rows'][number];

export interface CardsViewOptions {
  readonly index: number;
  /** The run the window was shown; main answers `stale` once the cell ran again. */
  readonly ranAt: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly total: number;
  readonly locale: Locale;
  /** The columns a card shows, the first as its title. */
  readonly fields: readonly string[];
  readonly rows: (request: RowsRequest) => Promise<RowsAnswer>;
  readonly row: (request: RowRequest) => Promise<RowAnswer>;
}

export function cardsView(options: CardsViewOptions): HTMLElement {
  const { locale, fields } = options;
  const say = (key: CatalogueKey): string => translate(locale, key);
  const count = (value: number): string => new Intl.NumberFormat(locale).format(value);
  const types = new Map(options.columns.map((column) => [column.name, column.type]));

  let filter = '';
  let total = options.total;
  let matched = options.total;
  let note = '';
  let cards: PageRow[] = [];
  let answered: readonly string[] = fields;
  let asking = false;
  let generation = 0;

  const root = element('div', 'recipe-cell__body recipe-cards');
  root.dataset['view'] = 'cards';
  const bar = element('div', 'recipe-table__bar');
  const search = element('input', 'recipe-table__filter');
  search.type = 'search';
  search.placeholder = say('recipe.table.filter');
  search.setAttribute('aria-label', say('recipe.table.filter'));
  const counter = element('span', 'recipe-table__count');
  const said = element('span', 'recipe-table__note');
  bar.append(search, counter, said);
  const grid = element('div', 'recipe-cards__grid');
  const more = element('button', 'recipe-cell__action recipe-cards__more');
  more.type = 'button';
  more.addEventListener('click', () => {
    ask();
  });
  root.append(bar, grid, more);

  /** The next page of cards under the ones drawn, for the filter in force; `first` starts over. */
  function ask(first = false): void {
    const page = first ? { offset: 0, limit: CARDS_PAGE } : nextCards(cards.length, matched);
    if (page === undefined || asking) return;
    asking = true;
    const mine = generation;
    void options
      .rows({
        index: options.index,
        ranAt: options.ranAt,
        ...page,
        columns: [...fields],
        ...(filter === '' ? {} : { filter }),
      })
      .then((answer) => {
        if (mine !== generation) return;
        asking = false;
        if ('stale' in answer) note = say('recipe.table.stale');
        else {
          cards.push(...answer.rows);
          answered = answer.columns;
          total = answer.total;
          matched = answer.matched;
        }
        draw();
      })
      .catch(() => {
        // "N more" asks again: a failed page is not a page.
        if (mine === generation) asking = false;
        draw();
      });
  }

  /** Starts over from the first page: every drawn card belongs to the old filter. */
  function load(): void {
    generation += 1;
    cards = [];
    asking = false;
    ask(true);
  }

  function draw(): void {
    counter.textContent =
      matched === total
        ? say('recipe.table.rows').replace('{count}', count(total))
        : say('recipe.table.matched')
            .replace('{matched}', count(matched))
            .replace('{total}', count(total));
    said.textContent = note;
    grid.replaceChildren(...cards.map(drawCard));
    const left = Math.max(0, matched - cards.length);
    more.hidden = left === 0 || asking;
    more.textContent = say('recipe.cards.more').replace('{count}', count(left));
    remeasureCellOutput(root.closest<HTMLElement>('.cm-cell-output') ?? root);
  }

  function drawCard(row: PageRow): HTMLElement {
    const card = element('article', 'recipe-cards__card');
    card.dataset['key'] = row.key;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const valueOf = (field: string): WireValue => {
      const at = answered.indexOf(field);
      return at < 0 ? null : (row.values[at] ?? null);
    };
    const title = String(valueOf(fields[0] ?? '') ?? row.key);
    card.setAttribute('aria-label', `${say('recipe.cards.open')}: ${title}`);
    fields.forEach((field, place) => {
      const value = valueOf(field);
      const line = element('div', place === 0 ? 'recipe-cards__title' : 'recipe-cards__field');
      line.dataset['field'] = field;
      if (place > 0) {
        const label = element('span', 'recipe-cards__label');
        label.textContent = `${field}: `;
        line.append(label);
      }
      // A link on a card is text: the click opens the card, and the opened card holds the link.
      line.append(showValue(value, types.get(field) ?? 'text', locale).text);
      line.title = value === null ? '' : String(value);
      card.append(line);
    });
    const open = (): void => {
      openCard(row.key, title, card);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
    return card;
  }

  function openCard(key: string, title: string, from: HTMLElement): void {
    void options.row({ index: options.index, ranAt: options.ranAt, key }).then((answer) => {
      if ('stale' in answer) {
        note = say('recipe.table.stale');
        draw();
        return;
      }
      showOpened(answer, title, from);
    });
  }

  /** The whole row over the window, in the dialog frame the window's other dialogs use. */
  function showOpened(opened: OpenedRow, title: string, from: HTMLElement): void {
    document.querySelector('.recipe-card-dialog')?.remove();
    const scrim = element('div', 'recipe-card-dialog');
    const panel = element('div', 'recipe-card-dialog__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    const heading = element('h2', 'recipe-card-dialog__title');
    heading.textContent = title;

    const values = element('dl', 'recipe-card-dialog__fields');
    opened.columns.forEach((column, at) => {
      values.append(
        ...entry(column.name, opened.values[at] ?? null, column.type, { field: column.name }),
      );
    });

    const { source, id, fetchedAt } = opened.provenance;
    const provenance = element('dl', 'recipe-card-dialog__provenance');
    provenance.append(
      ...entry(say('recipe.cards.source'), source, 'text', { provenance: 'source' }),
      ...entry(say('recipe.cards.id'), id, 'text', { provenance: 'id' }),
      ...entry(say('recipe.cards.fetchedAt'), fetchedAt, 'datetime', { provenance: 'fetchedAt' }),
    );
    const link = rowLink(opened.columns, opened.values);
    if (link !== undefined) {
      provenance.append(...entry(say('recipe.cards.link'), link, 'link', { provenance: 'link' }));
    }

    const actions = element('div', 'recipe-card-dialog__actions');
    const close = element('button', 'recipe-card-dialog__close');
    close.type = 'button';
    close.textContent = say('recipe.cards.close');
    actions.append(close);
    panel.append(heading, values, provenance, actions);
    scrim.append(panel);

    const dismiss = (): void => {
      scrim.remove();
      if (from.isConnected) from.focus();
    };
    close.addEventListener('click', dismiss);
    scrim.addEventListener('click', (event) => {
      if (event.target === scrim) dismiss();
    });
    scrim.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      dismiss();
    });
    document.body.append(scrim);
    close.focus();
  }

  /**
   * One name and its value, the value an anchor only for an address the browser may open.
   * `marks` names it apart for a column (`data-field`) or a provenance line (`data-provenance`),
   * since a column may be called `source` too.
   */
  function entry(
    name: string,
    value: WireValue,
    type: string,
    marks: Readonly<Record<string, string>>,
  ): HTMLElement[] {
    const term = element('dt', 'recipe-card-dialog__name');
    term.textContent = name;
    const detail = element('dd', 'recipe-card-dialog__value');
    Object.assign(detail.dataset, marks);
    const shown = showValue(value, type, locale);
    if (shown.href === undefined) detail.textContent = shown.text;
    else {
      const anchor = element('a', 'recipe-table__link');
      anchor.href = shown.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = shown.text;
      detail.append(anchor);
    }
    return [term, detail];
  }

  search.addEventListener('input', () => {
    filter = search.value;
    load();
  });

  draw();
  load();
  return root;
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
): HTMLElementTagNameMap[Tag] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}
