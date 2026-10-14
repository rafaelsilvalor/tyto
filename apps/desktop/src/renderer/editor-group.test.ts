// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorGroupElement, arrangeGroups } from './editor-group.js';
import { closeTab, focusedGroup, groupList, groupsOf, splitGroup } from './editor-groups.js';

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

  it('offers "Open preview to the side" in its header row only while asked to', async () => {
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
    expect(group.querySelector('.pane__header .editor-group__action')).not.toBeNull();
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
    expect(group.querySelector('.pane__header [data-breadcrumb]')?.childNodes).toHaveLength(0);
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

  it('holds the template picker only while it is handed one, and lets go of it', async () => {
    const made = new Map<string, EditorGroupElement>();
    const host = container();
    const split = splitGroup(groupsOf(['a'], 'a'), 'row');
    arrangeGroups(host, split, made);
    const [first, second] = groupList(split).map((group) => made.get(group.id));
    if (first === undefined || second === undefined) throw new Error('no groups');
    const picker = document.createElement('label');

    first.picker = picker;
    await first.updateComplete;
    expect(picker.parentElement?.closest('[data-editor-group]')).toBe(first);

    first.picker = undefined;
    second.picker = picker;
    await Promise.all([first.updateComplete, second.updateComplete]);
    expect(picker.parentElement?.closest('[data-editor-group]')).toBe(second);
    expect(host.querySelectorAll('label')).toHaveLength(1);
  });
});
