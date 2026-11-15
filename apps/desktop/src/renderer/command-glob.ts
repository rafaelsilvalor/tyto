/**
 * Globs on the command panel's line (TYTO-535, ADR 0200): `render *.brief` runs `render` with
 * every brief the pattern names, expanded by the panel before `cli:run` sees the words.
 *
 * **Only inside the workspace, and only through the explorer's listings.** A pattern is a path
 * under the panel's working folder; every folder it reads is listed by the explorer's ids, as
 * completion lists them (`listFolderAt`, ADR 0113), so no path crosses to main for it and a
 * pattern cannot reach a folder the explorer does not show. A pattern that starts at a root
 * (`/`, `C:\`, `\\server`), that starts with `~`, or that has a `..` step is refused rather
 * than expanded.
 *
 * The shell's rules, the small part of them: `*` is any run of characters and `?` one, within
 * one name — a glob never crosses a separator, and there is no `**`; neither matches a leading
 * dot unless the pattern's name starts with one. A pattern that matches nothing is refused, as
 * bash's `failglob` does, so a command never receives a literal `*.brief` as a file name.
 */

import type { ListedEntry } from './command-completion.js';

/** The most words one pattern may become: more is almost surely a pattern typed by mistake. */
export const GLOB_LIMIT = 1000;

/** The entries of a folder, by its steps under the workspace root, or `undefined` when none. */
export type ListFolder = (
  segments: readonly string[],
) => Promise<readonly ListedEntry[] | undefined>;

export type GlobExpansion =
  | { readonly ok: true; readonly words: readonly string[] }
  | {
      readonly ok: false;
      readonly problem: 'outside' | 'no-folder' | 'no-match' | 'too-many';
      readonly pattern: string;
    };

/** Whether an unquoted word is a pattern: it has a `*` or a `?`. */
export const isGlob = (word: string): boolean => /[*?]/u.test(word);

const ROOTED = /^(?:[A-Za-z]:|[\\/]|~)/u;

/** The name `pattern` (one step, no separator) as a regular expression. */
function nameMatcher(pattern: string, caseless: boolean): (name: string) => boolean {
  const source = [...pattern]
    .map((character) =>
      character === '*'
        ? '.*'
        : character === '?'
          ? '.'
          : character.replace(/[.+^${}()|[\]\\]/gu, '\\$&'),
    )
    .join('');
  const expression = new RegExp(`^${source}$`, caseless ? 'iu' : 'u');
  const dotted = pattern.startsWith('.');
  return (name) => (dotted || !name.startsWith('.')) && expression.test(name);
}

/**
 * The words `pattern` becomes: the matching entries under `base` (the panel's working folder, as
 * steps under the workspace root), each written the way the pattern was — relative to `base`,
 * with the separator typed — in name order. `folder` is whether a workspace folder is open.
 */
export async function expandGlob(
  pattern: string,
  base: readonly string[],
  list: ListFolder,
  options: { readonly caseless: boolean; readonly folder: boolean },
): Promise<GlobExpansion> {
  const refuse = (problem: 'outside' | 'no-folder' | 'no-match' | 'too-many'): GlobExpansion => ({
    ok: false,
    problem,
    pattern,
  });
  if (ROOTED.test(pattern)) return refuse('outside');
  const steps = pattern.split(/[\\/]+/u).filter((step) => step !== '' && step !== '.');
  if (steps.includes('..')) return refuse('outside');
  if (!options.folder) return refuse('no-folder');
  const separator = pattern.includes('\\') && !pattern.includes('/') ? '\\' : '/';

  // Each partial match: the steps under `base` it walked, folders all but maybe the last.
  let found: { readonly steps: readonly string[]; readonly kind: ListedEntry['kind'] }[] = [
    { steps: [], kind: 'folder' },
  ];
  for (const [index, step] of steps.entries()) {
    const last = index === steps.length - 1;
    const matches = isGlob(step)
      ? nameMatcher(step, options.caseless)
      : (name: string) =>
          options.caseless ? name.toLowerCase() === step.toLowerCase() : name === step;
    const next: typeof found = [];
    for (const partial of found) {
      if (partial.kind !== 'folder') continue;
      const entries = (await list([...base, ...partial.steps])) ?? [];
      for (const entry of entries) {
        if (!matches(entry.name)) continue;
        if (!last && entry.kind !== 'folder') continue;
        next.push({ steps: [...partial.steps, entry.name], kind: entry.kind });
      }
    }
    if (next.length > GLOB_LIMIT) return refuse('too-many');
    found = next;
  }
  if (found.length === 0) return refuse('no-match');
  const words = found
    .map((match) => match.steps.join(separator))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return { ok: true, words };
}
