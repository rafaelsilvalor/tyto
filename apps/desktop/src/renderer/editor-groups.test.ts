import { describe, expect, it } from 'vitest';

import {
  type EditorGroups,
  type EditorTab,
  type RestoredPreview,
  activateTab,
  activeTabOf,
  closeDocumentTabs,
  closeTab,
  focusGroup,
  focusNeighbour,
  focusedDocumentId,
  focusedGroup,
  followBrief,
  followBriefAgain,
  followingPreview,
  groupList,
  groupsFromLayout,
  groupsOf,
  layoutOf,
  moveTab,
  moveTabToNextGroup,
  openDocument,
  openPreviewHere,
  openPreviewToSide,
  placeTab,
  previewSubjectOf,
  previewTabs,
  replaceDocument,
  resizeSplit,
  shownDocumentIds,
  splitById,
  splitGroup,
  stepTabInGroup,
  toggleLock,
  setPreviewMode,
  showInFollowingPreview,
  toggleStrip,
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

describe('resizing a split (TYTO-289)', () => {
  const rowOfThree = (): EditorGroups => splitGroup(splitGroup(twoDocuments(), 'row'), 'row');
  const sharesOf = (groups: EditorGroups): readonly number[] =>
    groups.root.kind === 'split' ? groups.root.sizes : [];

  it('gives the split the shares it is handed, found by id', () => {
    const groups = rowOfThree();
    const id = groups.root.kind === 'split' ? groups.root.id : '';
    const resized = resizeSplit(groups, id, [0.2, 0.3, 0.5]);
    expect(sharesOf(resized)).toEqual([0.2, 0.3, 0.5]);
    expect(splitById(resized, id)?.sizes).toEqual([0.2, 0.3, 0.5]);
    expect(picture(resized)).toEqual(picture(groups));
  });

  it('makes the shares add up to one', () => {
    const groups = rowOfThree();
    const id = groups.root.kind === 'split' ? groups.root.id : '';
    expect(sharesOf(resizeSplit(groups, id, [1, 1, 2]))).toEqual([0.25, 0.25, 0.5]);
  });

  it('refuses shares that do not fit the split, and a split that is not there', () => {
    const groups = rowOfThree();
    const id = groups.root.kind === 'split' ? groups.root.id : '';
    expect(sharesOf(resizeSplit(groups, id, [0.5, 0.5]))).toEqual([0.5, 0.25, 0.25]);
    expect(sharesOf(resizeSplit(groups, id, [-1, 1, 1]))).toEqual([0.5, 0.25, 0.25]);
    expect(sharesOf(resizeSplit(groups, id, [0, 0, 0]))).toEqual([0.5, 0.25, 0.25]);
    expect(sharesOf(resizeSplit(groups, 'split-nowhere', [0.2, 0.3, 0.5]))).toEqual([
      0.5, 0.25, 0.25,
    ]);
  });

  it('reaches a split nested inside another', () => {
    const groups = splitGroup(splitGroup(twoDocuments(), 'row'), 'column');
    const inner = groups.root.kind === 'split' ? groups.root.children[1] : undefined;
    const id = inner?.kind === 'split' ? inner.id : '';
    const resized = resizeSplit(groups, id, [0.7, 0.3]);
    expect(splitById(resized, id)?.sizes).toEqual([0.7, 0.3]);
    expect(sharesOf(resized)).toEqual([0.5, 0.5]);
  });

  it('keeps the shares through the layout a session writes', () => {
    const groups = splitGroup(twoDocuments(), 'row');
    const id = groups.root.kind === 'split' ? groups.root.id : '';
    const layout = layoutOf(resizeSplit(groups, id, [1 / 3, 2 / 3]), (tab) => tab.documentId);
    expect(layout.root).toMatchObject({ split: 'row', sizes: [1 / 3, 2 / 3] });
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

describe('placing a dropped tab (TYTO-288)', () => {
  const three = (): EditorGroups => groupsOf(['a', 'b', 'c'], 'a');
  const idOf = (groups: EditorGroups, documentId: string): string =>
    groupList(groups)
      .flatMap((group) => group.tabs)
      .find((tab) => tab.documentId === documentId)?.id ?? '';

  it('reorders within its group, counting gaps as they were before the move', () => {
    const groups = three();
    // The gap after `c` is 3, and `a` lands last; the gap before `b` is 1, where `a` already is.
    expect(picture(placeTab(groups, idOf(groups, 'a'), 'group-1', 3))).toEqual(['b c *a']);
    expect(picture(placeTab(groups, idOf(groups, 'a'), 'group-1', 2))).toEqual(['b *a c']);
    expect(picture(placeTab(groups, idOf(groups, 'a'), 'group-1', 1))).toEqual(['*a b c']);
    expect(picture(placeTab(groups, idOf(groups, 'c'), 'group-1', 0))).toEqual(['*c a b']);
    expect(picture(placeTab(groups, idOf(groups, 'c'), 'group-1', 1))).toEqual(['a *c b']);
  });

  it('brings the dropped tab to the front and focuses its group', () => {
    const split = openDocument(splitGroup(three(), 'row'), 'd');
    const [left] = groupList(split);
    const placed = placeTab(split, idOf(split, 'b'), left?.id ?? '', 0);
    expect(picture(placed)).toEqual(['*b a c', 'a *d']);
    expect(focusedGroup(placed).id).toBe(left?.id);
  });

  it('moves onto another group at the gap it was let go in', () => {
    const split = openDocument(splitGroup(three(), 'row'), 'd');
    const [left, right] = groupList(split);
    const placed = placeTab(split, idOf(split, 'c'), right?.id ?? '', 1);
    expect(picture(placed)).toEqual(['*a b', 'a *c d']);
    expect(focusedGroup(placed).id).toBe(right?.id);
    expect(left).toBeDefined();
  });

  it('closes the group it emptied', () => {
    const split = splitGroup(three(), 'row');
    const [left, right] = groupList(split);
    const lone = right?.tabs[0]?.id ?? '';
    const placed = placeTab(split, lone, left?.id ?? '', 0);
    expect(groupList(placed)).toHaveLength(1);
    expect(picture(placed)).toEqual(['*a b c']);
  });

  it('brings forward the twin a text tab is dropped onto, rather than a second tab of it', () => {
    const split = openDocument(splitGroup(three(), 'row'), 'd');
    const [left, right] = groupList(split);
    const twin = right?.tabs.find((tab) => tab.documentId === 'a')?.id ?? '';
    const placed = placeTab(split, twin, left?.id ?? '', 3);
    expect(picture(placed)).toEqual(['*a b c', '*d']);
  });

  it('moves a locked preview as it is, with its id and its lock', () => {
    const following = openPreviewHere(three(), 'a');
    const opened = toggleLock(following, previewTabs(following)[0]?.id ?? '');
    const split = splitGroup(opened, 'row');
    const preview = previewTabs(split)[0];
    const right = groupList(split)[1];
    const placed = placeTab(split, preview?.id ?? '', right?.id ?? '', 0);
    expect(previewTabs(placed)).toEqual([preview]);
    expect(groupList(placed)[1]?.tabs[0]).toEqual(preview);
  });

  it('leaves the groups alone for a tab that is not in them', () => {
    const groups = three();
    expect(placeTab(groups, 'tab-404', 'group-1', 0)).toBe(groups);
  });
});

describe('stepping the tab in front along its strip (TYTO-288)', () => {
  it('moves it one place left or right', () => {
    const groups = groupsOf(['a', 'b', 'c'], 'b');
    expect(picture(stepTabInGroup(groups, -1))).toEqual(['*b a c']);
    expect(picture(stepTabInGroup(groups, 1))).toEqual(['a c *b']);
  });

  it('stops at the ends', () => {
    const first = groupsOf(['a', 'b'], 'a');
    const last = groupsOf(['a', 'b'], 'b');
    expect(stepTabInGroup(first, -1)).toBe(first);
    expect(stepTabInGroup(last, 1)).toBe(last);
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

describe('the preview as a tab (TYTO-287, ADR 0084)', () => {
  /** As {@link picture}, with a following preview written `P(doc)` and a locked one `L(doc)`. */
  const withPreviews = (groups: EditorGroups): string[] =>
    groupList(groups).map((group) =>
      group.tabs
        .map((tab) => {
          const name =
            tab.view === 'preview'
              ? `${tab.locked === true ? 'L' : 'P'}(${tab.documentId})`
              : tab.documentId;
          return tab.id === group.activeTabId ? `*${name}` : name;
        })
        .join(' '),
    );
  const following = (groups: EditorGroups): string => followingPreview(groups)?.id ?? '';
  const second = (groups: EditorGroups): string => groupList(groups)[1]?.id ?? '';

  it('opens beside the brief in a new group, and leaves the focus where the person types', () => {
    const opened = openPreviewToSide(twoDocuments(), 'b', false);
    expect(withPreviews(opened)).toEqual(['a *b', '*P(b)']);
    expect(focusedDocumentId(opened)).toBe('b');
    expect(groupList(opened).indexOf(focusedGroup(opened))).toBe(0);
  });

  it('goes into the next group when there is one, and comes forward the second time', () => {
    const split = focusGroup(splitGroup(twoDocuments(), 'row'), 'group-1');
    const opened = openPreviewToSide(split, 'b', false);
    expect(withPreviews(opened)).toEqual(['a *b', 'b *P(b)']);
    const behind = activateTab(opened, groupList(opened)[1]?.tabs[0]?.id ?? '');
    const again = openPreviewToSide(focusGroup(behind, 'group-1'), 'a', false);
    expect(withPreviews(again)).toEqual(['a *b', 'b *P(b)']);
    expect(groupList(again).indexOf(focusedGroup(again))).toBe(1);
  });

  it('opens in the focused group with "Open preview"', () => {
    expect(withPreviews(openPreviewHere(twoDocuments(), 'b'))).toEqual(['a b *P(b)']);
  });

  it('follows the brief it is pointed at, and a locked one stays put', () => {
    const opened = openPreviewToSide(twoDocuments(), 'b', false);
    expect(withPreviews(followBrief(opened, 'a'))).toEqual(['a *b', '*P(a)']);
    const locked = toggleLock(opened, following(opened));
    expect(withPreviews(followBrief(locked, 'a'))).toEqual(['a *b', '*L(b)']);
    expect(followingPreview(locked)).toBeUndefined();
  });

  it('keeps one locked preview per brief and one following one per window', () => {
    const first = openPreviewToSide(twoDocuments(), 'b', false);
    const locked = toggleLock(first, following(first));
    const another = openPreviewHere(focusGroup(locked, second(locked)), 'b');
    // Locking a second preview on the same brief closes the first.
    const both = toggleLock(another, following(another));
    expect(withPreviews(both)).toEqual(['a *b', '*L(b)']);
    // Letting a locked one follow while another follows closes the other.
    const third = openPreviewHere(both, 'a');
    const lockedTab = previewTabs(third).find((tab) => tab.locked === true)?.id ?? '';
    expect(previewTabs(toggleLock(third, lockedTab))).toHaveLength(1);
    // A preview with no brief has nothing to lock on.
    const empty = openPreviewHere(twoDocuments(), '');
    expect(toggleLock(empty, following(empty))).toEqual(empty);
  });

  it('is never what a lookup by document finds', () => {
    const opened = openPreviewToSide(twoDocuments(), 'b', false);
    // Opening `b` with the preview's group focused makes a tab of its text there.
    const inPreviewGroup = openDocument(focusGroup(opened, second(opened)), 'b');
    expect(withPreviews(inPreviewGroup)).toEqual(['a *b', 'P(b) *b']);
    expect([...shownDocumentIds(opened)].sort()).toEqual(['a', 'b']);
    // A split of a preview opens its brief's text.
    const split = splitGroup(focusGroup(opened, second(opened)), 'row');
    expect(withPreviews(split).at(-1)).toBe('*b');
    // A preview moved next to its brief's tab stays a preview of its own.
    const moved = moveTab(opened, following(opened), 'group-1');
    expect(withPreviews(moved)).toEqual(['a b *P(b)']);
  });

  it('closes a locked preview with its brief and keeps the following one for the next', () => {
    const opened = openPreviewToSide(twoDocuments(), 'b', false);
    expect(withPreviews(closeDocumentTabs(opened, 'b'))).toEqual(['*a', '*P(b)']);
    const locked = toggleLock(opened, following(opened));
    const both = openPreviewToSide(locked, 'b', false);
    expect(withPreviews(both)).toEqual(['a *b', 'L(b) *P(b)']);
    expect(withPreviews(closeDocumentTabs(both, 'b'))).toEqual(['*a', '*P(b)']);
  });

  /** A preview as the session names it: nothing while it follows, its brief once locked. */
  const sessionItem = (tab: EditorTab): string =>
    tab.view === 'preview' ? (tab.locked === true ? `L(${tab.documentId})` : 'P') : tab.documentId;
  const fromSession = (item: string): string | RestoredPreview => {
    if (item === 'P') return { view: 'preview', documentId: '' };
    const locked = /^L\((?<brief>.+)\)$/u.exec(item)?.groups?.['brief'];
    return locked === undefined ? item : { view: 'preview', documentId: locked, locked: true };
  };

  it('comes back from a session with a following and a locked preview (second pull request)', () => {
    const opened = openPreviewToSide(twoDocuments(), 'b', false);
    const both = openPreviewToSide(toggleLock(opened, following(opened)), 'b', false);
    const layout = layoutOf(both, sessionItem);
    expect(layout.root).toMatchObject({
      children: [{ tabs: ['a', 'b'] }, { tabs: ['L(b)', 'P'] }],
    });

    const rebuilt = groupsFromLayout(groupsOf(['x'], 'x'), layout, fromSession);
    // The following preview names no brief until the window points it at the one in front.
    expect(withPreviews(rebuilt?.groups as EditorGroups)).toEqual(['a *b', 'L(b) *P()']);
    expect(withPreviews(followBrief(rebuilt?.groups as EditorGroups, 'b'))).toEqual([
      'a *b',
      'L(b) *P(b)',
    ]);
  });

  it('builds one following preview and one locked preview per brief, whatever the file says', () => {
    const layout = {
      root: { tabs: ['a', 'P', 'L(a)', 'P', 'L(a)'], active: 0 },
      focused: 0,
    };
    const rebuilt = groupsFromLayout(groupsOf(['x'], 'x'), layout, fromSession);
    expect(withPreviews(rebuilt?.groups as EditorGroups)).toEqual(['*a P() L(a)']);
  });

  it('points a locked preview of the untouched tab at the file that replaces it', () => {
    // Measured for PR A's left-open row: the untouched tab becomes the opened file in every
    // group, and a preview locked on it goes with it rather than pointing at nothing.
    const opened = openPreviewToSide(groupsOf(['blank'], 'blank'), 'blank', false);
    const locked = toggleLock(opened, following(opened));
    expect(withPreviews(replaceDocument(locked, 'blank', 'file'))).toEqual(['*file', '*L(file)']);
  });
});

describe('hiding a preview’s strip of slides (TYTO-323)', () => {
  it('hides and shows it on the one tab, and the lock keeps it either way', () => {
    const opened = openPreviewHere(groupsOf(['a'], 'a'), 'a');
    const id = previewTabs(opened)[0]?.id ?? '';
    const hidden = toggleStrip(opened, id);
    expect(previewTabs(hidden)[0]?.stripHidden).toBe(true);

    const locked = toggleLock(hidden, id);
    expect(previewTabs(locked)[0]).toMatchObject({ locked: true, stripHidden: true });
    const following = toggleLock(locked, id);
    expect(previewTabs(following)[0]).toEqual({
      id,
      documentId: 'a',
      view: 'preview',
      stripHidden: true,
    });

    expect(previewTabs(toggleStrip(following, id))[0]).toEqual({
      id,
      documentId: 'a',
      view: 'preview',
    });
  });

  it('leaves a text tab alone', () => {
    const groups = groupsOf(['a'], 'a');
    const text = focusedGroup(groups).tabs[0]?.id ?? '';
    expect(focusedGroup(toggleStrip(groups, text)).tabs[0]?.stripHidden).toBeUndefined();
  });
});

describe('a preview’s mode, One slide or All slides (TYTO-323)', () => {
  it('sets it on the one tab, keeps the strip’s flag, and survives the lock', () => {
    const opened = openPreviewHere(groupsOf(['a'], 'a'), 'a');
    const id = previewTabs(opened)[0]?.id ?? '';
    const all = setPreviewMode(toggleStrip(opened, id), id, 'all');
    expect(previewTabs(all)[0]).toMatchObject({ mode: 'all', stripHidden: true });

    const locked = toggleLock(all, id);
    expect(previewTabs(locked)[0]).toMatchObject({ locked: true, mode: 'all' });
    expect(previewTabs(toggleStrip(locked, id))[0]).toMatchObject({ mode: 'all' });

    // One slide is the absence of a mode, and the strip's flag waits for it.
    expect(previewTabs(setPreviewMode(all, id, 'one'))[0]).toEqual({
      id,
      documentId: 'a',
      view: 'preview',
      stripHidden: true,
    });
  });

  it('leaves a text tab alone', () => {
    const groups = groupsOf(['a'], 'a');
    const text = focusedGroup(groups).tabs[0]?.id ?? '';
    expect(focusedGroup(setPreviewMode(groups, text, 'all')).tabs[0]?.mode).toBeUndefined();
  });
});

describe('a preview of an image from the explorer (TYTO-366, ADR 0124)', () => {
  /** Each preview as `P(subject)` or `L(subject)`, an image written `img:id`. */
  const previews = (groups: EditorGroups): string[] =>
    previewTabs(groups).map((tab) => {
      const subject = previewSubjectOf(tab);
      const shown = subject.kind === 'image' ? `img:${subject.entryId}` : subject.documentId;
      return `${tab.locked === true ? 'L' : 'P'}(${shown})`;
    });
  const logo = { kind: 'image', entryId: 'e-logo' } as const;

  it('points the following preview at the image, and it stays there while briefs follow', () => {
    const opened = openPreviewToSide(twoDocuments(), 'b', false);
    const shown = showInFollowingPreview(opened, logo);
    expect(previews(shown)).toEqual(['P(img:e-logo)']);
    // Nothing a brief has is taken: the focus and the brief in front stay where they were.
    expect(shown.focusedGroupId).toBe(opened.focusedGroupId);
    expect(focusedDocumentId(shown)).toBe('b');
    expect(previews(followBrief(shown, 'a'))).toEqual(['P(img:e-logo)']);
  });

  it('goes back to the brief once one is brought forward', () => {
    const shown = showInFollowingPreview(openPreviewToSide(twoDocuments(), 'b', false), logo);
    const back = followBriefAgain(shown, 'a');
    expect(previews(back)).toEqual(['P(a)']);
    expect(followingPreview(back)?.subject).toBeUndefined();
  });

  it('opens a preview the way Open preview does when there is none', () => {
    const shown = showInFollowingPreview(twoDocuments(), logo);
    expect(previews(shown)).toEqual(['P(img:e-logo)']);
    expect(activeTabOf(focusedGroup(shown))?.subject).toEqual(logo);
  });

  it('locks on the image, one locked preview per image, and a locked one keeps it', () => {
    const shown = showInFollowingPreview(openPreviewToSide(twoDocuments(), 'b', false), logo);
    const locked = toggleLock(shown, followingPreview(shown)?.id ?? '');
    expect(previews(locked)).toEqual(['L(img:e-logo)']);
    // Another image shown opens a following preview in the focused group, the first in tree
    // order, and leaves the locked one alone.
    const other = showInFollowingPreview(locked, { kind: 'image', entryId: 'e-foto' });
    expect(previews(other)).toEqual(['P(img:e-foto)', 'L(img:e-logo)']);
    // The same image shown and locked again closes the first lock.
    const same = showInFollowingPreview(other, logo);
    const twice = toggleLock(same, followingPreview(same)?.id ?? '');
    expect(previews(twice)).toEqual(['L(img:e-logo)']);
  });

  it('leaves a brief as it opens today', () => {
    const shown = showInFollowingPreview(openPreviewToSide(twoDocuments(), 'b', false), logo);
    const opened = openDocument(shown, 'c');
    expect(focusedDocumentId(opened)).toBe('c');
    expect(previewSubjectOf({ id: 't', documentId: 'b', view: 'preview' })).toEqual({
      kind: 'brief',
      documentId: 'b',
    });
  });
});

describe('a preview of a Markdown file (TYTO-247, ADR 0132)', () => {
  const tab: EditorTab = { id: 't1', documentId: 'd-notes', view: 'preview' };

  it('is the markdown subject of its document when the document is Markdown', () => {
    const kinds: Record<string, string | undefined> = { 'd-notes': 'markdown' };
    expect(previewSubjectOf(tab, (id) => kinds[id])).toEqual({
      kind: 'markdown',
      documentId: 'd-notes',
    });
  });

  it('is a brief subject otherwise, and the file it names wins over both', () => {
    expect(previewSubjectOf(tab, () => undefined)).toEqual({
      kind: 'brief',
      documentId: 'd-notes',
    });
    const image = { kind: 'image', entryId: 'e-1' } as const;
    expect(previewSubjectOf({ ...tab, subject: image }, () => 'markdown')).toEqual(image);
  });
});
