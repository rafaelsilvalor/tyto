/**
 * The example recipe plugin: a paged source, a transform, a derivation and an action, all in
 * the `example` namespace its tyto-plugin.json declares (ADR 0135).
 *
 *   example.pull count=7 size=3   seven numbered items, three to a page
 *   example.tag <label>           adds a `tag` column holding the label
 *   derive example.parity         adds `parity`, even or odd, from `number`
 *   example.mark <label>          plans one `mark` write per row; applying the plan keeps
 *                                 each row's mark in the plugin's private cache
 *
 * Every answer is a result, `{ ok: true, value, diagnostics: [] }`, so a failure is a value
 * the notebook shows under the cell rather than a throw. Plain ES module JavaScript with no
 * imports, so there is nothing to build before `tyto plugin install`.
 */

const FETCHED_AT = '2026-10-24T00:00:00.000Z';

const answer = (value) => ({ ok: true, value, diagnostics: [] });

const markKey = (rowKey) => `marks/${rowKey}`;

/** A row's mark as the cache holds it, or `null` when it has none. */
async function markOf(host, rowKey) {
  const entry = await host.cache.get(markKey(rowKey));
  return entry === undefined ? null : new TextDecoder().decode(entry.bytes);
}

function item(number) {
  const key = `EX-${String(number)}`;
  return {
    key,
    values: { title: `Item ${String(number)}`, number },
    provenance: { source: 'example', id: key, fetchedAt: FETCHED_AT },
  };
}

export function activate(host) {
  host.registerRecipeVerb({
    id: 'example.pull',
    kind: 'source',
    arguments: [
      { name: 'count', type: 'number', required: true },
      { name: 'size', type: 'number' },
    ],
    // The cursor is the number the next page starts at; no cursor is the last page.
    page({ arguments: { count, size = 50 }, cursor }) {
      const start = cursor === undefined ? 1 : Number(cursor);
      const end = Math.min(count, start + size - 1);
      const rows = [];
      for (let number = start; number <= end; number++) rows.push(item(number));
      return answer({
        table: {
          columns: [
            { name: 'title', type: 'text', origin: 'example' },
            { name: 'number', type: 'number', origin: 'example' },
          ],
          rows,
        },
        ...(end < count ? { cursor: String(end + 1) } : {}),
      });
    },
  });

  host.registerRecipeVerb({
    id: 'example.tag',
    kind: 'transform',
    arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
    transform({ arguments: { label }, table }) {
      return answer({
        columns: [...table.columns, { name: 'tag', type: 'text', origin: 'example.tag' }],
        rows: table.rows.map((row) => ({ ...row, values: { ...row.values, tag: label } })),
      });
    },
  });

  // An action answers a plan: what it would write, row by row, and writes nothing (ADR 0129).
  // Each operation's payload carries the mark the row had when planned; `apply` gets the plan
  // back as shown, a batch at a time, and refuses a row whose mark moved since (ADR 0170).
  host.registerRecipeVerb({
    id: 'example.mark',
    kind: 'action',
    arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
    writes: ['mark'],
    async plan({ arguments: { label }, table }) {
      const operations = [];
      for (const row of table.rows) {
        const expected = await markOf(host, row.key);
        operations.push({
          write: 'mark',
          rowKey: row.key,
          description: `Mark ${row.key} as '${label}'`,
          payload: { id: row.key, expected, mark: label },
        });
      }
      return answer({ target: 'example items', operations, count: operations.length });
    },
    async apply({ operations }) {
      const applied = [];
      for (const { payload } of operations) {
        const now = await markOf(host, payload.id);
        if (now !== payload.expected) {
          applied.push({
            status: 'failed',
            reason: `${payload.id} is marked '${String(now)}' now, not '${String(payload.expected)}' as planned`,
          });
          continue;
        }
        await host.cache.put(markKey(payload.id), payload.mark);
        applied.push({ status: 'applied' });
      }
      return answer({ operations: applied });
    },
  });

  host.registerRecipeDerivation({
    id: 'example.parity',
    requires: ['number'],
    produces: ['parity'],
    derive(table) {
      return answer({
        columns: [...table.columns, { name: 'parity', type: 'text', origin: 'example.parity' }],
        rows: table.rows.map((row) => ({
          ...row,
          values: { ...row.values, parity: row.values.number % 2 === 0 ? 'even' : 'odd' },
        })),
      });
    },
  });
}
