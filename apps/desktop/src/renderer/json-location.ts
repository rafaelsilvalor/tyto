import { type Node, findNodeAtLocation } from 'jsonc-parser';

/**
 * What the app files' suggestions need to know about the text around the cursor, beyond
 * `jsonc-parser`'s `getLocation` (TYTO-304, ADR 0092). Shared by `settings-assist.ts` and
 * `keybindings-assist.ts`, so the two tabs agree on where a word starts and when a comma goes in.
 */

/** The string token around `position`, when the cursor is inside one (its quotes excluded). */
export function stringAt(
  previous: Node | undefined,
  position: number,
): { readonly from: number } | undefined {
  // A key being typed comes back as `property`, a value as `string`; both are the string token.
  if (previous === undefined || (previous.type !== 'string' && previous.type !== 'property')) {
    return undefined;
  }
  const start = previous.offset + 1;
  // An unclosed string runs to the cursor; a closed one ends before its closing quote.
  if (position < start || position > previous.offset + previous.length) return undefined;
  return { from: start };
}

/** The word right before the cursor, for a value written without quotes: `tr` of `true`. */
export const wordBefore = (text: string, position: number): number =>
  position - (/[\w.-]*$/u.exec(text.slice(0, position))?.[0].length ?? 0);

/** The first character after `position` that is not blank, skipping one closing quote. */
export function nextNonBlank(text: string, position: number): string {
  const rest = text.slice(position).replace(/^[^\s"]*"?/u, '');
  return rest.trimStart().charAt(0);
}

/** The keys of the object at `path`, apart from the one being typed. */
export function writtenKeys(
  tree: Node | undefined,
  path: readonly (string | number)[],
): Set<string> {
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, [...path]);
  const keys = new Set<string>();
  if (node?.type !== 'object') return keys;
  for (const property of node.children ?? []) {
    const key = property.children?.[0];
    if (key !== undefined && typeof key.value === 'string') keys.add(key.value);
  }
  return keys;
}
