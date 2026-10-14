/**
 * The editor groups' shape in the session (TYTO-286, ADR 0080 and 0083), shared by the two
 * sides that prune it: the window, before it sends the tree, and main, when it turns the
 * window's ids into the indices of the tabs it keeps and when it reads them back.
 *
 * A tree of splits whose leaves are groups, each with its tabs in order and the index of the
 * one in front; `focused` is the focused group's index among the leaves in tree order. `T` is
 * how a tab is named: a `documentId` on the wire to main, an index of `tabs` in the file and
 * on the way back.
 */
export interface SessionGroupLeaf<T> {
  readonly tabs: readonly T[];
  readonly active: number;
}
export interface SessionGroupSplit<T> {
  readonly split: 'row' | 'column';
  readonly sizes: readonly number[];
  readonly children: readonly SessionGroupNode<T>[];
}
export type SessionGroupNode<T> = SessionGroupLeaf<T> | SessionGroupSplit<T>;

/**
 * A group tree with each tab turned into what the other side names it by — an index of the kept
 * tabs on the way in, the same index checked against the tabs read back on the way out — and
 * whatever names nothing taken out (TYTO-286). A group left with no tab goes, and a split left
 * with one child is that child, its shares spread over what stays. `focused` follows its group;
 * a focused group that went leaves the first one focused. `undefined` when no group is left.
 */
export function prunedGroups<T, U>(
  tree: { readonly root: SessionGroupNode<T>; readonly focused: number },
  tabOf: (tab: T) => U | undefined,
): { root: SessionGroupNode<U>; focused: number } | undefined {
  let leaf = -1;
  let kept = -1;
  let focused = 0;
  const walk = (node: SessionGroupNode<T>): SessionGroupNode<U> | undefined => {
    if ('split' in node) {
      const children: SessionGroupNode<U>[] = [];
      const sizes: number[] = [];
      node.children.forEach((child, index) => {
        const after = walk(child);
        if (after === undefined) return;
        children.push(after);
        sizes.push(node.sizes[index] ?? 0);
      });
      if (children.length < 2) return children[0];
      const total = sizes.reduce((sum, size) => sum + size, 0);
      return {
        split: node.split,
        sizes: sizes.map((size) => (total > 0 ? size / total : 1 / sizes.length)),
        children,
      };
    }
    leaf += 1;
    const tabs: U[] = [];
    let active = 0;
    node.tabs.forEach((tab, index) => {
      const mapped = tabOf(tab);
      if (mapped === undefined) return;
      if (index <= node.active) active = tabs.length;
      tabs.push(mapped);
    });
    if (tabs.length === 0) return undefined;
    kept += 1;
    if (leaf === tree.focused) focused = kept;
    return { tabs, active };
  };
  const root = walk(tree.root);
  return root === undefined ? undefined : { root, focused };
}
