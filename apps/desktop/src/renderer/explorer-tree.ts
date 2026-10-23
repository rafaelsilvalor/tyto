import { isPreviewImage } from '../../shared/file-icons.js';
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

/**
 * A name being typed in the tree (TYTO-352, ADR 0121): a new entry in a folder (`null` is the
 * root), or a new name for an entry. **Kept apart from the listings**, so a re-list redraws
 * around the field and never drops what was typed. `draft` is the text in the field and
 * `error` the line under it, after main refused the name.
 */
export type ExplorerEditing = (
  | { readonly parentId: string | null; readonly kind: 'file' | 'folder' }
  | { readonly renameId: string }
) & { readonly draft: string; readonly error?: string };

export interface ExplorerTree {
  /** The open folder's own listing, or nothing while it is asked. */
  readonly root: ExplorerListing | undefined;
  /** The listing of every folder that has been opened, by its id. */
  readonly children: ReadonlyMap<string, ExplorerListing>;
  readonly expanded: ReadonlySet<string>;
  readonly selected: string | undefined;
  readonly editing?: ExplorerEditing | undefined;
}

export const EMPTY_TREE: ExplorerTree = {
  root: undefined,
  children: new Map(),
  expanded: new Set(),
  selected: undefined,
  editing: undefined,
};

/** One line of the tree as drawn: an entry, or the count of what a folder's listing left out. */
export type ExplorerRow =
  | {
      readonly type: 'entry';
      readonly entry: ExplorerEntry;
      readonly depth: number;
      readonly parent: string | null;
      readonly expanded: boolean;
      /** Its name is the field: it is being renamed. */
      readonly renaming?: boolean;
    }
  | {
      /** The field of a new entry, first under the folder it will be made in. */
      readonly type: 'new';
      readonly kind: 'file' | 'folder';
      readonly depth: number;
      readonly parent: string | null;
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
  const editing = tree.editing;
  const walk = (listing: ExplorerListing, depth: number, parent: string | null): void => {
    if (editing !== undefined && 'parentId' in editing && editing.parentId === parent) {
      rows.push({ type: 'new', kind: editing.kind, depth, parent });
    }
    for (const entry of listing.entries) {
      const expanded = entry.kind === 'folder' && tree.expanded.has(entry.id);
      const renaming =
        editing !== undefined && 'renameId' in editing && editing.renameId === entry.id;
      rows.push({
        type: 'entry',
        entry,
        depth,
        parent,
        expanded,
        ...(renaming ? { renaming } : {}),
      });
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
  return withEditingChecked(listed(tree, folder, listing));
}

function listed(tree: ExplorerTree, folder: string | null, listing: ExplorerListing): ExplorerTree {
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

/**
 * The field survives a re-list, and goes only when what it is about has: the folder a new
 * entry is typed into came back `gone`, or the entry being renamed is in no listing any more.
 */
function withEditingChecked(tree: ExplorerTree): ExplorerTree {
  const editing = tree.editing;
  if (editing === undefined) return tree;
  const listings = [...(tree.root === undefined ? [] : [tree.root]), ...tree.children.values()];
  const stays =
    'parentId' in editing
      ? editing.parentId === null
        ? tree.root?.gone !== true
        : tree.children.has(editing.parentId)
      : listings.some((listing) => listing.entries.some((entry) => entry.id === editing.renameId));
  return stays ? tree : { ...tree, editing: undefined };
}

/**
 * Opens the field of a new file or folder (TYTO-352): in `parent` when it is given, otherwise
 * in the selected folder, the selected file's folder, or the root with nothing selected. The
 * folder is opened, so the field shows under it; one never listed is the caller's to list.
 */
export function startCreating(
  tree: ExplorerTree,
  kind: 'file' | 'folder',
  parent?: string | null,
): ExplorerTree {
  const selected = rowsOf(tree).find(
    (row) => row.type === 'entry' && row.entry.id === tree.selected,
  );
  const parentId =
    parent !== undefined
      ? parent
      : selected?.type !== 'entry'
        ? null
        : selected.entry.kind === 'folder'
          ? selected.entry.id
          : selected.parent;
  const opened = parentId === null ? tree : withExpanded(tree, parentId, true);
  return { ...opened, editing: { parentId, kind, draft: '' } };
}

/** Opens the field over an entry's name, holding the name it has now. */
export function startRenaming(tree: ExplorerTree, id: string): ExplorerTree {
  const row = rowsOf(tree).find((each) => each.type === 'entry' && each.entry.id === id);
  if (row?.type !== 'entry') return tree;
  return { ...tree, selected: id, editing: { renameId: id, draft: row.entry.name } };
}

/** What was typed, which clears the line a refused name left under the field. */
export function withDraft(tree: ExplorerTree, draft: string): ExplorerTree {
  if (tree.editing === undefined) return tree;
  const { error: _cleared, ...editing } = tree.editing;
  return { ...tree, editing: { ...editing, draft } };
}

/** Main refused the name: the field stays, with its text and this line under it. */
export function withEditError(tree: ExplorerTree, error: string): ExplorerTree {
  return tree.editing === undefined ? tree : { ...tree, editing: { ...tree.editing, error } };
}

export const stopEditing = (tree: ExplorerTree): ExplorerTree => ({ ...tree, editing: undefined });

/** The folder a row is in, by the rows on screen; `null` is the root. */
export function parentOf(tree: ExplorerTree, id: string): string | null | undefined {
  for (const row of rowsOf(tree)) {
    if (row.type === 'entry' && row.entry.id === id) return row.parent;
  }
  return undefined;
}

/** Opens or closes a folder. What was open under it stays open, to come back when it reopens. */
export function withExpanded(tree: ExplorerTree, folder: string, open: boolean): ExplorerTree {
  const expanded = new Set(tree.expanded);
  if (open) expanded.add(folder);
  else expanded.delete(folder);
  return { ...tree, expanded };
}

/**
 * Closes every folder, at every depth (TYTO-365). A selection inside a folder that closed moves
 * up to the top-level folder that holds it, so the selected row is still one on screen.
 */
export function collapseAll(tree: ExplorerTree): ExplorerTree {
  let selected = tree.selected;
  let parent = selected === undefined ? null : parentOf(tree, selected);
  while (parent !== null && parent !== undefined) {
    selected = parent;
    parent = parentOf(tree, parent);
  }
  return { ...tree, expanded: new Set(), selected };
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
  | { readonly do: 'open'; readonly id: string }
  | { readonly do: 'rename'; readonly id: string }
  | { readonly do: 'delete'; readonly id: string }
  /** The context menu, for the selected row, or `null` for the panel's empty space. */
  | { readonly do: 'menu'; readonly id: string | null };

/**
 * Shift+F10 and the ContextMenu key, the system's two keys for a context menu (TYTO-364). F10
 * alone is not one: it is the window's menu bar key on Windows.
 */
export function isMenuKey(key: string, shift: boolean): boolean {
  return key === 'ContextMenu' || (key === 'F10' && shift);
}

/**
 * The tree's keys, VS Code's: Up and Down move, Home and End jump, Right opens a folder and then
 * goes into it, Left closes it and then goes to its parent, Enter and Space open what is
 * selected; F2 renames it and Delete asks to move it to the trash (TYTO-352); Shift+F10 and the
 * ContextMenu key open the context menu, a row's while one is selected and the empty space's
 * while none is (TYTO-364). `undefined` when the key means nothing here.
 */
export function moveFor(tree: ExplorerTree, key: string, shift = false): ExplorerMove | undefined {
  const entries = rowsOf(tree).flatMap((row) => (row.type === 'entry' ? [row] : []));
  if (entries.length === 0) return undefined;
  const at = entries.findIndex((row) => row.entry.id === tree.selected);
  const current = at === -1 ? undefined : entries[at];
  if (isMenuKey(key, shift)) return { do: 'menu', id: current?.entry.id ?? null };
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
    case 'F2':
      return { do: 'rename', id: current.entry.id };
    case 'Delete':
      return { do: 'delete', id: current.entry.id };
    case 'Enter':
    case ' ':
      if (folder) return { do: 'expand', id: current.entry.id, open: !current.expanded };
      // A brief opens and an image shows (TYTO-366); the panel decides which.
      return current.entry.kind === 'brief' ||
        (current.entry.kind === 'file' && isPreviewImage(current.entry.name))
        ? { do: 'open', id: current.entry.id }
        : undefined;
    default:
      return undefined;
  }
}
