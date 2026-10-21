import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The explorer's tree, as a value (TYTO-279, ADR 0115): what main listed for each folder the
 * person opened, which are open, and which row is selected. Pure, so the panel only draws it
 * and every rule about what a re-list changes is tested without a window.
 *
 * Folders are named by the ids main minted; nothing here is a path, and nothing could be.
 */

export type ExplorerListing = IpcResponse<'explorer:list'>;
export type ExplorerEntry = ExplorerListing['entries'][number];

export interface ExplorerTree {
  /** The open folder's own listing, or nothing while it is asked. */
  readonly root: ExplorerListing | undefined;
  /** The listing of every folder that has been opened, by its id. */
  readonly children: ReadonlyMap<string, ExplorerListing>;
  readonly expanded: ReadonlySet<string>;
  readonly selected: string | undefined;
}

export const EMPTY_TREE: ExplorerTree = {
  root: undefined,
  children: new Map(),
  expanded: new Set(),
  selected: undefined,
};

/** One line of the tree as drawn: an entry, or the count of what a folder's listing left out. */
export type ExplorerRow =
  | {
      readonly type: 'entry';
      readonly entry: ExplorerEntry;
      readonly depth: number;
      readonly parent: string | null;
      readonly expanded: boolean;
    }
  | {
      readonly type: 'more';
      readonly count: number;
      readonly depth: number;
      readonly parent: string | null;
    };

/** The rows on screen, depth first: an open folder's children under it, once they are listed. */
export function rowsOf(tree: ExplorerTree): readonly ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  const walk = (listing: ExplorerListing, depth: number, parent: string | null): void => {
    for (const entry of listing.entries) {
      const expanded = entry.kind === 'folder' && tree.expanded.has(entry.id);
      rows.push({ type: 'entry', entry, depth, parent, expanded });
      const listed = expanded ? tree.children.get(entry.id) : undefined;
      if (listed !== undefined) walk(listed, depth + 1, entry.id);
    }
    if (listing.more > 0) rows.push({ type: 'more', count: listing.more, depth, parent });
  };
  if (tree.root !== undefined) walk(tree.root, 0, null);
  return rows;
}

/** Every id under `folder` that the tree holds a listing for, the folder itself included. */
function subtreeOf(tree: ExplorerTree, folder: string): Set<string> {
  const found = new Set<string>([folder]);
  const pending = [folder];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const entry of tree.children.get(id)?.entries ?? []) {
      if (!found.has(entry.id)) {
        found.add(entry.id);
        pending.push(entry.id);
      }
    }
  }
  return found;
}

/**
 * What main answered for `folder` (`null` is the root). A folder answered `gone` — deleted or
 * renamed outside the app, or its id no longer meaning anything — is dropped with everything
 * under it, open or not, and the selection with it if it was inside.
 */
export function withListing(
  tree: ExplorerTree,
  folder: string | null,
  listing: ExplorerListing,
): ExplorerTree {
  if (folder === null) return { ...tree, root: listing };
  if (!listing.gone) {
    const children = new Map(tree.children);
    children.set(folder, listing);
    return { ...tree, children };
  }
  const dropped = subtreeOf(tree, folder);
  const children = new Map([...tree.children].filter(([id]) => !dropped.has(id)));
  const expanded = new Set([...tree.expanded].filter((id) => !dropped.has(id)));
  const selected =
    tree.selected !== undefined && dropped.has(tree.selected) && tree.selected !== folder
      ? folder
      : tree.selected;
  return { ...tree, children, expanded, selected };
}

/** Opens or closes a folder. What was open under it stays open, to come back when it reopens. */
export function withExpanded(tree: ExplorerTree, folder: string, open: boolean): ExplorerTree {
  const expanded = new Set(tree.expanded);
  if (open) expanded.add(folder);
  else expanded.delete(folder);
  return { ...tree, expanded };
}

export const withSelected = (tree: ExplorerTree, id: string | undefined): ExplorerTree => ({
  ...tree,
  selected: id,
});

/**
 * The folders to list again after a change on disk: the root, then each open folder that is on
 * screen. A folder inside a closed one is listed when it is shown again, not before.
 */
export function foldersToRelist(tree: ExplorerTree): readonly (string | null)[] {
  const shown = rowsOf(tree).flatMap((row) =>
    row.type === 'entry' && row.expanded ? [row.entry.id] : [],
  );
  return [null, ...shown];
}

/** What a key does: select a row, open or close a folder, or open a brief. */
export type ExplorerMove =
  | { readonly do: 'select'; readonly id: string }
  | { readonly do: 'expand'; readonly id: string; readonly open: boolean }
  | { readonly do: 'open'; readonly id: string };

/**
 * The tree's keys, VS Code's: Up and Down move, Home and End jump, Right opens a folder and then
 * goes into it, Left closes it and then goes to its parent, Enter and Space open what is
 * selected. `undefined` when the key means nothing here.
 */
export function moveFor(tree: ExplorerTree, key: string): ExplorerMove | undefined {
  const entries = rowsOf(tree).flatMap((row) => (row.type === 'entry' ? [row] : []));
  if (entries.length === 0) return undefined;
  const at = entries.findIndex((row) => row.entry.id === tree.selected);
  const current = at === -1 ? undefined : entries[at];
  const select = (index: number): ExplorerMove | undefined => {
    const row = entries[Math.max(0, Math.min(entries.length - 1, index))];
    return row === undefined ? undefined : { do: 'select', id: row.entry.id };
  };

  if (current === undefined) {
    return ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key) ? select(0) : undefined;
  }
  const folder = current.entry.kind === 'folder';
  switch (key) {
    case 'ArrowDown':
      return select(at + 1);
    case 'ArrowUp':
      return select(at - 1);
    case 'Home':
      return select(0);
    case 'End':
      return select(entries.length - 1);
    case 'ArrowRight':
      if (!folder) return undefined;
      if (!current.expanded) return { do: 'expand', id: current.entry.id, open: true };
      return entries[at + 1]?.parent === current.entry.id ? select(at + 1) : undefined;
    case 'ArrowLeft':
      if (folder && current.expanded) return { do: 'expand', id: current.entry.id, open: false };
      return current.parent === null ? undefined : { do: 'select', id: current.parent };
    case 'Enter':
    case ' ':
      if (folder) return { do: 'expand', id: current.entry.id, open: !current.expanded };
      return current.entry.kind === 'brief' ? { do: 'open', id: current.entry.id } : undefined;
    default:
      return undefined;
  }
}
