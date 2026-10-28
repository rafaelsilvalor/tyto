import type { Table } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { RECIPE_WIRE_LIMITS, parseIpc } from '../../shared/ipc.js';
import { cut, recipeAnswerToWire, valueToWire } from './recipe-wire.js';

/** A recipe cell as it crosses to the window (TYTO-377, ADR 0148): a bounded preview. */
describe('a recipe run on the wire', () => {
  const rows = (count: number): Table['rows'] =>
    Array.from({ length: count }, (_, index) => ({
      key: `T-${String(index)}`,
      values: { key: `T-${String(index)}`, tags: ['a', 'b'], size: index, long: 'x'.repeat(5000) },
      provenance: { source: 'acme', id: String(index), fetchedAt: '2026-10-27T09:00:00.000Z' },
    }));

  it('sends the first rows and how many there are, every value as the notebook shows it', () => {
    const table: Table = {
      columns: [
        { name: 'key', type: 'text', origin: 'acme' },
        { name: 'tags', type: 'list', origin: 'acme' },
        { name: 'size', type: 'number', origin: 'acme' },
        { name: 'long', type: 'text', origin: 'acme' },
        { name: 'absent', type: 'text', origin: 'acme' },
      ],
      rows: rows(120),
    };
    const wire = recipeAnswerToWire({
      cells: [
        {
          index: 0,
          line: 2,
          status: 'ok',
          table,
          plan: { target: 'sheet Pauta', operations: [], count: 0 },
          diagnostics: [],
          ranAt: '2026-10-27T12:00:00.000Z',
          source: true,
        },
      ],
      diagnostics: [],
      ranAt: '2026-10-27T12:00:00.000Z',
    });

    const sent = wire.cells[0]?.table;
    expect(sent?.total).toBe(120);
    expect(sent?.rows).toHaveLength(RECIPE_WIRE_LIMITS.rows);
    expect(sent?.rows[3]?.values.slice(0, 3)).toEqual(['T-3', 'a, b', 3]);
    expect(sent?.rows[3]?.values[3]).toHaveLength(RECIPE_WIRE_LIMITS.text);
    expect(sent?.rows[3]?.values[4]).toBeNull();
    expect(wire.cells[0]?.plan).toEqual({ target: 'sheet Pauta', count: 0 });
    expect(wire.cells[0]?.source).toBe(true);
    // What the channel's own schema accepts, so main never puts a shape on the wire it refuses.
    expect(() => parseIpc('recipe:run', 'response', { requestId: 1, ...wire })).not.toThrow();
  });

  it('cuts a long text with an ellipsis, and leaves a short one and a scalar alone', () => {
    expect(cut('short')).toBe('short');
    expect(cut('y'.repeat(RECIPE_WIRE_LIMITS.text + 10)).endsWith('…')).toBe(true);
    expect(valueToWire(true)).toBe(true);
    expect(valueToWire(null)).toBeNull();
    expect(valueToWire(undefined)).toBeNull();
  });
});
