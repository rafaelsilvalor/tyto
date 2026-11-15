/**
 * Paths typed on the command panel's line for its file commands (TYTO-537, ADR 0201): `ls`,
 * `cd`, `cat` and the completion of their arguments.
 *
 * **A path is steps under the workspace root, never a string handed to main.** A typed path is
 * read against the session's working folder into steps; each step is then found in the
 * explorer's listing of the folder above it (`explorer:list`, ADR 0113), so what the panel
 * reaches is what the explorer shows, by the ids main minted. The explorer resolves every entry
 * to its real path before listing it and leaves out one that leads outside the folder, so a
 * link or junction pointing out is never a step here. Main checks the id it is handed again at
 * the call (`explorer:read`, `cli:run`'s `folder`): the renderer is not the boundary.
 *
 * Refused before any listing: a path that starts at a root (`/`, `C:\`, `\\server`) or at `~`,
 * and a `..` that would climb above the workspace root. A `..` that stays inside is a step back.
 */

/** What a folder's listing holds, as `explorer:list` answers it. */
export interface PanelEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: 'folder' | 'brief' | 'file';
}

export interface PanelListing {
  readonly entries: readonly PanelEntry[];
  /** Entries past the explorer's cap, counted and not sent. */
  readonly more: number;
}

/** Lists the folder an id names (`null` is the root) through `explorer:list`. */
export type ListById = (entryId: string | null) => Promise<PanelListing>;

export type StepsAnswer =
  | { readonly ok: true; readonly steps: readonly string[] }
  | { readonly ok: false; readonly problem: 'outside' };

const ROOTED = /^(?:[A-Za-z]:|[\\/]|~)/u;

/**
 * The steps under the workspace root that `typed` names from `base`, the working folder. Empty
 * steps and `.` are skipped; `..` goes back one, and is refused once nothing is left to go back
 * from. No listing is read: whether the steps exist is {@link walk}'s.
 */
export function stepsOf(base: readonly string[], typed: string): StepsAnswer {
  if (ROOTED.test(typed)) return { ok: false, problem: 'outside' };
  const steps = [...base];
  for (const step of typed.split(/[\\/]+/u)) {
    if (step === '' || step === '.') continue;
    if (step === '..') {
      if (steps.length === 0) return { ok: false, problem: 'outside' };
      steps.pop();
      continue;
    }
    steps.push(step);
  }
  return { ok: true, steps };
}

/** What a walk found: the root, a folder or a file, with the id main minted for it. */
export type Found =
  | { readonly kind: 'root' }
  | { readonly kind: 'folder' | 'brief' | 'file'; readonly id: string; readonly name: string };

const sameName = (left: string, right: string, caseless: boolean): boolean =>
  caseless ? left.toLowerCase() === right.toLowerCase() : left === right;

/**
 * The entry `steps` names, walking down from the root one listing at a time, or `undefined`
 * when a step is missing or a step before the last is not a folder. The name found is the one
 * on disk, so `cd ENTREGAS` on a disk that ignores case lands on `entregas`.
 */
export async function walk(
  steps: readonly string[],
  list: ListById,
  caseless: boolean,
): Promise<
  | {
      readonly found: Found;
      readonly steps: readonly string[];
      /** The id of every step, top down: what the explorer expands to reveal it. */
      readonly ids: readonly string[];
    }
  | undefined
> {
  let found: Found = { kind: 'root' };
  const named: string[] = [];
  const ids: string[] = [];
  for (const step of steps) {
    if (found.kind !== 'root' && found.kind !== 'folder') return undefined;
    const { entries } = await list(found.kind === 'root' ? null : found.id);
    const entry = entries.find((each) => sameName(each.name, step, caseless));
    if (entry === undefined) return undefined;
    found = { kind: entry.kind, id: entry.id, name: entry.name };
    named.push(entry.name);
    ids.push(entry.id);
  }
  return { found, steps: named, ids };
}

/** The id of the folder `steps` names, `null` for the root, `undefined` when it is not one. */
export async function folderId(
  steps: readonly string[],
  list: ListById,
  caseless: boolean,
): Promise<string | null | undefined> {
  const walked = await walk(steps, list, caseless);
  if (walked === undefined) return undefined;
  if (walked.found.kind === 'root') return null;
  return walked.found.kind === 'folder' ? walked.found.id : undefined;
}

/** What `ls` calls a file: its kind as the explorer names it, and a recipe by its ending. */
export type ListedKind = 'folder' | 'brief' | 'recipe' | 'file';

export const listedKindOf = (entry: Pick<PanelEntry, 'name' | 'kind'>): ListedKind =>
  entry.kind === 'folder' || entry.kind === 'brief'
    ? entry.kind
    : entry.name.toLowerCase().endsWith('.recipe')
      ? 'recipe'
      : 'file';

/** The steps as the prompt and `pwd` write them under the root: `entregas/novembro`. */
export const stepsLabel = (steps: readonly string[]): string => steps.join('/');
