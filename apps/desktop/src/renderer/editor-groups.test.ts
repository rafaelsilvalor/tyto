import { describe, expect, it } from 'vitest';

import {
  type EditorGroups,
  activateTab,
  activeTabOf,
  closeDocumentTabs,
  closeTab,
  focusGroup,
  focusNeighbour,
  focusedDocumentId,
  focusedGroup,
  groupList,
  groupsFromLayout,
  groupsOf,
  layoutOf,
  moveTab,
  moveTabToNextGroup,
  openDocument,
  replaceDocument,
  splitGroup,
} from './editor-groups.js';

/** What each group shows, in tree order: its documents, the one in front starred. */
const picture = (groups: EditorGroups): string[] =>
  groupList(groups).map((group) =>
    group.tabs
      .map((tab) => (tab.id === group.activeTabId ? `*${tab.documentId}` : tab.documentId))
      .join(' '),
  );

const twoDocuments = (): EditorGroups => groupsOf(['a', 'b'], 'b');

describe('one group', () => {
  it('is the window as it always was: a tab per document, the active one in front', () => {
    const groups = twoDocuments();
    expect(picture(groups)).toEqual(['a *b']);
    expect(focusedDocumentId(groups)).toBe('b');
  });

  it('gives a tab an id of its own, not the document’s', () => {
    const [tab] = focusedGroup(groupsOf(['a'], 'a')).tabs;
    expect(tab?.documentId).toBe('a');
    expect(tab?.id).not.toBe('a');
  });

  it('opens a document at the end of the strip, and only once', () => {
    const opened = openDocument(twoDocuments(), 'c');
    expect(picture(opened)).toEqual(['a b *c']);
    expect(picture(openDocument(opened, 'a'))).toEqual(['*a b c']);
  });
});

describe('splitting', () => {
  it('right puts the same document in a new group beside, and focuses it', () => {
    const split = splitGroup(twoDocuments(), 'row');
    expect(picture(split)).toEqual(['a *b', '*b']);
    expect(focusedGroup(split).id).toBe(groupList(split)[1]?.id);
    expect(split.root.kind === 'split' && split.root.direction).toBe('row');
  });

  it('down nests a column inside the row, rather than adding a third column', () => {
    const split = splitGroup(splitGroup(twoDocuments(), 'row'), 'column');
    expect(picture(split)).toEqual(['a *b', '*b', '*b']);
    const root = split.root;
    expect(root.kind === 'split' && root.children.map((child) => child.kind)).toEqual([
      'group',
      'split',
    ]);
  });

  it('the same way again adds a sibling and halves the focused share', () => {
    const split = splitGroup(splitGroup(twoDocuments(), 'row'), 'row');
    expect(split.root.kind === 'split' && split.root.sizes).toEqual([0.5, 0.25, 0.25]);
  });

  it('mints ids that never repeat', () => {
    const split = splitGroup(splitGroup(twoDocuments(), 'row'), 'column');
    const tabs = groupList(split).flatMap((group) => group.tabs.map((tab) => tab.id));
    const ids = [...groupList(split).map((group) => group.id), ...tabs];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('closing', () => {
  it('brings the tab to the right forward, else the one to the left', () => {
    const groups = groupsOf(['a', 'b', 'c'], 'b');
    const b = activeTabOf(focusedGroup(groups));
    expect(picture(closeTab(groups, b?.id ?? ''))).toEqual(['a *c']);
  });

  it('collapses a group whose last tab closed, and focuses its neighbour', () => {
    const split = openDocument(splitGroup(twoDocuments(), 'row'), 'c');
    const right = focusedGroup(split);
    const once = closeTab(split, right.tabs[0]?.id ?? '');
    const twice = closeTab(once, right.tabs[1]?.id ?? '');
    expect(picture(twice)).toEqual(['a *b']);
    expect(twice.root.kind).toBe('group');
    expect(focusedDocumentId(twice)).toBe('b');
  });

  it('keeps the last group, empty, for the window to fill', () => {
    const groups = groupsOf(['a'], 'a');
    const closed = closeDocumentTabs(groups, 'a');
    expect(picture(closed)).toEqual(['']);
    expect(focusedDocumentId(closed)).toBeUndefined();
  });

  it('takes a document out of every group it is in', () => {
    const split = splitGroup(twoDocuments(), 'row');
    expect(picture(closeDocumentTabs(split, 'b'))).toEqual(['*a']);
  });
});

describe('focus', () => {
  it('moves to a group by id, and to its neighbours in tree order', () => {
    const split = splitGroup(twoDocuments(), 'row');
    const [left, right] = groupList(split);
    const onLeft = focusGroup(split, left?.id ?? '');
    expect(focusedGroup(onLeft).id).toBe(left?.id);
    expect(focusedGroup(focusNeighbour(onLeft, 1)).id).toBe(right?.id);
  });

  it('wraps at the ends, in tree order, like the next tab in a strip', () => {
    // Right, then down from the right: left, top-right, bottom-right.
    const three = splitGroup(splitGroup(twoDocuments(), 'row'), 'column');
    const [left, topRight, bottomRight] = groupList(three);
    const onLeft = focusGroup(three, left?.id ?? '');
    expect(focusedGroup(focusNeighbour(onLeft, -1)).id).toBe(bottomRight?.id);
    expect(focusedGroup(focusNeighbour(focusNeighbour(onLeft, 1), 1)).id).toBe(bottomRight?.id);
    expect(focusedGroup(focusNeighbour(focusGroup(three, bottomRight?.id ?? ''), 1)).id).toBe(
      left?.id,
    );
    expect(focusedGroup(focusNeighbour(groupsOf(['a'], 'a'), 1)).id).toBe('group-1');
    void topRight;
  });

  it('follows a tab chosen in another group', () => {
    const split = splitGroup(twoDocuments(), 'row');
    const a = groupList(split)[0]?.tabs[0];
    const chosen = activateTab(split, a?.id ?? '');
    expect(focusedDocumentId(chosen)).toBe('a');
    expect(picture(chosen)).toEqual(['*a b', '*b']);
  });

  it('ignores an id no group has', () => {
    const groups = twoDocuments();
    expect(focusGroup(groups, 'group-99')).toBe(groups);
  });
});

describe('moving a tab', () => {
  it('to another group, in front and focused there; its group collapses when emptied', () => {
    const split = openDocument(splitGroup(twoDocuments(), 'row'), 'c');
    const [left, right] = groupList(split);
    const c = right?.tabs.find((tab) => tab.documentId === 'c');
    const moved = moveTab(split, c?.id ?? '', left?.id ?? '');
    expect(picture(moved)).toEqual(['a b *c', '*b']);
    expect(focusedGroup(moved).id).toBe(left?.id);
  });

  it('onto a group that already shows the document, bringing that tab forward', () => {
    const split = splitGroup(twoDocuments(), 'row');
    const [left, right] = groupList(split);
    const moved = moveTab(split, right?.tabs[0]?.id ?? '', left?.id ?? '');
    expect(picture(moved)).toEqual(['a *b']);
  });
});

it('replaces a document in every tab that shows it', () => {
  const split = splitGroup(groupsOf(['untitled'], 'untitled'), 'row');
  expect(picture(replaceDocument(split, 'untitled', 'file'))).toEqual(['*file', '*file']);
});

describe('moving the tab in front to the next group', () => {
  it('goes to the next group in tree order, wrapping, and focuses it', () => {
    const split = splitGroup(twoDocuments(), 'row');
    // The right group shows `b`; the left one `a *b`. From the right, next wraps to the left.
    const moved = moveTabToNextGroup(openDocument(split, 'c'));
    expect(picture(moved)).toEqual(['a b *c', '*b']);
    expect(focusedGroup(moved).id).toBe(groupList(moved)[0]?.id);
  });

  it('with one group, makes a split to the right and moves the tab into it', () => {
    const moved = moveTabToNextGroup(twoDocuments());
    expect(picture(moved)).toEqual(['*a', '*b']);
    expect(focusedDocumentId(moved)).toBe('b');
  });

  it('leaves a lone tab in a lone group where it is', () => {
    const one = groupsOf(['a'], 'a');
    expect(moveTabToNextGroup(one)).toBe(one);
  });
});

describe('closing every tab of a group', () => {
  it('takes the group out, and focus goes to the group before it', () => {
    const three = splitGroup(splitGroup(twoDocuments(), 'row'), 'column');
    const bottom = focusedGroup(three);
    const closed = bottom.tabs.reduce((next, tab) => closeTab(next, tab.id), three);
    expect(groupList(closed)).toHaveLength(2);
    expect(focusedGroup(closed).id).toBe(groupList(three)[1]?.id);
  });
});

describe('the groups as a session keeps them', () => {
  const three = (): EditorGroups => {
    const right = splitGroup(twoDocuments(), 'row');
    return splitGroup(openDocument(right, 'c'), 'column');
  };

  it('is the tree with no ids, each tab what the caller makes of it, and the focused leaf', () => {
    const layout = layoutOf(three(), (tab) => tab.documentId);
    expect(layout).toEqual({
      root: {
        split: 'row',
        sizes: [0.5, 0.5],
        children: [
          { tabs: ['a', 'b'], active: 1 },
          {
            split: 'column',
            sizes: [0.5, 0.5],
            children: [
              { tabs: ['b', 'c'], active: 1 },
              { tabs: ['c'], active: 0 },
            ],
          },
        ],
      },
      focused: 2,
    });
  });

  it('comes back as the same tree, tabs and focus, reusing the window’s first group', () => {
    const before = three();
    const base = groupsOf(['x'], 'x');
    const layout = layoutOf(before, (tab) => ({ documentId: tab.documentId }));
    const rebuilt = groupsFromLayout(base, layout, (item) => item.documentId);
    expect(rebuilt).toBeDefined();
    const groups = rebuilt?.groups as EditorGroups;
    expect(picture(groups)).toEqual(picture(before));
    expect(groupList(groups)[0]?.id).toBe('group-1');
    expect(groupList(groups).indexOf(focusedGroup(groups))).toBe(2);
    expect(layoutOf(groups, (tab) => tab.documentId)).toEqual(
      layoutOf(before, (tab) => tab.documentId),
    );
    // Every tab id is new and unique, and each item says which tab it became.
    const ids = groupList(groups).flatMap((group) => group.tabs.map((tab) => tab.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(rebuilt?.tabIds.size).toBe(ids.length);
  });

  it('collapses a group whose documents did not come back, and its split with it', () => {
    const layout = layoutOf(three(), (tab) => tab.documentId);
    const rebuilt = groupsFromLayout(groupsOf(['x'], 'x'), layout, (documentId) =>
      documentId === 'c' ? undefined : documentId,
    );
    // The bottom-right group held only `c`: it goes, and the column split with it.
    expect(picture(rebuilt?.groups as EditorGroups)).toEqual(['a *b', '*b']);
    expect(rebuilt?.groups.root).toMatchObject({ kind: 'split', sizes: [0.5, 0.5] });
  });

  it('answers nothing when no group survives', () => {
    const layout = layoutOf(three(), (tab) => tab.documentId);
    expect(groupsFromLayout(groupsOf(['x'], 'x'), layout, () => undefined)).toBeUndefined();
  });
});
