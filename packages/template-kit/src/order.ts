/**
 * The one rule for putting children in the brief's order (ADR 0225), shared by the block column
 * and the layout area (ADR 0232) so the two never disagree. It has its own module because the
 * area is imported by the arrangements the column builds on.
 */

/**
 * The entries in drawing order: the template's own order, with the places of the entries the
 * brief named filled by those entries in the brief's order.
 */
export function columnOrder<Entry extends { readonly name: string }>(
  entries: readonly Entry[],
  order: readonly { readonly name: string }[] | undefined,
): Entry[] {
  if (order === undefined) return [...entries];
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const written: Entry[] = [];
  for (const { name } of order) {
    const entry = byName.get(name);
    if (entry !== undefined && !written.includes(entry)) written.push(entry);
  }
  const queue = [...written];
  return entries.map((entry) => (written.includes(entry) ? queue.shift()! : entry));
}
