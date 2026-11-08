// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { type FacetsAnswer, type FacetsRequest, boardView } from './recipe-board-view.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * The Board view in jsdom (TYTO-381, ADR 0177), against a stand-in for main. **Main's stand-in
 * groups and counts**, and its counts are larger than any page the board is sent, so a board
 * that counted its own cards would draw different numbers than the ones it was sent.
 */

const RAN_AT = '2026-11-07T12:00:00.000Z';
const COLUMNS = [
  { name: 'key', type: 'text' },
  { name: 'status', type: 'text' },
  { name: 'title', type: 'text' },
  { name: 'owner', type: 'text' },
  { name: 'site', type: 'link' },
];

/** 120 To Do, 30 Done, 5 with no status, in main's order. */
const GROUPS = [
  { key: '"to do"', label: 'To Do', count: 120 },
  { key: '"done"', label: 'Done', count: 30 },
  { key: '""', label: '', count: 5 },
];

const rowOf = (group: string, n: number, columns: readonly string[]) => {
  const values: Record<string, string> = {
    key: `${group}-${String(n)}`,
    status: group,
    title: `Card ${group} ${String(n)}`,
    owner: n % 2 === 0 ? 'Ana' : 'Rui',
    site: `https://example.com/${String(n)}`,
  };
  return { key: values['key'] ?? '', values: columns.map((column) => values[column] ?? null) };
};

function fakeMain() {
  let facetsAnswer: (request: FacetsRequest) => FacetsAnswer = (request) =>
    request.filter === undefined
      ? { facets: GROUPS, total: 155, matched: 155, more: 0 }
      : { facets: [{ key: '"done"', label: 'Done', count: 2 }], total: 155, matched: 2, more: 3 };
  const facets = vi.fn((request: FacetsRequest) => Promise.resolve(facetsAnswer(request)));
  const rows = vi.fn((request: RowsRequest): Promise<RowsAnswer> => {
    const key = request.facet?.keys[0] ?? '';
    const group = GROUPS.find((each) => each.key === key);
    const count = request.filter === undefined ? (group?.count ?? 0) : 2;
    const columns = request.columns ?? COLUMNS.map((column) => column.name);
    const page = Array.from(
      { length: Math.max(0, Math.min(request.limit, count - request.offset)) },
      (_, index) => rowOf(group?.label ?? '', request.offset + index + 1, columns),
    );
    return Promise.resolve({ columns, rows: page, total: 155, matched: count });
  });
  return {
    facets,
    rows,
    answerFacets(next: (request: FacetsRequest) => FacetsAnswer) {
      facetsAnswer = next;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(main = fakeMain(), fields = ['title', 'owner']) {
  const root = boardView({
    index: 3,
    ranAt: RAN_AT,
    columns: COLUMNS,
    total: 155,
    locale: 'en',
    board: { by: 'status', order: ['To Do', 'Done'], fields },
    facets: main.facets,
    rows: main.rows,
  });
  document.body.replaceChildren(root);
  await settle();
  await settle();
  return { root, main };
}

const lanes = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.recipe-board__column')].map((lane) => ({
    name: lane.querySelector('.recipe-board__name')?.textContent,
    tally: lane.querySelector('.recipe-board__tally')?.textContent,
    cards: lane.querySelectorAll('.recipe-board__card').length,
    more: lane.querySelector('.recipe-board__more')?.textContent,
  }));

describe('the Board view (TYTO-381)', () => {
  it("draws main's groups in main's order with main's counts, an empty value as (none)", async () => {
    const { root, main } = await render();

    expect(lanes(root)).toEqual([
      { name: 'To Do', tally: '120', cards: 50, more: '70 more' },
      { name: 'Done', tally: '30', cards: 30, more: undefined },
      { name: '(none)', tally: '5', cards: 5, more: undefined },
    ]);
    expect(root.querySelector('.recipe-table__count')?.textContent).toBe('Rows: 155');
    expect(main.facets).toHaveBeenCalledWith({
      index: 3,
      ranAt: RAN_AT,
      column: 'status',
      columns: ['status', 'title', 'owner'],
      order: ['To Do', 'Done'],
    });
    expect(main.rows.mock.calls.map(([request]) => request)).toEqual(
      GROUPS.map((group) => ({
        index: 3,
        ranAt: RAN_AT,
        offset: 0,
        limit: Math.min(50, group.count),
        columns: ['status', 'title', 'owner'],
        facet: { column: 'status', keys: [group.key] },
      })),
    );
  });

  it('shows the fields asked on each card, the first as its title', async () => {
    const { root } = await render(fakeMain(), ['title', 'owner', 'site']);
    const card = root.querySelector('.recipe-board__card');
    expect(card?.querySelector('.recipe-board__title')?.textContent).toBe('Card To Do 1');
    expect(
      [...(card?.querySelectorAll<HTMLElement>('.recipe-board__field') ?? [])].map(
        (line) => line.textContent,
      ),
    ).toEqual(['owner: Rui', 'site: https://example.com/1']);
    expect(card?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/1');
    expect(card?.textContent).not.toContain('To Do-1');
  });

  it('asks a column for its next fifty cards from where it stopped', async () => {
    const { root, main } = await render();
    root.querySelector<HTMLButtonElement>('.recipe-board__more')?.click();
    await settle();

    expect(main.rows.mock.calls.at(-1)?.[0]).toMatchObject({
      offset: 50,
      limit: 50,
      facet: { column: 'status', keys: ['"to do"'] },
    });
    expect(lanes(root)[0]).toEqual({ name: 'To Do', tally: '120', cards: 100, more: '20 more' });
  });

  it('counts again in main on a filter, and drops an answer to the filter it replaced', async () => {
    const main = fakeMain();
    const { root } = await render(main);
    let release: (answer: FacetsAnswer) => void = () => undefined;
    main.facets.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const search = root.querySelector<HTMLInputElement>('.recipe-table__filter');
    if (search === null) throw new Error('no filter box');
    search.value = 'x';
    search.dispatchEvent(new Event('input'));
    search.value = 'xy';
    search.dispatchEvent(new Event('input'));
    await settle();
    await settle();
    release({ facets: GROUPS, total: 155, matched: 155, more: 0 });
    await settle();

    expect(main.facets.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'xy' });
    expect(lanes(root)).toEqual([{ name: 'Done', tally: '2', cards: 2, more: undefined }]);
    expect(root.querySelector('.recipe-table__count')?.textContent).toBe('Rows: 2 of 155');
    expect(root.querySelector('.recipe-table__note')?.textContent).toBe('3 more groups not shown');
  });

  it('says the cell ran again when main answers stale', async () => {
    const main = fakeMain();
    main.answerFacets(() => ({ stale: true }));
    const { root } = await render(main);
    expect(lanes(root)).toEqual([]);
    expect(root.querySelector('.recipe-table__note')?.textContent).toBe(
      'This table ran again: its rows are out of date',
    );
  });
});
