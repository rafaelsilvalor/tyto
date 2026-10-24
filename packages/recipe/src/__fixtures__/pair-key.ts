import { ok } from '@tyto/core';

import type { Derivation } from '../registry.js';
import { type CellValue, type Row, cellText } from '../table.js';

/**
 * A test derivation shaped like the private plugin's (TYTO-391), over invented titles written
 * `<Team> · <Format> · <Concept>`. It shows what `join` expects of a derivation, and is never
 * registered outside tests: Tyto ships no derivation.
 *
 * It offers two pairing strategies, the way `flow.py` keyed an ad by format and concept and a
 * post by its date. A design row says which one applies to it: a post pairs by date, anything
 * else by name. A row of any other team offers both keys as a list, so whichever strategy its
 * design row chose can find it. A title out of that pattern has no key.
 */
export const pairKey: Derivation = {
  requires: ['title', 'team', 'due'],
  produces: ['deliverable', 'pair_key'],
  derive(table) {
    const rows = table.rows.map((row): Row => ({
      ...row,
      values: { ...row.values, ...derived(row) },
    }));
    return ok({
      table: {
        columns: [
          ...table.columns,
          { name: 'deliverable', type: 'text', origin: 'derive pair-key' },
          { name: 'pair_key', type: 'list', origin: 'derive pair-key' },
        ],
        rows,
      },
    });
  },
};

function derived(row: Row): Record<string, CellValue> {
  const parts = cellText(row.values['title']).split(' · ');
  const [, format, concept] = parts;
  if (parts.length !== 3 || format === undefined || concept === undefined) {
    return { deliverable: null, pair_key: [] };
  }
  const byName = `name:${format} ${concept}`;
  const byDate = `date:${cellText(row.values['due'])}`;
  const design = cellText(row.values['team']) === 'design';
  const keys = design ? [format === 'Post' ? byDate : byName] : [byName, byDate];
  return { deliverable: `${format} ${concept}`, pair_key: keys };
}
