import type { CellValue, Table } from '../table.js';

/**
 * Two neutral workflows, shaped like the ones Buraqueira's status tests measured
 * (`tests/test_status.py`): a sheet's five statuses (`map`), each mapped to a status of a
 * tracker, and the tracker's arrows between its statuses (`graph`). The first walks every task
 * through an approval; the second has no arrow from approval to its end, and spells approval
 * with an accent the sheet does not write. `also` names a tracker status only the reverse
 * direction has, and `avoid` the statuses no walk passes through or ends in.
 */
export const FLOWS = {
  first: {
    map: {
      todo: 'TO DO',
      doing: 'DOING',
      approval: 'APPROVAL',
      review: 'DOING 2',
      done: 'DONE',
    },
    also: { FINISHED: 'done' },
    graph: {
      'TO DO': ['DOING', 'CANCELLED', 'ARCHIVED'],
      DOING: ['APPROVAL', 'TO DO'],
      APPROVAL: ['APPROVED', 'ARCHIVED'],
      APPROVED: ['DOING 2'],
      'DOING 2': ['DONE'],
    },
  },
  second: {
    map: {
      todo: 'TO DO',
      doing: 'IN PROGRESS',
      approval: 'APPROVÁL',
      review: 'REVIEW',
      done: 'Finished',
    },
    graph: {
      'TO DO': ['IN PROGRESS', 'Backlog', 'CANCELLED'],
      'IN PROGRESS': ['REVIEW', 'Finished', 'APPROVÁL', 'TO DO', 'WAITING'],
      APPROVÁL: ['TO DO', 'APPROVED', 'WAITING'],
      REVIEW: ['TO DO'],
      Finished: ['TO DO'],
    },
  },
  avoid: ['CANCELLED', 'ARCHIVED', 'Backlog', 'WAITING'],
} as const;

/** A table of tasks with the columns given, keyed `T-0`, `T-1`… in order. */
export function tasks(columns: readonly string[], rows: readonly (readonly CellValue[])[]): Table {
  return {
    columns: ['key', ...columns].map((name) => ({ name, type: 'text', origin: 'test' })),
    rows: rows.map((cells, index) => {
      const key = `T-${String(index)}`;
      const values: Record<string, CellValue> = { key };
      columns.forEach((name, position) => {
        values[name] = cells[position] ?? null;
      });
      return { key, values, provenance: { source: 'test', id: key, fetchedAt: '2026-10-25' } };
    }),
  };
}
