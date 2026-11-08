import { remeasureCellOutput } from '@tyto/editor';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import {
  type BoardGroup,
  type BoardOptions,
  EMPTY_GROUP,
  askedColumns,
  nextPage,
  notDrawn,
} from './recipe-board-model.js';
import { type WireValue, showValue } from './recipe-table-model.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * The Board view under a recipe's cell (TYTO-381, ADR 0177): one column per value of `by=`, a
 * card per row showing `fields=`.
 *
 * **Main counts and groups** (`recipe:facets`); the board draws the columns in the order main
 * sent them, with main's counts, and each column asks main for its own rows, fifty at a time
 * (`recipe:rows` with `facet`). The quick filter changes what main counts. An answer to a
 * filter since replaced is dropped, by generation. View only: a card is not dragged (ADR 0129).
 */

export type FacetsRequest = Omit<IpcRequest<'recipe:facets'>, 'documentId'>;
export type FacetsAnswer = IpcResponse<'recipe:facets'>;

type PageRow = Extract<RowsAnswer, { rows: unknown }>['rows'][number];

export interface BoardViewOptions {
  readonly index: number;
  /** The run the window was shown; main answers `stale` once the cell ran again. */
  readonly ranAt: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly total: number;
  readonly locale: Locale;
  readonly board: BoardOptions;
  readonly facets: (request: FacetsRequest) => Promise<FacetsAnswer>;
  readonly rows: (request: RowsRequest) => Promise<RowsAnswer>;
}

interface Lane {
  readonly group: BoardGroup;
  readonly cards: PageRow[];
  /** The columns the cards' values follow, as main answered. */
  columns: readonly string[];
  asking: boolean;
}

export function boardView(options: BoardViewOptions): HTMLElement {
  const { locale, board } = options;
  const say = (key: CatalogueKey): string => translate(locale, key);
  const count = (value: number): string => new Intl.NumberFormat(locale).format(value);
  const types = new Map(options.columns.map((column) => [column.name, column.type]));
  const asked = askedColumns(board);

  let filter = '';
  let total = options.total;
  let matched = options.total;
  let more = 0;
  let note = '';
  let lanes: Lane[] = [];
  let generation = 0;

  const root = element('div', 'recipe-cell__body recipe-board');
  root.dataset['view'] = 'board';
  const bar = element('div', 'recipe-table__bar');
  const search = element('input', 'recipe-table__filter');
  search.type = 'search';
  search.placeholder = say('recipe.table.filter');
  search.setAttribute('aria-label', say('recipe.table.filter'));
  const counter = element('span', 'recipe-table__count');
  const said = element('span', 'recipe-table__note');
  bar.append(search, counter, said);
  const columns = element('div', 'recipe-board__columns');
  root.append(bar, columns);

  /** Asks main for the groups again: every drawn card belongs to the old filter. */
  function load(): void {
    generation += 1;
    const asking = generation;
    void options
      .facets({
        index: options.index,
        ranAt: options.ranAt,
        column: board.by,
        columns: asked,
        ...(board.order === undefined ? {} : { order: [...board.order] }),
        ...(filter === '' ? {} : { filter }),
      })
      .then((answer) => {
        if (asking !== generation) return;
        if ('stale' in answer) {
          note = say('recipe.table.stale');
          draw();
          return;
        }
        total = answer.total;
        matched = answer.matched;
        more = answer.more;
        lanes = answer.facets.map((group) => ({ group, cards: [], columns: asked, asking: false }));
        draw();
        for (const lane of lanes) ask(lane);
      });
  }

  /** The column's next fifty cards, appended under the ones it has. */
  function ask(lane: Lane): void {
    const page = nextPage(lane.group, lane.cards.length);
    if (page === undefined || lane.asking) return;
    lane.asking = true;
    const asking = generation;
    void options
      .rows({
        index: options.index,
        ranAt: options.ranAt,
        ...page,
        columns: asked,
        ...(filter === '' ? {} : { filter }),
        facet: { column: board.by, keys: [lane.group.key] },
      })
      .then((answer) => {
        if (asking !== generation) return;
        lane.asking = false;
        if ('stale' in answer) {
          note = say('recipe.table.stale');
        } else {
          lane.cards.push(...answer.rows);
          lane.columns = answer.columns;
        }
        draw();
      })
      .catch(() => {
        // "N more" asks again: a failed page is not a page.
        lane.asking = false;
        draw();
      });
  }

  function draw(): void {
    counter.textContent =
      matched === total
        ? say('recipe.table.rows').replace('{count}', count(total))
        : say('recipe.table.matched')
            .replace('{matched}', count(matched))
            .replace('{total}', count(total));
    const groups = more > 0 ? say('recipe.board.groups').replace('{count}', count(more)) : '';
    said.textContent = [groups, note].filter((part) => part !== '').join(' ');
    columns.replaceChildren(...lanes.map(drawLane));
    remeasureCellOutput(root.closest<HTMLElement>('.cm-cell-output') ?? root);
  }

  function drawLane(lane: Lane): HTMLElement {
    const section = element('section', 'recipe-board__column');
    section.dataset['key'] = lane.group.key;
    const heading = element('header', 'recipe-board__heading');
    const name = element('span', 'recipe-board__name');
    const none = lane.group.key === EMPTY_GROUP;
    name.textContent = none ? say('recipe.board.none') : lane.group.label;
    const tally = element('span', 'recipe-board__tally');
    tally.textContent = count(lane.group.count);
    heading.append(name, tally);
    const cards = element('div', 'recipe-board__cards');
    cards.append(...lane.cards.map((row) => drawCard(row, lane.columns)));
    section.append(heading, cards);
    const left = notDrawn(lane.group, lane.cards.length);
    if (left > 0 && !lane.asking) {
      const button = element('button', 'recipe-cell__action recipe-board__more');
      button.type = 'button';
      button.textContent = say('recipe.board.more').replace('{count}', count(left));
      button.addEventListener('click', () => {
        ask(lane);
      });
      section.append(button);
    }
    return section;
  }

  function drawCard(row: PageRow, answered: readonly string[]): HTMLElement {
    const card = element('article', 'recipe-board__card');
    card.dataset['key'] = row.key;
    board.fields.forEach((field, place) => {
      const at = answered.indexOf(field);
      const value: WireValue = at < 0 ? null : (row.values[at] ?? null);
      const shown = showValue(value, types.get(field) ?? 'text', locale);
      const line = element('div', place === 0 ? 'recipe-board__title' : 'recipe-board__field');
      line.dataset['field'] = field;
      if (place > 0) {
        const label = element('span', 'recipe-board__label');
        label.textContent = `${field}: `;
        line.append(label);
      }
      if (shown.href === undefined) line.append(shown.text);
      else {
        const anchor = element('a', 'recipe-table__link');
        anchor.href = shown.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = shown.text;
        line.append(anchor);
      }
      line.title = value === null ? '' : String(value);
      card.append(line);
    });
    return card;
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
