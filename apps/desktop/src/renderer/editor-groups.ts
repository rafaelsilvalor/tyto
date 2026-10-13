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

/** One tab in one group. */
export interface EditorTab {
  readonly id: string;
  readonly documentId: string;
}

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
  activeTabOf(focusedGroup(groups))?.documentId;

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
  const existing = group.tabs.find((tab) => tab.documentId === documentId);
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
  const shown = activeTabOf(source);
  const [groupId, afterGroup] = mint(groups, 'group');
  const [tabId, afterTab] = mint(afterGroup, 'tab');
  const tabs = shown === undefined ? [] : [{ id: tabId, documentId: shown.documentId }];
  const created: EditorGroup = {
    kind: 'group',
    id: groupId,
    tabs,
    activeTabId: shown === undefined ? undefined : tabId,
  };

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
  return { ...next, root, focusedGroupId: groupId };
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

/** Every tab of a document closed, wherever it is: the document itself went away. */
export function closeDocumentTabs(groups: EditorGroups, documentId: string): EditorGroups {
  const tabs = groupList(groups).flatMap((group) =>
    group.tabs.filter((tab) => tab.documentId === documentId),
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

/** Moves a tab to another group, at its end, in front there and focused. */
export function moveTab(groups: EditorGroups, tabId: string, toGroupId: string): EditorGroups {
  const from = groupOfTab(groups, tabId);
  const tab = from?.tabs.find((each) => each.id === tabId);
  if (from === undefined || tab === undefined || from.id === toGroupId) return groups;
  if (groupById(groups, toGroupId) === undefined) return groups;
  const target = groupById(groups, toGroupId);
  const twin = target?.tabs.find((each) => each.documentId === tab.documentId);
  const closed = closeTab(groups, tabId);
  if (twin !== undefined) return activateTab(closed, twin.id);
  const added = withGroup(closed, toGroupId, (found) => ({
    ...found,
    tabs: [...found.tabs, tab],
    activeTabId: tab.id,
  }));
  return { ...added, focusedGroupId: toGroupId };
}

/** Focus moves to the group before (`-1`) or after (`1`) the focused one, in tree order. */
export function focusNeighbour(groups: EditorGroups, direction: 1 | -1): EditorGroups {
  const list = groupList(groups);
  const at = list.findIndex((group) => group.id === groups.focusedGroupId);
  const next = list[at + direction];
  return next === undefined ? groups : { ...groups, focusedGroupId: next.id };
}

/** Every document some tab shows, once each. */
export const shownDocumentIds = (groups: EditorGroups): ReadonlySet<string> =>
  new Set(groupList(groups).flatMap((group) => group.tabs.map((tab) => tab.documentId)));
