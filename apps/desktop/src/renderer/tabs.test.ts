// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { type DocumentTabs, type TabEntry, TABS_TAG } from './tabs.js';

/**
 * The tab strip, driven through the element (E9.11).
 *
 * jsdom lays nothing out, so how the strip *looks* is the end-to-end suite's question. What
 * is here is everything a person does to a tab — click it, close it, middle-click it — and
 * the two things that are invisible when they are wrong: that a tab with unsaved text says
 * so in a way a screen reader can read, and that the strip is a view of what it was given
 * rather than a second copy of it.
 *
 * `await strip.updateComplete` before every read, the habit every Lit element needs (ADR
 * 0024): Lit schedules on a microtask, so the DOM one statement after an assignment is the
 * DOM from before it.
 */

const TABS: readonly TabEntry[] = [
  { id: 'a', label: 'campanha.brief', dirty: false },
  { id: 'b', label: 'promo.brief', dirty: true },
];

type Spy = ReturnType<typeof vi.fn<(id: string) => void>>;

async function open(
  tabs: readonly TabEntry[] = TABS,
  activeId = 'a',
): Promise<{ strip: DocumentTabs; select: Spy; close: Spy }> {
  const strip = document.createElement(TABS_TAG);
  const select = vi.fn<(id: string) => void>();
  const close = vi.fn<(id: string) => void>();
  strip.tabs = tabs;
  strip.activeId = activeId;
  strip.select = select;
  strip.close = close;
  document.body.replaceChildren(strip);
  await strip.updateComplete;
  return { strip, select, close };
}

const names = (strip: DocumentTabs): string[] =>
  [...strip.querySelectorAll('.tabs__label')].map((node) => node.textContent ?? '');

describe('what the strip shows', () => {
  it('one tab per open document, in the order it was given', async () => {
    const { strip } = await open();

    expect(names(strip)).toEqual(['campanha.brief', 'promo.brief']);
  });

  it('marks exactly one tab as the active one', async () => {
    const { strip } = await open();
    const selected = [...strip.querySelectorAll('[role="tab"]')].map((node) =>
      node.getAttribute('aria-selected'),
    );

    expect(selected).toEqual(['true', 'false']);
  });

  it('says a tab is unsaved in words and not only with a dot', async () => {
    const { strip } = await open(TABS, 'a');
    const marks = [...strip.querySelectorAll('.tabs__dirty')];

    expect(marks).toHaveLength(1);
    // The dot carries the shape and the label carries the meaning: a bullet is nothing at
    // all to a screen reader, and `document.unsaved` is the same word the title uses.
    expect(marks[0]?.getAttribute('aria-label')).toBe('não salvo');
  });

  it('follows the locale it is given', async () => {
    const { strip } = await open();
    strip.locale = 'en';
    await strip.updateComplete;

    expect(strip.querySelector('.tabs__dirty')?.getAttribute('aria-label')).toBe('unsaved');
    expect(strip.querySelector('.tabs__close')?.getAttribute('aria-label')).toBe('Close the tab');
  });
});

describe('what a person does to a tab', () => {
  it('asks for the one that was clicked, and never decides itself', async () => {
    const { strip, select } = await open();
    strip.querySelectorAll<HTMLButtonElement>('.tabs__name')[1]?.click();

    expect(select).toHaveBeenCalledWith('b');
    // The strip holds no state: it still shows `a` as active until it is told otherwise,
    // which is what stops it becoming a second copy of the workspace.
    await strip.updateComplete;
    expect(strip.querySelector('[role="tab"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('asks to close on the × and on a middle click, which are the same request', async () => {
    const { strip, close } = await open();
    strip.querySelectorAll<HTMLButtonElement>('.tabs__close')[0]?.click();
    strip
      .querySelectorAll('.tabs__tab')[1]
      ?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));

    expect(close.mock.calls).toEqual([['a'], ['b']]);
  });

  it('ignores a right click, which is not a close anywhere', async () => {
    const { strip, close } = await open();
    strip
      .querySelectorAll('.tabs__tab')[0]
      ?.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));

    expect(close).not.toHaveBeenCalled();
  });
});

describe('a strip nobody has filled', () => {
  it('renders an empty list rather than nothing at all', async () => {
    const { strip } = await open([], '');

    expect(strip.querySelector('.tabs__strip')).not.toBeNull();
    expect(names(strip)).toEqual([]);
  });
});
