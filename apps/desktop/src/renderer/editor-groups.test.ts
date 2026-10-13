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
  groupsOf,
  moveTab,
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
    // At the end it stays rather than wrapping.
    expect(focusedGroup(focusNeighbour(onLeft, -1)).id).toBe(left?.id);
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
