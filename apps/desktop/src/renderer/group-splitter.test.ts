// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorGroupElement, arrangeGroups } from './editor-group.js';
import { type EditorGroups, groupsOf, splitGroup } from './editor-groups.js';
import { KEYBOARD_STEP } from './group-resize.js';
import { GROUP_SPLITTER_ATTRIBUTE, wireGroupSplitters } from './group-splitter.js';

afterEach(() => {
  document.body.replaceChildren();
});

interface Resize {
  readonly splitId: string;
  readonly sizes: readonly number[];
  readonly settled: boolean;
}

/** A row of two groups laid out in a container, the splitter between them wired. */
function rowOfTwo(): { host: HTMLElement; groups: EditorGroups; resizes: Resize[] } {
  const host = document.createElement('div');
  document.body.append(host);
  const groups = splitGroup(groupsOf(['a'], 'a'), 'row');
  arrangeGroups(host, groups, new Map<string, EditorGroupElement>());
  const resizes: Resize[] = [];
  wireGroupSplitters(host, {
    groups: () => groups,
    onResize: (splitId, sizes, settled) => resizes.push({ splitId, sizes, settled }),
  });
  // jsdom lays nothing out, so each group measures 400 px wide here.
  for (const group of host.querySelectorAll<HTMLElement>('[data-editor-group]')) {
    group.getBoundingClientRect = () => ({ width: 400, height: 300 }) as DOMRect;
  }
  return { host, groups, resizes };
}

const splitterIn = (host: HTMLElement): HTMLElement => {
  const found = host.querySelector<HTMLElement>(`[${GROUP_SPLITTER_ATTRIBUTE}]`);
  if (found === null) throw new Error('no splitter');
  return found;
};

describe('the splitter between groups', () => {
  it('sits between the two groups as a focusable vertical separator', () => {
    const { host, groups } = rowOfTwo();
    const box = host.querySelector('.editor-split--row');
    const kinds = [...(box?.children ?? [])].map((child) =>
      child.hasAttribute(GROUP_SPLITTER_ATTRIBUTE) ? 'line' : 'group',
    );
    expect(kinds).toEqual(['group', 'line', 'group']);

    const splitter = splitterIn(host);
    expect(splitter.getAttribute('role')).toBe('separator');
    expect(splitter.getAttribute('aria-orientation')).toBe('vertical');
    expect(splitter.getAttribute('aria-valuenow')).toBe('50');
    expect(splitter.tabIndex).toBe(0);
    expect(splitter.getAttribute(GROUP_SPLITTER_ATTRIBUTE)).toBe(
      groups.root.kind === 'split' ? groups.root.id : '',
    );
  });

  it('is a horizontal separator between stacked groups', () => {
    const host = document.createElement('div');
    document.body.append(host);
    arrangeGroups(host, splitGroup(groupsOf(['a'], 'a'), 'column'), new Map());
    expect(splitterIn(host).getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('measures its bounds when it takes the focus', () => {
    const { host } = rowOfTwo();
    splitterIn(host).focus();
    // 800 px between them, 160 px the least either may have: 20 % to 80 %.
    expect(splitterIn(host).getAttribute('aria-valuemin')).toBe('20');
    expect(splitterIn(host).getAttribute('aria-valuemax')).toBe('80');
  });

  it('settles equal shares on a double-click', () => {
    const { host, groups, resizes } = rowOfTwo();
    splitterIn(host).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(resizes).toEqual([
      {
        splitId: groups.root.kind === 'split' ? groups.root.id : '',
        sizes: [0.5, 0.5],
        settled: true,
      },
    ]);
  });

  it('settles one step per arrow along its axis, and ignores the others', () => {
    const { host, resizes } = rowOfTwo();
    const press = (key: string): void => {
      splitterIn(host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    press('ArrowRight');
    press('ArrowUp');
    press('ArrowLeft');
    expect(resizes.map((resize) => resize.settled)).toEqual([true, true]);
    expect((resizes[0]?.sizes[0] ?? 0) * 800).toBeCloseTo(400 + KEYBOARD_STEP, 6);
    expect((resizes[1]?.sizes[0] ?? 0) * 800).toBeCloseTo(400 - KEYBOARD_STEP, 6);
  });
});
