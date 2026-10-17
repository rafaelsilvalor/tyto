// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorGroupElement, arrangeGroups } from './editor-group.js';
import {
  closeTab,
  focusGroup,
  focusedGroup,
  groupList,
  groupsOf,
  splitGroup,
} from './editor-groups.js';

afterEach(() => {
  document.body.replaceChildren();
});

const container = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

describe('arrangeGroups', () => {
  it('gives the one group of a fresh window the `#editor` mount every suite knows', () => {
    const made = new Map<string, EditorGroupElement>();
    const { created } = arrangeGroups(container(), groupsOf(['a'], 'a'), made);
    expect(created).toHaveLength(1);
    expect(document.getElementById('editor')).toBe(created[0]?.mount);
    expect(created[0]?.dataset['editorGroup']).toBe('group-1');
  });

  it('moves the existing groups into a split instead of rebuilding them, mount and all', () => {
    const made = new Map<string, EditorGroupElement>();
    const host = container();
    const one = groupsOf(['a'], 'a');
    arrangeGroups(host, one, made);
    const mount = document.getElementById('editor');
    mount?.append(document.createElement('p'));

    const split = splitGroup(one, 'row');
    const { created } = arrangeGroups(host, split, made);

    expect(created).toHaveLength(1);
    expect(document.getElementById('editor')).toBe(mount);
    expect(mount?.querySelector('p')).not.toBeNull();
    // Two groups and the line between them (TYTO-289).
    expect(host.querySelectorAll('.editor-split--row > [data-editor-group]')).toHaveLength(2);
  });

  it('hands `#editor` to the next group when the first one closes, and reports the gone one', () => {
    const made = new Map<string, EditorGroupElement>();
    const host = container();
    const split = splitGroup(groupsOf(['a'], 'a'), 'row');
    arrangeGroups(host, split, made);
    const [first, second] = groupList(split);
    const firstTab = first?.tabs[0]?.id ?? '';

    const closed = closeTab(split, firstTab);
    const { removed } = arrangeGroups(host, closed, made);

    expect(removed).toEqual([first?.id]);
    expect(focusedGroup(closed).id).toBe(second?.id);
    expect(document.getElementById('editor')).toBe(made.get(second?.id ?? '')?.mount);
  });
});

describe('the room the groups take (TYTO-299, ADR 0093)', () => {
  it('holds each split at its groups’ minimum and tells the workspace the whole', () => {
    const workspace = document.createElement('div');
    workspace.className = 'workspace';
    const host = document.createElement('div');
    workspace.append(host);
    document.body.append(workspace);

    const right = splitGroup(groupsOf(['a'], 'a'), 'row');
    const scene = splitGroup(focusGroup(right, groupList(right)[0]?.id ?? ''), 'column');
    arrangeGroups(host, scene, new Map());

    const row = host.querySelector<HTMLElement>('.editor-split--row');
    const column = host.querySelector<HTMLElement>('.editor-split--column');
    expect([row?.style.minWidth, row?.style.minHeight]).toEqual(['321px', '193px']);
    expect([column?.style.minWidth, column?.style.minHeight]).toEqual(['160px', '193px']);
    expect(workspace.style.getPropertyValue('--tyto-groups-min-width')).toBe('321px');
    expect(workspace.style.getPropertyValue('--tyto-groups-min-height')).toBe('193px');

    // Back to one group: the floor goes back to a group's own.
    arrangeGroups(host, groupsOf(['a'], 'a'), new Map());
    expect(workspace.style.getPropertyValue('--tyto-groups-min-width')).toBe('160px');
  });
});

describe('a group with a preview in front (TYTO-287)', () => {
  it('shows its preview pane in place of the mount, and keeps both', async () => {
    const made = new Map<string, EditorGroupElement>();
    const [group] = arrangeGroups(container(), groupsOf(['a'], 'a'), made).created;
    if (group === undefined) throw new Error('no group');
    await group.updateComplete;
    expect(group.mount.hidden).toBe(false);
    expect(group.preview.hidden).toBe(true);

    group.showing = 'preview';
    await group.updateComplete;
    await group.preview.updateComplete;
    expect(group.mount.hidden).toBe(true);
    expect(group.preview.hidden).toBe(false);
    expect(group.mount.isConnected).toBe(true);
    expect(group.preview.querySelector('[data-preview-frame]')?.getAttribute('sandbox')).toBe('');
    // No ids: two previews can be on screen at once.
    expect(group.preview.querySelector('[id]')).toBeNull();
  });

  it('offers "Open preview to the side" at the right end of its strip only while asked to', async () => {
    const made = new Map<string, EditorGroupElement>();
    const [group] = arrangeGroups(container(), groupsOf(['a'], 'a'), made).created;
    if (group === undefined) throw new Error('no group');
    let opened = 0;
    group.openPreview = () => {
      opened += 1;
    };
    await group.updateComplete;
    expect(group.querySelector('.editor-group__action')).toBeNull();

    group.offerPreview = true;
    await group.updateComplete;
    // In the strip, after the tabs, as VS Code's editor actions sit (TYTO-288, ADR 0085).
    expect(
      group.querySelector('.pane__strip > .pane__actions .editor-group__action'),
    ).not.toBeNull();
    expect(group.querySelector('.pane__header .editor-group__action')).toBeNull();
    group.querySelector<HTMLButtonElement>('.editor-group__action')?.click();
    expect(opened).toBe(1);
  });
});

describe('the pane shape (TYTO-288, ADR 0085)', () => {
  it('draws its strip, then a header row with an empty breadcrumb slot, then the mount', async () => {
    const made = new Map<string, EditorGroupElement>();
    const [group] = arrangeGroups(container(), groupsOf(['a'], 'a'), made).created;
    if (group === undefined) throw new Error('no group');
    await group.updateComplete;

    const order = [...group.children].map((child) => child.className);
    expect(order).toEqual(['pane__strip', 'pane__header', 'editor']);
    expect(group.querySelector('.pane__strip tyto-tabs')).not.toBeNull();
    // The header row holds the breadcrumb slot and nothing else, empty until TYTO-273.
    const header = group.querySelector(':scope > .pane__header');
    expect([...(header?.children ?? [])].map((child) => child.className)).toEqual([
      'pane__breadcrumb',
    ]);
    expect(header?.querySelector('[data-breadcrumb]')?.childNodes).toHaveLength(0);
  });

  it('hides its header row while a preview is in front, so the preview bar is the only one', async () => {
    const made = new Map<string, EditorGroupElement>();
    const [group] = arrangeGroups(container(), groupsOf(['a'], 'a'), made).created;
    if (group === undefined) throw new Error('no group');
    group.showing = 'preview';
    await group.updateComplete;
    await group.preview.updateComplete;

    expect(group.querySelector<HTMLElement>(':scope > .pane__header')?.hidden).toBe(true);
    const shown = [...group.querySelectorAll<HTMLElement>('.pane__header')].filter(
      (row) => !row.hidden && row.closest('[hidden]') === null,
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]?.classList.contains('preview__bar')).toBe(true);
  });
});
