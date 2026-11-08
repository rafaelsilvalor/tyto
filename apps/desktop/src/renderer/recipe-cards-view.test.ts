// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type RowAnswer, type RowRequest, cardsView } from './recipe-cards-view.js';
import type { RowsAnswer, RowsRequest } from './recipe-table-view.js';

/**
 * The Cards view in jsdom (TYTO-384), against a stand-in for main. A card shows only the fields
 * it is sent; **the opened card shows what `recipe:row` answers**, which holds columns no card
 * was sent, so a dialog drawn from the card's own values would miss them.
 */

const RAN_AT = '2026-11-07T12:00:00.000Z';
const COLUMNS = [
  { name: 'key', type: 'text' },
  { name: 'title', type: 'text' },
  { name: 'owner', type: 'text' },
  { name: 'secret', type: 'text' },
  { name: 'local', type: 'link' },
  { name: 'site', type: 'link' },
];

const valuesOf = (n: number): Record<string, string> => ({
  key: `C-${String(n)}`,
  title: `Card ${String(n)}`,
  owner: n % 2 === 0 ? 'Ana' : 'Rui',
  secret: `only when opened ${String(n)}`,
  local: 'file:///C:/Windows/notepad.exe',
  site: `https://example.com/C-${String(n)}`,
});

function fakeMain(matched = 100) {
  const rows = vi.fn((request: RowsRequest): Promise<RowsAnswer> => {
    const count = request.filter === undefined ? matched : 3;
    const columns = request.columns ?? COLUMNS.map((column) => column.name);
    const page = Array.from(
      { length: Math.max(0, Math.min(request.limit, count - request.offset)) },
      (_, index) => {
        const values = valuesOf(request.offset + index + 1);
        return { key: values['key'] ?? '', values: columns.map((name) => values[name] ?? null) };
      },
    );
    return Promise.resolve({ columns, rows: page, total: matched, matched: count });
  });
  const row = vi.fn((request: RowRequest): Promise<RowAnswer> => {
    if (request.key === 'gone') return Promise.resolve({ stale: true });
    const values = valuesOf(Number(request.key.slice(2)));
    return Promise.resolve({
      columns: COLUMNS,
      values: COLUMNS.map((column) => values[column.name] ?? null),
      provenance: { source: 'acme.pull', id: '10001', fetchedAt: '2026-11-07T09:00:00.000Z' },
    });
  });
  return { rows, row };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(main = fakeMain(), fields = ['title', 'owner']) {
  const root = cardsView({
    index: 2,
    ranAt: RAN_AT,
    columns: COLUMNS,
    total: 100,
    locale: 'en',
    fields,
    rows: main.rows,
    row: main.row,
  });
  document.body.replaceChildren(root);
  await settle();
  return { root, main };
}

const dialog = () => document.querySelector<HTMLElement>('.recipe-card-dialog');
/** The opened card's lines: columns by name, provenance lines as `provenance.<line>`. */
const opened = () =>
  Object.fromEntries(
    [...(dialog()?.querySelectorAll<HTMLElement>('.recipe-card-dialog__value') ?? [])].map(
      (value) => [
        value.dataset['field'] ?? `provenance.${value.dataset['provenance'] ?? ''}`,
        value.textContent,
      ],
    ),
  );

afterEach(() => {
  document.body.replaceChildren();
});

describe('the Cards view (TYTO-384)', () => {
  it('draws a page of cards with fields=, and "N more" asks for the next page', async () => {
    const { root, main } = await render();

    expect(main.rows).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 48, columns: ['title', 'owner'] }),
    );
    const cards = root.querySelectorAll<HTMLElement>('.recipe-cards__card');
    expect(cards).toHaveLength(48);
    expect([...(cards[0]?.children ?? [])].map((line) => line.textContent)).toEqual([
      'Card 1',
      'owner: Rui',
    ]);
    expect(root.querySelector('.recipe-table__count')?.textContent).toBe('Rows: 100');
    const more = root.querySelector<HTMLButtonElement>('.recipe-cards__more');
    expect(more?.textContent).toBe('52 more');

    more?.click();
    await settle();
    expect(main.rows).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 48, limit: 48 }));
    expect(root.querySelectorAll('.recipe-cards__card')).toHaveLength(96);
  });

  it('starts over from the first page when the filter changes', async () => {
    const { root, main } = await render();
    const search = root.querySelector<HTMLInputElement>('.recipe-table__filter');
    if (search === null) throw new Error('no filter');

    search.value = 'Card 1';
    search.dispatchEvent(new Event('input'));
    await settle();

    expect(main.rows).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, filter: 'Card 1' }),
    );
    expect(root.querySelectorAll('.recipe-cards__card')).toHaveLength(3);
    expect(root.querySelector('.recipe-table__count')?.textContent).toBe('Rows: 3 of 100');
    expect(root.querySelector<HTMLButtonElement>('.recipe-cards__more')?.hidden).toBe(true);
  });

  it('opens a card onto every column of its row and its provenance, and Escape closes it', async () => {
    const { root, main } = await render();
    const card = root.querySelectorAll<HTMLElement>('.recipe-cards__card')[4];
    card?.click();
    await settle();

    expect(main.row).toHaveBeenCalledWith({ index: 2, ranAt: RAN_AT, key: 'C-5' });
    expect(dialog()?.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.querySelector('.recipe-card-dialog__title')?.textContent).toBe('Card 5');
    // `key`, `secret` and the links are no field of the card; the opened card has them all.
    expect(opened()).toMatchObject({
      key: 'C-5',
      title: 'Card 5',
      owner: 'Rui',
      secret: 'only when opened 5',
      site: 'https://example.com/C-5',
      'provenance.source': 'acme.pull',
      'provenance.id': '10001',
      'provenance.link': 'https://example.com/C-5',
    });
    expect(opened()['provenance.fetchedAt']).not.toBe('');
    expect(document.activeElement?.className).toBe('recipe-card-dialog__close');

    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it('draws only a web address as an anchor: a file: link stays text', async () => {
    const { root } = await render();
    root.querySelector<HTMLElement>('.recipe-cards__card')?.click();
    await settle();

    const anchors = [...(dialog()?.querySelectorAll('a') ?? [])].map((anchor) => anchor.href);
    expect(anchors).toEqual(['https://example.com/C-1', 'https://example.com/C-1']);
    const local = dialog()?.querySelector('[data-field="local"]');
    expect(local?.querySelector('a')).toBeNull();
    expect(local?.textContent).toBe('file:///C:/Windows/notepad.exe');
  });

  it('opens with Enter, closes on the close button, and says a row gone is stale', async () => {
    const main = fakeMain();
    const { root } = await render(main);
    const card = root.querySelector<HTMLElement>('.recipe-cards__card');
    card?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    dialog()?.querySelector<HTMLButtonElement>('.recipe-card-dialog__close')?.click();
    expect(dialog()).toBeNull();

    main.row.mockResolvedValueOnce({ stale: true });
    card?.click();
    await settle();
    expect(dialog()).toBeNull();
    expect(root.querySelector('.recipe-table__note')?.textContent).not.toBe('');
  });
});
