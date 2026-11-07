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
    expect(wire.cells[0]?.plan).toEqual({
      target: 'sheet Pauta',
      count: 0,
      operations: [],
      applicable: false,
    });
    expect(wire.cells[0]?.source).toBe(true);
    // What the channel's own schema accepts, so main never puts a shape on the wire it refuses.
    expect(() => parseIpc('recipe:run', 'response', { requestId: 1, ...wire })).not.toThrow();
  });

  // TYTO-378, ADR 0170: the plan's first lines and its id, and an Apply's outcome, counted.
  it('sends the first plan lines cut to text, the plan id, and the Apply counted', () => {
    const operations = Array.from({ length: 60 }, (_, index) => ({
      write: 'mark',
      rowKey: `EX-${String(index)}`,
      description: `Mark EX-${String(index)} ${'x'.repeat(2000)}`,
      payload: { id: index },
    }));
    const wire = recipeAnswerToWire({
      cells: [
        {
          index: 2,
          line: 4,
          status: 'ok',
          plan: { target: 'example items', operations, count: 60 },
          planId: 9,
          applicable: false,
          applied: {
            at: '2026-11-07T12:00:00.000Z',
            operations: operations.map((_, index) =>
              index === 1
                ? { rowKey: 'EX-1', status: 'failed' as const, reason: 'r'.repeat(3000) }
                : index < 50
                  ? { rowKey: `EX-${String(index)}`, status: 'applied' as const }
                  : { status: 'skipped' as const },
            ),
          },
          diagnostics: [],
        },
      ],
      diagnostics: [],
      ranAt: '2026-11-07T12:00:00.000Z',
    });

    const plan = wire.cells[0]?.plan;
    expect(plan?.count).toBe(60);
    expect(plan?.planId).toBe(9);
    expect(plan?.applicable).toBe(false);
    expect(plan?.operations).toHaveLength(RECIPE_WIRE_LIMITS.operations);
    expect(plan?.operations?.[3]?.rowKey).toBe('EX-3');
    expect(plan?.operations?.[3]?.description).toHaveLength(RECIPE_WIRE_LIMITS.text);
    // The payload is the plugin's: it never crosses to the window.
    expect(plan?.operations?.[3]).not.toHaveProperty('payload');
    const applied = wire.cells[0]?.applied;
    expect([applied?.applied, applied?.failed, applied?.skipped]).toEqual([49, 1, 10]);
    expect(applied?.operations).toHaveLength(RECIPE_WIRE_LIMITS.operations);
    expect(applied?.operations[1]?.reason).toHaveLength(RECIPE_WIRE_LIMITS.text);
    expect(() => parseIpc('recipe:run', 'response', { requestId: 1, ...wire })).not.toThrow();
    expect(() => parseIpc('recipe:apply', 'response', { cell: wire.cells[0] })).not.toThrow();
  });

  it('cuts a long text with an ellipsis, and leaves a short one and a scalar alone', () => {
    expect(cut('short')).toBe('short');
    expect(cut('y'.repeat(RECIPE_WIRE_LIMITS.text + 10)).endsWith('…')).toBe(true);
    expect(valueToWire(true)).toBe(true);
    expect(valueToWire(null)).toBeNull();
    expect(valueToWire(undefined)).toBeNull();
  });
});
