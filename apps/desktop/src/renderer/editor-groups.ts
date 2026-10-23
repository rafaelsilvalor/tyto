/**
 * The editor panel's groups (TYTO-286, ADR 0083): a tree of splits whose leaves are groups,
 * each with its own row of tabs and its own active tab, and one of them focused.
 *
 * Pure data and pure operations, like `documents.ts` beside it: the workspace says which
 * documents are open, and this says where each is shown. **A tab is not a document**: a tab
 * has an id of its own and names the document it shows, so one document can sit in two groups
 * at once, and a tab that shows something other than a document (the preview, TYTO-287) is a
 * new kind of tab rather than a fake document.
 */

import type { SessionGroupNode } from '../../shared/session-groups.js';

/**
 * One tab in one group. A tab with `view: 'preview'` shows a brief's art instead of its text
 * (TYTO-287, ADR 0084): a **following** preview (`locked` absent) shows whichever brief was last
 * in front, and the window keeps its `documentId` pointed there ({@link followBrief}); a
 * **locked** one keeps the brief it was locked on. `documentId` is `''` for a following preview
 * with no brief to show.
 */
export interface EditorTab {
  readonly id: string;
  readonly documentId: string;
  readonly view?: 'preview';
  readonly locked?: boolean;
  /** A preview that hid its strip of slide thumbnails (TYTO-323, ADR 0123); absent is shown. */
  readonly stripHidden?: boolean;
}

export const isPreview = (tab: EditorTab): boolean => tab.view === 'preview';

/** A tab that shows a document's text: what every lookup by document means (TYTO-287). */
const isEditorTab = (tab: EditorTab): boolean => tab.view === undefined;

/** A leaf of the tree: a group with its tabs and the one in front. */
export interface EditorGroup {
  readonly kind: 'group';
  readonly id: string;
  readonly tabs: readonly EditorTab[];
  /** `undefined` only for a group with no tab, which is the last group left after a close. */
  readonly activeTabId: string | undefined;
}

/**
 * Children side by side (`row`, a split to the right) or one over the other (`column`, a split
 * down), with each child's share of the space. The shares always add up to one.
 */
export interface GroupSplit {
  readonly kind: 'split';
  readonly id: string;
  readonly direction: SplitDirection;
  readonly children: readonly GroupNode[];
  readonly sizes: readonly number[];
}

export type SplitDirection = 'row' | 'column';
export type GroupNode = EditorGroup | GroupSplit;

export interface EditorGroups {
  readonly root: GroupNode;
  readonly focusedGroupId: string;
  /** The counter every new id is minted from, so ids never repeat within a window. */
  readonly minted: number;
}

const mint = (groups: EditorGroups, prefix: string): [string, EditorGroups] => {
  const minted = groups.minted + 1;
  return [`${prefix}-${String(minted)}`, { ...groups, minted }];
};

/** One group holding a tab per document, `activeDocumentId`'s in front: the window today. */
export function groupsOf(
  documentIds: readonly string[],
  activeDocumentId: string | undefined,
): EditorGroups {
  const tabs = documentIds.map((documentId, index) => ({
    id: `tab-${String(index + 1)}`,
    documentId,
  }));
  const active = tabs.find((tab) => tab.documentId === activeDocumentId) ?? tabs[0];
  const group: EditorGroup = { kind: 'group', id: 'group-1', tabs, activeTabId: active?.id };
  return { root: group, focusedGroupId: group.id, minted: tabs.length + 1 };
}

/** Every group, in tree order: left before right, top before bottom. */
export function groupList(groups: EditorGroups): readonly EditorGroup[] {
  const walk = (node: GroupNode): EditorGroup[] =>
    node.kind === 'group' ? [node] : node.children.flatMap(walk);
  return walk(groups.root);
}

export const groupById = (groups: EditorGroups, id: string): EditorGroup | undefined =>
  groupList(groups).find((group) => group.id === id);

/** The focused group; the first one if the id names none, which no operation here leaves. */
export function focusedGroup(groups: EditorGroups): EditorGroup {
  const list = groupList(groups);
  const found = list.find((group) => group.id === groups.focusedGroupId) ?? list[0];
  if (found === undefined) throw new TypeError('An editor has at least one group.');
  return found;
}

export const activeTabOf = (group: EditorGroup): EditorTab | undefined =>
  group.tabs.find((tab) => tab.id === group.activeTabId);

/** The document the focused group has in front: what "the active document" means now. */
export const focusedDocumentId = (groups: EditorGroups): string | undefined =>
  activeTabOf(focusedGroup(groups))?.documentId || undefined;

/** Which group holds a tab. */
export const groupOfTab = (groups: EditorGroups, tabId: string): EditorGroup | undefined =>
  groupList(groups).find((group) => group.tabs.some((tab) => tab.id === tabId));

/** The tree with one group replaced, found by id wherever it is. */
function mapGroup(
  node: GroupNode,
  id: string,
  change: (group: EditorGroup) => GroupNode,
): GroupNode {
  if (node.kind === 'group') return node.id === id ? change(node) : node;
  return { ...node, children: node.children.map((child) => mapGroup(child, id, change)) };
}

const withGroup = (
  groups: EditorGroups,
  id: string,
  change: (group: EditorGroup) => GroupNode,
): EditorGroups => ({ ...groups, root: mapGroup(groups.root, id, change) });

/** A split found by id wherever it is in the tree. */
export function splitById(groups: EditorGroups, id: string): GroupSplit | undefined {
  const walk = (node: GroupNode): GroupSplit | undefined => {
    if (node.kind === 'group') return undefined;
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(groups.root);
}

/**
 * Gives a split new shares (TYTO-289): what a splitter's drag, key or double-click settles on.
 * Shares that do not fit the split — another count, a negative or nothing at all — leave the
 * tree as it is, and the rest are made to add up to one, the invariant every split keeps.
 */
export function resizeSplit(
  groups: EditorGroups,
  splitId: string,
  sizes: readonly number[],
): EditorGroups {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const fits = (node: GroupSplit): boolean =>
    sizes.length === node.children.length &&
    sizes.every((size) => Number.isFinite(size) && size >= 0) &&
    total > 0;
  const walk = (node: GroupNode): GroupNode => {
    if (node.kind === 'group') return node;
    if (node.id === splitId) {
      return fits(node) ? { ...node, sizes: sizes.map((size) => size / total) } : node;
    }
    return { ...node, children: node.children.map(walk) };
  };
  const root = walk(groups.root);
  return root === groups.root ? groups : { ...groups, root };
}

export function focusGroup(groups: EditorGroups, id: string): EditorGroups {
  return groupById(groups, id) === undefined ? groups : { ...groups, focusedGroupId: id };
}

/** Brings a tab to the front of its group and focuses that group. */
export function activateTab(groups: EditorGroups, tabId: string): EditorGroups {
  const group = groupOfTab(groups, tabId);
  if (group === undefined) return groups;
  return {
    ...withGroup(groups, group.id, (found) => ({ ...found, activeTabId: tabId })),
    focusedGroupId: group.id,
  };
}

/**
 * Shows a document in the focused group: its tab there if it has one, otherwise a new tab at
 * the end of the strip, where a one-group window has always put it. Another group's tab of the
 * same document is left alone.
 */
export function openDocument(groups: EditorGroups, documentId: string): EditorGroups {
  const group = focusedGroup(groups);
  const existing = group.tabs.find((tab) => isEditorTab(tab) && tab.documentId === documentId);
  if (existing !== undefined) return activateTab(groups, existing.id);
  const [tabId, minted] = mint(groups, 'tab');
  const tabs = [...group.tabs, { id: tabId, documentId }];
  return withGroup(minted, group.id, (found) => ({ ...found, tabs, activeTabId: tabId }));
}

/**
 * Splits the focused group: a new group beside it (`row`) or under it (`column`), showing the
 * same document, and focused. A split in the direction the group's parent already runs adds a
 * sibling and halves the focused group's share, rather than nesting a split of one.
 */
export function splitGroup(groups: EditorGroups, direction: SplitDirection): EditorGroups {
  const source = focusedGroup(groups);
  // A preview in front splits into its brief's text, not into a second preview (TYTO-287).
  const front = activeTabOf(source);
  const shown = front?.documentId === '' ? undefined : front;
  const [groupId, afterGroup] = mint(groups, 'group');
  const [tabId, afterTab] = mint(afterGroup, 'tab');
  const tabs = shown === undefined ? [] : [{ id: tabId, documentId: shown.documentId }];
  return withNewGroup(afterTab, source.id, direction, {
    kind: 'group',
    id: groupId,
    tabs,
    activeTabId: shown === undefined ? undefined : tabId,
  });
}

/**
 * `created` beside (`row`) or under (`column`) the group `sourceId`, and focused. A split in the
 * direction the group's parent already runs adds a sibling and halves the source's share.
 */
function withNewGroup(
  afterTab: EditorGroups,
  sourceId: string,
  direction: SplitDirection,
  created: EditorGroup,
): EditorGroups {
  const source = { id: sourceId };

  const insert = (node: GroupNode, splitId: () => string): GroupNode => {
    if (node.kind === 'group') {
      if (node.id !== source.id) return node;
      return {
        kind: 'split',
        id: splitId(),
        direction,
        children: [node, created],
        sizes: [0.5, 0.5],
      };
    }
    const at = node.children.findIndex((child) => child.kind === 'group' && child.id === source.id);
    if (at !== -1 && node.direction === direction) {
      const children = [...node.children];
      children.splice(at + 1, 0, created);
      const sizes = [...node.sizes];
      const half = (sizes[at] ?? 0) / 2;
      sizes.splice(at, 1, half, half);
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map((child) => insert(child, splitId)) };
  };

  let next = afterTab;
  const splitId = (): string => {
    const [id, after] = mint(next, 'split');
    next = after;
    return id;
  };
  const root = insert(afterTab.root, splitId);
  return { ...next, root, focusedGroupId: created.id };
}

/**
 * Takes a group out of the tree. Its parent's other children take its share between them, and
 * a split left with one child is replaced by that child.
 */
function withoutGroup(node: GroupNode, id: string): GroupNode | undefined {
  if (node.kind === 'group') return node.id === id ? undefined : node;
  const kept: GroupNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const after = withoutGroup(child, id);
    if (after === undefined) return;
    kept.push(after);
    sizes.push(node.sizes[index] ?? 0);
  });
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return { ...node, children: kept, sizes: sizes.map((size) => size / total) };
}

/**
 * Closes a tab. The one beside it comes to the front — the right-hand one, else the left — and
 * a group left with no tab goes, focus moving to the group before it (or after, for the
 * first). The last group stays, empty, for the window to put a document in.
 */
export function closeTab(groups: EditorGroups, tabId: string): EditorGroups {
  const group = groupOfTab(groups, tabId);
  if (group === undefined) return groups;
  const at = group.tabs.findIndex((tab) => tab.id === tabId);
  const tabs = group.tabs.filter((tab) => tab.id !== tabId);

  if (tabs.length === 0 && groupList(groups).length > 1) {
    const list = groupList(groups);
    const index = list.findIndex((each) => each.id === group.id);
    const neighbour = list[index - 1] ?? list[index + 1];
    const root = withoutGroup(groups.root, group.id);
    if (root === undefined || neighbour === undefined) return groups;
    const focusedGroupId =
      groups.focusedGroupId === group.id ? neighbour.id : groups.focusedGroupId;
    return { ...groups, root, focusedGroupId };
  }

  const activeTabId =
    group.activeTabId === tabId ? (tabs[at] ?? tabs[at - 1])?.id : group.activeTabId;
  return withGroup(groups, group.id, (found) => ({ ...found, tabs, activeTabId }));
}

/**
 * Every tab of a document closed, wherever it is: the document itself went away. Its locked
 * previews go with it; a following preview stays, for the window to point at the next brief.
 */
export function closeDocumentTabs(groups: EditorGroups, documentId: string): EditorGroups {
  const tabs = groupList(groups).flatMap((group) =>
    group.tabs.filter(
      (tab) => tab.documentId === documentId && (isEditorTab(tab) || tab.locked === true),
    ),
  );
  return tabs.reduce((next, tab) => closeTab(next, tab.id), groups);
}

/** Every tab of `from` now shows `to`: a tab nobody typed in replaced by the file just opened. */
export function replaceDocument(groups: EditorGroups, from: string, to: string): EditorGroups {
  const walk = (node: GroupNode): GroupNode =>
    node.kind === 'group'
      ? {
          ...node,
          tabs: node.tabs.map((tab) =>
            tab.documentId === from ? { ...tab, documentId: to } : tab,
          ),
        }
      : { ...node, children: node.children.map(walk) };
  return { ...groups, root: walk(groups.root) };
}

/**
 * Moves a tab to another group, in front there and focused: at `at` among the target's tabs, or
 * at its end, where "Move tab to next editor group" has always put it.
 */
export function moveTab(
  groups: EditorGroups,
  tabId: string,
  toGroupId: string,
  at?: number,
): EditorGroups {
  const from = groupOfTab(groups, tabId);
  const tab = from?.tabs.find((each) => each.id === tabId);
  if (from === undefined || tab === undefined || from.id === toGroupId) return groups;
  if (groupById(groups, toGroupId) === undefined) return groups;
  const target = groupById(groups, toGroupId);
  // Previews never merge: a locked one and a following one are two different things to keep.
  const twin = isEditorTab(tab)
    ? target?.tabs.find((each) => isEditorTab(each) && each.documentId === tab.documentId)
    : undefined;
  const closed = closeTab(groups, tabId);
  if (twin !== undefined) return activateTab(closed, twin.id);
  const added = withGroup(closed, toGroupId, (found) => ({
    ...found,
    tabs: withTabAt(found.tabs, tab, at ?? found.tabs.length),
    activeTabId: tab.id,
  }));
  return { ...added, focusedGroupId: toGroupId };
}

/** `tabs` with `tab` put at `at`, clamped to the strip. */
const withTabAt = (tabs: readonly EditorTab[], tab: EditorTab, at: number): EditorTab[] => {
  const next = [...tabs];
  next.splice(Math.min(Math.max(at, 0), tabs.length), 0, tab);
  return next;
};

/**
 * A tab dropped on a strip (TYTO-288): `index` is the gap it was let go in, counted among the
 * target group's tabs **as they are before the move** — `0` before the first, `tabs.length`
 * after the last — which is what a person sees while dragging. In its own group it reorders;
 * in another it moves there as {@link moveTab} does, with every rule that has (a text tab
 * dropped where its document already is brings that twin forward, an emptied group closes).
 * Either way the tab comes to the front and its group takes the focus.
 */
export function placeTab(
  groups: EditorGroups,
  tabId: string,
  toGroupId: string,
  index: number,
): EditorGroups {
  const from = groupOfTab(groups, tabId);
  const tab = from?.tabs.find((each) => each.id === tabId);
  if (from === undefined || tab === undefined) return groups;
  if (from.id !== toGroupId) return moveTab(groups, tabId, toGroupId, index);
  const at = from.tabs.findIndex((each) => each.id === tabId);
  // The gaps right of the tab move one place left once it is taken out of the strip.
  const landing = index > at ? index - 1 : index;
  const tabs = withTabAt(
    from.tabs.filter((each) => each.id !== tabId),
    tab,
    landing,
  );
  const reordered = withGroup(groups, from.id, (found) => ({ ...found, tabs }));
  return activateTab(reordered, tabId);
}

/**
 * The focused group's tab in front moves one place left (`-1`) or right (`1`) in its strip
 * (TYTO-288), stopping at the ends as VS Code's "Move editor left/right in group" does.
 */
export function stepTabInGroup(groups: EditorGroups, direction: 1 | -1): EditorGroups {
  const group = focusedGroup(groups);
  const at = group.tabs.findIndex((tab) => tab.id === group.activeTabId);
  const to = at + direction;
  if (at === -1 || to < 0 || to >= group.tabs.length) return groups;
  // A gap index, before the move: one step right is the gap after the right-hand neighbour.
  return placeTab(groups, group.activeTabId ?? '', group.id, direction === 1 ? at + 2 : to);
}

/**
 * The group before (`-1`) or after (`1`) the focused one, in tree order, **wrapping** at the
 * ends: the last group's next is the first, as a strip's next tab is (TYTO-286).
 */
function neighbourOf(groups: EditorGroups, direction: 1 | -1): EditorGroup {
  const list = groupList(groups);
  const at = list.findIndex((group) => group.id === groups.focusedGroupId);
  const next = list[(at + direction + list.length) % list.length];
  return next ?? focusedGroup(groups);
}

/** Focus moves to the group before (`-1`) or after (`1`) the focused one, wrapping. */
export function focusNeighbour(groups: EditorGroups, direction: 1 | -1): EditorGroups {
  return { ...groups, focusedGroupId: neighbourOf(groups, direction).id };
}

/**
 * The focused group's tab in front moves to the next group in tree order, wrapping (TYTO-286).
 * With one group there is no next one, so a split to the right is made for it, as VS Code
 * does: the tab leaves its group and shows in the new one. A group's only tab with nowhere but
 * a new split to go stays where it is, since moving it would end where it started.
 */
export function moveTabToNextGroup(groups: EditorGroups): EditorGroups {
  const source = focusedGroup(groups);
  const tab = activeTabOf(source);
  if (tab === undefined) return groups;
  if (groupList(groups).length > 1) return moveTab(groups, tab.id, neighbourOf(groups, 1).id);
  if (source.tabs.length < 2) return groups;
  const split = splitGroup(groups, 'row');
  const closed = closeTab(split, tab.id);
  return { ...closed, focusedGroupId: split.focusedGroupId };
}

/**
 * The groups as a session keeps them (TYTO-286, ADR 0080): the tree with no ids, each leaf its
 * tabs in order and the index of the one in front, and the focused group as its index among
 * the leaves in tree order (`shared/session-groups.ts`). `item` turns a tab into what the record
 * holds for it.
 */
export function layoutOf<T>(
  groups: EditorGroups,
  item: (tab: EditorTab, group: EditorGroup) => T,
): { readonly root: SessionGroupNode<T>; readonly focused: number } {
  const walk = (node: GroupNode): SessionGroupNode<T> =>
    node.kind === 'group'
      ? {
          tabs: node.tabs.map((tab) => item(tab, node)),
          active: Math.max(
            node.tabs.findIndex((tab) => tab.id === node.activeTabId),
            0,
          ),
        }
      : { split: node.direction, sizes: [...node.sizes], children: node.children.map(walk) };
  const focused = groupList(groups).findIndex((group) => group.id === groups.focusedGroupId);
  return { root: walk(groups.root), focused: Math.max(focused, 0) };
}

/**
 * A preview tab a session brings back (TYTO-287): a following one, whose brief the window points
 * it at once the groups are built (`documentId` `''` until then), or one locked on its brief.
 */
export type RestoredPreview = (
  | { readonly view: 'preview'; readonly documentId: '' }
  | { readonly view: 'preview'; readonly documentId: string; readonly locked: true }
) & { readonly stripHidden?: true };

/**
 * The groups a session left, rebuilt (TYTO-286): `documentOf` says which document each kept
 * item shows, or `undefined` for one that did not come back (a file gone with no draft), or the
 * preview it is (TYTO-287). A document is shown as text once per group; a group left with no
 * tab collapses, and a split left with one child is that child, its shares spread over what
 * stays. `undefined` when no group survives — the caller keeps the window it has.
 *
 * Ids are minted from `base`, and the first group in tree order takes `base`'s first group's
 * id, so the group the window opened on — `#editor` and the pane CodeMirror was born in — is
 * reused rather than torn down. `tabIds` says which tab each item became, for whatever the
 * caller keeps per tab (its cursor, ADR 0080 decision 8).
 */
export function groupsFromLayout<T>(
  base: EditorGroups,
  layout: { readonly root: SessionGroupNode<T>; readonly focused: number },
  documentOf: (item: T) => string | RestoredPreview | undefined,
): { readonly groups: EditorGroups; readonly tabIds: ReadonlyMap<T, string> } | undefined {
  let next: EditorGroups = { ...base };
  const builtPreviews: Omit<EditorTab, 'id'>[] = [];
  const previewTaken = (preview: Omit<EditorTab, 'id'>): boolean =>
    builtPreviews.some((each) =>
      preview.locked === true
        ? each.locked === true && each.documentId === preview.documentId
        : each.locked !== true,
    );
  const tabIds = new Map<T, string>();
  const firstId = groupList(base)[0]?.id;
  let leafIndex = -1;
  let focusedGroupId: string | undefined;
  let firstTaken = false;

  const build = (node: SessionGroupNode<T>): GroupNode | undefined => {
    if ('split' in node) {
      const children: GroupNode[] = [];
      const sizes: number[] = [];
      node.children.forEach((child, index) => {
        const built = build(child);
        if (built === undefined) return;
        children.push(built);
        sizes.push(Math.max(node.sizes[index] ?? 0, 0));
      });
      if (children.length === 0) return undefined;
      if (children.length === 1) return children[0];
      const total = sizes.reduce((sum, size) => sum + size, 0);
      const shares =
        total > 0 ? sizes.map((size) => size / total) : sizes.map(() => 1 / sizes.length);
      const [splitId, after] = mint(next, 'split');
      next = after;
      return { kind: 'split', id: splitId, direction: node.split, children, sizes: shares };
    }
    leafIndex += 1;
    const tabs: EditorTab[] = [];
    let activeTabId: string | undefined;
    node.tabs.forEach((item, index) => {
      const shown = documentOf(item);
      if (shown === undefined) return;
      const restored: Omit<EditorTab, 'id'> =
        typeof shown === 'string' ? { documentId: shown } : shown;
      if (restored.view === 'preview') {
        // At most one following preview in a window and one locked preview per brief (ADR 0084),
        // whatever a hand-edited file says: a second one is not built.
        if (previewTaken(restored)) return;
        builtPreviews.push(restored);
      } else {
        const twin = tabs.find((tab) => isEditorTab(tab) && tab.documentId === restored.documentId);
        if (twin !== undefined) {
          if (index === node.active) activeTabId = twin.id;
          return;
        }
      }
      const [tabId, after] = mint(next, 'tab');
      next = after;
      tabs.push({ id: tabId, ...restored });
      tabIds.set(item, tabId);
      if (index === node.active) activeTabId = tabId;
    });
    if (tabs.length === 0) return undefined;
    let groupId: string;
    if (!firstTaken && firstId !== undefined) {
      groupId = firstId;
    } else {
      const [minted, after] = mint(next, 'group');
      next = after;
      groupId = minted;
    }
    firstTaken = true;
    if (leafIndex === layout.focused) focusedGroupId = groupId;
    return { kind: 'group', id: groupId, tabs, activeTabId: activeTabId ?? tabs[0]?.id };
  };

  const root = build(layout.root);
  if (root === undefined) return undefined;
  const built: EditorGroups = { ...next, root, focusedGroupId: focusedGroupId ?? '' };
  return {
    groups: { ...built, focusedGroupId: focusedGroup(built).id },
    tabIds,
  };
}

/** Every document some tab shows as text, once each. A preview is not a tab of its brief. */
export const shownDocumentIds = (groups: EditorGroups): ReadonlySet<string> =>
  new Set(
    groupList(groups).flatMap((group) =>
      group.tabs.filter(isEditorTab).map((tab) => tab.documentId),
    ),
  );

/** Every preview tab, in tree order (TYTO-287). */
export const previewTabs = (groups: EditorGroups): readonly EditorTab[] =>
  groupList(groups).flatMap((group) => group.tabs.filter(isPreview));

/** The window's following preview: there is at most one (TYTO-287). */
export const followingPreview = (groups: EditorGroups): EditorTab | undefined =>
  previewTabs(groups).find((tab) => tab.locked !== true);

/** Every tab of the tree through `change`. */
function mapTabs(groups: EditorGroups, change: (tab: EditorTab) => EditorTab): EditorGroups {
  const walk = (node: GroupNode): GroupNode =>
    node.kind === 'group'
      ? { ...node, tabs: node.tabs.map(change) }
      : { ...node, children: node.children.map(walk) };
  return { ...groups, root: walk(groups.root) };
}

/**
 * The following preview shows `documentId` now (TYTO-287): the brief last in front, or `''`
 * when there is none. A locked preview stays on its own brief.
 */
export function followBrief(groups: EditorGroups, documentId: string): EditorGroups {
  const following = followingPreview(groups);
  if (following === undefined || following.documentId === documentId) return groups;
  return mapTabs(groups, (tab) => (tab.id === following.id ? { ...tab, documentId } : tab));
}

/**
 * "Open preview to the side" (TYTO-287). The following preview, when there is one, comes to the
 * front of its group and is focused. Otherwise a new one showing `documentId` goes into the
 * group after the focused one — a new group split to the right when the focused one is the last
 * — and the focus stays where the person is typing, as VS Code's does, unless `focus` asks.
 */
export function openPreviewToSide(
  groups: EditorGroups,
  documentId: string,
  focus: boolean,
): EditorGroups {
  const existing = followingPreview(groups);
  if (existing !== undefined) return activateTab(groups, existing.id);
  const source = focusedGroup(groups);
  const list = groupList(groups);
  const after = list[list.findIndex((group) => group.id === source.id) + 1];
  const [tabId, minted] = mint(groups, 'tab');
  const tab: EditorTab = { id: tabId, documentId, view: 'preview' };
  let next: EditorGroups;
  if (after === undefined) {
    const [groupId, afterGroup] = mint(minted, 'group');
    next = withNewGroup(afterGroup, source.id, 'row', {
      kind: 'group',
      id: groupId,
      tabs: [tab],
      activeTabId: tabId,
    });
  } else {
    next = withGroup(minted, after.id, (found) => ({
      ...found,
      tabs: [...found.tabs, tab],
      activeTabId: tabId,
    }));
  }
  const shownIn = groupOfTab(next, tabId)?.id ?? source.id;
  return { ...next, focusedGroupId: focus ? shownIn : source.id };
}

/** "Open preview" (TYTO-287): the following preview, or a new one in the focused group, in front. */
export function openPreviewHere(groups: EditorGroups, documentId: string): EditorGroups {
  const existing = followingPreview(groups);
  if (existing !== undefined) return activateTab(groups, existing.id);
  const group = focusedGroup(groups);
  const [tabId, minted] = mint(groups, 'tab');
  const tab: EditorTab = { id: tabId, documentId, view: 'preview' };
  return withGroup(minted, group.id, (found) => ({
    ...found,
    tabs: [...found.tabs, tab],
    activeTabId: tabId,
  }));
}

/**
 * Locks a following preview on the brief it shows, or lets a locked one follow again
 * (TYTO-287). A brief has at most one locked preview and the window at most one following one,
 * so the other preview the change would make a second of is closed.
 */
export function toggleLock(groups: EditorGroups, tabId: string): EditorGroups {
  const tab = previewTabs(groups).find((each) => each.id === tabId);
  if (tab === undefined) return groups;
  const locking = tab.locked !== true;
  if (locking && tab.documentId === '') return groups;
  const duplicate = previewTabs(groups).find(
    (each) =>
      each.id !== tabId &&
      (locking ? each.locked === true && each.documentId === tab.documentId : each.locked !== true),
  );
  const closed = duplicate === undefined ? groups : closeTab(groups, duplicate.id);
  return mapTabs(closed, (each) => {
    if (each.id !== tabId) return each;
    if (locking) return { ...each, locked: true };
    const { locked: _locked, ...following } = each;
    return following;
  });
}

/**
 * Hides a preview's strip of slide thumbnails, or shows it again (TYTO-323, ADR 0123). Per tab,
 * so a locked preview and the following one each keep their own.
 */
export function toggleStrip(groups: EditorGroups, tabId: string): EditorGroups {
  return mapTabs(groups, (each) => {
    if (each.id !== tabId || !isPreview(each)) return each;
    if (each.stripHidden === true) {
      const { stripHidden: _hidden, ...shown } = each;
      return shown;
    }
    return { ...each, stripHidden: true };
  });
}
