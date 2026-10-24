import { err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { checkTable } from './check-table.js';
import { type PageLimits, type SourcePage, PAGE_LIMITS, pagedSource } from './paging.js';
import type { Row, Table } from './table.js';

const COLUMNS: Table['columns'] = [
  { name: 'title', type: 'text', origin: 'test' },
  { name: 'number', type: 'number', origin: 'test' },
];

function row(number: number): Row {
  const key = `T-${String(number)}`;
  return {
    key,
    values: { title: `Item ${String(number)}`, number },
    provenance: { source: 'test', id: key, fetchedAt: '2026-10-24T00:00:00.000Z' },
  };
}

/** A source of `count` rows, `size` to a page, whose cursor is the next row's number. */
function counting(count: number, size: number, change: Partial<SourcePage> = {}) {
  const calls: (string | undefined)[] = [];
  const fetchPage = (cursor: string | undefined) => {
    calls.push(cursor);
    const start = cursor === undefined ? 1 : Number(cursor);
    const end = Math.min(count, start + size - 1);
    const rows = Array.from({ length: end - start + 1 }, (_, index) => row(start + index));
    const page: SourcePage = {
      table: { columns: COLUMNS, rows },
      ...(end < count ? { cursor: String(end + 1) } : {}),
      ...change,
    };
    return Promise.resolve(ok(page));
  };
  return { calls, fetchPage };
}

const limits = (change: Partial<PageLimits>): PageLimits => ({ ...PAGE_LIMITS, ...change });

async function problemOf(result: Promise<{ ok: boolean; error?: readonly { message: string }[] }>) {
  const settled = await result;
  return settled.ok ? 'ok' : settled.error?.[0]?.message;
}

describe('pagedSource', () => {
  it('asks page after page until no cursor comes back, and answers one table', async () => {
    const { calls, fetchPage } = counting(7, 3);
    const table = await pagedSource('test.pull', fetchPage);
    expect(calls).toEqual([undefined, '4', '7']);
    expect(table.ok && table.value.rows.map((each) => each.key)).toEqual([
      'T-1',
      'T-2',
      'T-3',
      'T-4',
      'T-5',
      'T-6',
      'T-7',
    ]);
  });

  it('refuses a cursor it was already given, which would loop for ever', async () => {
    const { fetchPage } = counting(9, 3, { cursor: '4' });
    expect(await problemOf(pagedSource('test.pull', fetchPage))).toBe(
      "Source 'test.pull' gave the cursor '4' a second time on page 2, so it would never end.",
    );
  });

  it('refuses a page the source says its own limit cut short', async () => {
    const { fetchPage } = counting(3, 3, { truncated: true });
    expect(await problemOf(pagedSource('test.pull', fetchPage))).toBe(
      "Source 'test.pull' says its own limit cut page 1 short, so the table would be incomplete.",
    );
  });

  it('stops at each ceiling with the number it passed, never with a partial table', async () => {
    const cases: [Partial<PageLimits>, string][] = [
      [{ maxPages: 2 }, 'did not finish within 2 pages'],
      [{ maxPageRows: 2 }, 'answered page 1 with 3 rows, over 2'],
      [{ maxRows: 5 }, 'passed 5 rows by page 2'],
      [{ maxPageBytes: 100 }, 'answered page 1 of 521 bytes, over 100'],
    ];
    for (const [ceiling, problem] of cases) {
      const { fetchPage } = counting(9, 3);
      expect(await problemOf(pagedSource('test.pull', fetchPage, limits(ceiling)))).toBe(
        `Source 'test.pull' ${problem}.`,
      );
    }
  });

  it('refuses a page whose columns differ from the first, and a key two pages share', async () => {
    let page = 0;
    const shifting = () => {
      page++;
      const columns = page === 1 ? COLUMNS : COLUMNS.slice(0, 1);
      return Promise.resolve(ok({ table: { columns, rows: [] }, cursor: String(page) }));
    };
    expect(await problemOf(pagedSource('test.pull', shifting))).toBe(
      "Source 'test.pull' answered page 2 with other columns than page 1.",
    );
    const twice = (cursor: string | undefined) =>
      Promise.resolve(
        ok({
          table: { columns: COLUMNS, rows: [row(1)] },
          ...(cursor === undefined ? { cursor: 'next' } : {}),
        }),
      );
    expect(await problemOf(pagedSource('test.pull', twice))).toBe(
      "Source 'test.pull' answered the key 'T-1' twice, again on page 2.",
    );
  });

  it("passes the source's own failure on as it came", async () => {
    const failing = () =>
      Promise.resolve(err([{ severity: 'error', code: 'E_RECIPE_VERB', message: 'no' }] as const));
    expect(await problemOf(pagedSource('test.pull', failing))).toBe('no');
  });
});

describe('checkTable', () => {
  it('names a value outside the columns, a wrong type, a repeated key and column', () => {
    const table: Table = {
      columns: [...COLUMNS, { name: 'Title', type: 'text', origin: 'test' }],
      rows: [row(1), { ...row(2), values: { number: 'two', extra: 1 } }, { ...row(3), key: 'T-1' }],
    };
    const checked = checkTable(table, 'test.pull');
    expect(checked.ok ? '' : checked.error[0]?.message).toBe(
      "The table from 'test.pull' is malformed: column 'Title' appears twice; row 2 ('T-2') " +
        "holds the text 'two' in number column 'number'; row 2 ('T-2') has a value for " +
        "'extra', which is not a column; row 3 repeats the key 'T-1'.",
    );
  });

  it('accepts an empty cell in a column of any type', () => {
    const table: Table = { columns: COLUMNS, rows: [{ ...row(1), values: { number: null } }] };
    expect(checkTable(table, 'test.pull').ok).toBe(true);
  });
});
