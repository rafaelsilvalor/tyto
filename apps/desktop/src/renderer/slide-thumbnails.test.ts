// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SlideThumbnails, type Thumbnail, THUMBNAIL_HEIGHT } from './slide-thumbnails.js';
import './slide-thumbnails.js';

/**
 * `<tyto-slide-thumbnails>` in jsdom (TYTO-323, ADR 0123): the order, the click, the keys, which
 * thumbnails are given a document and how many navigations a keystroke costs. jsdom lays nothing
 * out and fires no `load` for a `srcdoc`, so an observer stands in for the row's geometry and
 * `load` is dispatched by hand, as `preview.test.ts` does; the layout is the end-to-end suite's.
 */

const slide = (at: number, words = `slide ${String(at)}`): Thumbnail => ({
  id: `lamina-${String(at)}|grid-1x1`,
  label: String(at),
  html: `<!doctype html><p>${words}</p>`,
  width: 1080,
  height: 1350,
});

const TEN: readonly Thumbnail[] = Array.from({ length: 10 }, (_, at) => slide(at + 1));

async function strip(items: readonly Thumbnail[], selected?: string): Promise<SlideThumbnails> {
  const element = document.createElement('tyto-slide-thumbnails');
  element.items = items;
  element.selected = selected;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

const cells = (element: SlideThumbnails): HTMLElement[] => [
  ...element.querySelectorAll<HTMLElement>('[data-thumbnail]'),
];
const frames = (element: SlideThumbnails): HTMLIFrameElement[] => [
  ...element.querySelectorAll('iframe'),
];

/** What Chromium does once a `srcdoc` document is in; jsdom never fires it for one. */
const loadAll = (element: SlideThumbnails): void => {
  for (const frame of frames(element)) frame.dispatchEvent(new Event('load'));
};

/**
 * An observer that says the first `visible` cells are on screen, as a row that fits that many
 * would. It reports asynchronously, as the real one does.
 */
function observeFirst(visible: number): void {
  class FakeObserver {
    constructor(private readonly report: IntersectionObserverCallback) {}
    observe(target: Element): void {
      const at = [...(target.parentElement?.children ?? [])].indexOf(target);
      queueMicrotask(() => {
        this.report(
          [{ target, isIntersecting: at < visible } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      });
    }
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the slide thumbnails', () => {
  it('draws one thumbnail per item, in order, labelled with its number', async () => {
    const element = await strip(TEN);

    expect(cells(element).map((cell) => cell.textContent?.trim())).toEqual(
      TEN.map((item) => item.label),
    );
    expect(element.getAttribute('role')).toBe('listbox');
  });

  it('scales each one to the fixed height, the width following the format', async () => {
    const element = await strip([slide(1), { ...slide(2), width: 1080, height: 1920 }]);
    const papers = [...element.querySelectorAll<HTMLElement>('.thumbnail__paper')];

    expect(papers.map((paper) => paper.style.height)).toEqual([
      `${String(THUMBNAIL_HEIGHT)}px`,
      `${String(THUMBNAIL_HEIGHT)}px`,
    ]);
    expect(papers.map((paper) => paper.style.width)).toEqual(['77px', '54px']);
  });

  it('marks the selected one and makes it the row’s one tab stop', async () => {
    const element = await strip(TEN, TEN[3]!.id);

    expect(cells(element).map((cell) => cell.getAttribute('aria-selected'))).toEqual(
      TEN.map((_, at) => String(at === 3)),
    );
    expect(cells(element).map((cell) => cell.tabIndex)).toEqual(
      TEN.map((_, at) => (at === 3 ? 0 : -1)),
    );
  });

  it('chooses the seventh of ten when it is clicked', async () => {
    const element = await strip(TEN, TEN[0]!.id);
    const chosen: string[] = [];
    element.choose = (id) => chosen.push(id);

    cells(element)[6]!.click();

    expect(chosen).toEqual([TEN[6]!.id]);
  });

  it('moves the selection with the arrows, Home and End', async () => {
    const element = await strip(TEN, TEN[4]!.id);
    const chosen: string[] = [];
    element.choose = (id) => {
      chosen.push(id);
      element.selected = id;
    };
    const press = async (key: string): Promise<void> => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await element.updateComplete;
    };

    await press('ArrowRight');
    await press('ArrowLeft');
    await press('ArrowLeft');
    await press('End');
    await press('ArrowRight');
    await press('Home');

    expect(chosen.map((id) => id.split('|')[0])).toEqual([
      'lamina-6',
      'lamina-5',
      'lamina-4',
      'lamina-10',
      'lamina-1',
    ]);
    expect(document.activeElement).toBe(cells(element)[0]);
  });

  it('re-navigates only the thumbnail whose slide changed: 1 of 10 for a keystroke', async () => {
    const element = await strip(TEN);
    loadAll(element);
    const writes = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute');

    element.items = TEN.map((item, at) => (at === 2 ? slide(3, 'slide 3, edited') : item));
    await element.updateComplete;
    const navigated = writes.mock.calls.filter(([name]) => name === 'srcdoc').length;

    expect(navigated, 'srcdoc writes after one keystroke on slide 3').toBe(1);
    expect(frames(element)[2]!.getAttribute('srcdoc')).toContain('slide 3, edited');
  });

  it('keeps each iframe for an item that stays, so a document change is a navigation', async () => {
    const element = await strip(TEN);
    const before = frames(element);

    element.items = TEN.map((item, at) => (at === 2 ? slide(3, 'edited') : item));
    await element.updateComplete;

    expect(frames(element)).toEqual(before);
  });

  it('gives no document to a thumbnail off screen', async () => {
    observeFirst(4);
    const element = await strip(TEN);
    // The observer reports a microtask after it is asked; the render it asks for follows.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;

    const shown = frames(element).map((frame) => frame.hasAttribute('srcdoc'));
    expect(shown, 'which of the ten were given a srcdoc').toEqual(TEN.map((_, at) => at < 4));
  });
});
