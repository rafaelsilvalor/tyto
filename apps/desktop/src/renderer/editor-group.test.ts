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
    expect(host.querySelector('.editor-split--row')?.childElementCount).toBe(2);
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
