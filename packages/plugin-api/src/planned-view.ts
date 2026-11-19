import type { PlannedRename } from '@tyto/recipe';

import type { WorkspaceEntry } from './capabilities.js';

/**
 * ADR 0219: the workspace as the renames planned above a step leave it, which a plugin's verb
 * reads while it plans under `apply together`. Only renames from `rename-exports`, only while
 * a plan call carries them, and only for the reads a plan makes (`read`, a part, `stat`,
 * `list`); a write, and every call outside such a plan, sees the disk as it is.
 *
 * A view is the plugin's while the plan call that carries it runs. Two such calls of one plugin
 * wait for each other, so neither reads the other's renames. A call of the same plugin that
 * carries none (another recipe's source, an Apply) is not held back, and does see the view
 * while one is up: only for the paths the renames name, which another recipe would read just
 * as the files are renamed under it.
 */

interface View {
  /** Each new name, case folded, with its rename. */
  readonly targets: ReadonlyMap<string, PlannedRename>;
  /** Each old name, case folded. */
  readonly sources: ReadonlySet<string>;
}

const active = new Map<string, View>();
const lanes = new Map<string, Promise<void>>();

/** Runs `work`, a plan call of `plugin`, with the workspace as `renames` leave it. */
export async function withPlannedRenames<T>(
  plugin: string,
  renames: readonly PlannedRename[] | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (renames === undefined || renames.length === 0) return work();
  const before = lanes.get(plugin) ?? Promise.resolve();
  const view: View = {
    targets: new Map(renames.map((rename) => [rename.to.toLowerCase(), rename])),
    sources: new Set(renames.map((rename) => rename.from.toLowerCase())),
  };
  const run = before.then(async () => {
    active.set(plugin, view);
    try {
      return await work();
    } finally {
      active.delete(plugin);
    }
  });
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  lanes.set(plugin, settled);
  void settled.then(() => {
    if (lanes.get(plugin) === settled) lanes.delete(plugin);
  });
  return run;
}

/** Where a read of `path` lands under the plugin's view. */
export type ProjectedPath =
  | { readonly kind: 'as-is' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'renamed'; readonly from: string; readonly name: string };

/** `path` relative to the workspace, `/`-separated, as the checked layer cleaned it. */
export function projectedPath(plugin: string, path: string): ProjectedPath {
  const view = active.get(plugin);
  if (view === undefined) return { kind: 'as-is' };
  const folded = path.toLowerCase();
  const rename = view.targets.get(folded);
  if (rename !== undefined) return { kind: 'renamed', from: rename.from, name: nameOf(path) };
  return view.sources.has(folded) ? { kind: 'gone' } : { kind: 'as-is' };
}

/**
 * A folder's entries under the plugin's view: the old names gone, the new ones there, each with
 * the size and time of the file it is (a rename keeps both).
 */
export async function projectedList(
  plugin: string,
  folder: string,
  entries: readonly WorkspaceEntry[],
  statOf: (path: string) => Promise<WorkspaceEntry>,
): Promise<readonly WorkspaceEntry[]> {
  const view = active.get(plugin);
  if (view === undefined) return entries;
  const inside = (path: string) => parentOf(path).toLowerCase() === folder.toLowerCase();
  const kept = entries.filter((entry) => {
    const folded = joined(folder, entry.name).toLowerCase();
    return !view.sources.has(folded) || view.targets.has(folded);
  });
  const named = new Set(kept.map((entry) => entry.name.toLowerCase()));
  const added: WorkspaceEntry[] = [];
  for (const rename of view.targets.values()) {
    if (!inside(rename.to)) continue;
    const name = nameOf(rename.to);
    if (named.has(name.toLowerCase())) {
      // The new name is an old one too (two files swapping numbers): it stands for the file
      // that takes it, not the one that leaves it.
      const at = kept.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
      kept.splice(at, 1);
    }
    added.push({ ...(await statOf(rename.from)), name });
  }
  return [...kept, ...added];
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function joined(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}
