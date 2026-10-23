// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type SlideThumbnails,
  type Thumbnail,
  GRID_MINIMUM_HEIGHT,
  THUMBNAIL_BLEED,
  THUMBNAIL_HEIGHT,
  gridThumbnailLayout,
  thumbnailBox,
} from './slide-thumbnails.js';
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

describe('the grid’s layout', () => {
  const chrome = { gap: 16, cellWidth: 8, cellHeight: 28 };
  const square = { width: 1080, height: 1080 };

  it('fits ten squares in a wide pane in two rows of five', () => {
    // Five columns of (1000 - 4·16)/5 - 8 = 179.2 wide, two rows of (500 - 16)/2 - 28 = 214 tall.
    expect(gridThumbnailLayout(10, square, { width: 1000, height: 500 }, chrome)).toEqual({
      height: 179,
      columns: 5,
    });
  });

  it('keeps the format’s shape: four stories in one row, as wide as a quarter allows', () => {
    const story = { width: 1080, height: 1920 };
    // (1000 - 3·16)/4 - 8 = 230 wide, so 230 · 1920/1080 = 408.9 tall, under the 472 a row has.
    expect(gridThumbnailLayout(4, story, { width: 1000, height: 500 }, chrome)).toEqual({
      height: 408,
      columns: 4,
    });
  });

  it('never draws past the format’s own size, nor under the minimum', () => {
    const tiny = { width: 100, height: 100 };
    expect(gridThumbnailLayout(1, tiny, { width: 1000, height: 1000 }, chrome).height).toBe(100);
    // At the minimum the columns are as many as fit across: (300 + 16) / (64 + 8 + 16) = 3.6.
    expect(gridThumbnailLayout(200, square, { width: 300, height: 200 }, chrome)).toEqual({
      height: GRID_MINIMUM_HEIGHT,
      columns: 3,
    });
  });

  it('falls back to the strip’s height for a box with no size', () => {
    expect(gridThumbnailLayout(10, square, { width: 0, height: 0 }, chrome).height).toBe(
      THUMBNAIL_HEIGHT,
    );
  });
});

describe('a thumbnail’s box', () => {
  it('draws the document a pixel past its paper on both axes, so no edge of the paper shows', () => {
    // The paper is the scaled size rounded down, and the document reaches THUMBNAIL_BLEED past it:
    // at 125 % the paper's background is snapped out to a device pixel the document must cover.
    for (const height of [96, 128, 133, 179, 214]) {
      for (const format of [
        { width: 1080, height: 1080 },
        { width: 1080, height: 1350 },
        { width: 1080, height: 1920 },
        { width: 1200, height: 628 },
      ]) {
        const box = thumbnailBox(format, height);
        expect(
          format.width * box.scale,
          `${String(format.width)} wide at ${String(height)}`,
        ).toBeGreaterThanOrEqual(box.width + THUMBNAIL_BLEED - 1e-9);
        expect(
          format.height * box.scale,
          `${String(format.height)} tall at ${String(height)}`,
        ).toBeGreaterThanOrEqual(box.height + THUMBNAIL_BLEED - 1e-9);
        expect(box.height).toBeLessThanOrEqual(height);
      }
    }
  });
});

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
    expect(papers.map((paper) => paper.style.width)).toEqual(['76px', '54px']);
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

  it('opens a slide clicked in the grid, and only chooses one clicked in the strip', async () => {
    const element = await strip(TEN, TEN[0]!.id);
    const chosen: string[] = [];
    const opened: string[] = [];
    element.choose = (id) => chosen.push(id);
    element.open = (id) => opened.push(id);

    element.layout = 'grid';
    await element.updateComplete;
    cells(element)[6]!.click();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(opened).toEqual([TEN[6]!.id, TEN[0]!.id]);
    expect(chosen).toEqual([]);
    expect(element.classList.contains('thumbnails--grid')).toBe(true);
    expect(element.hasAttribute('aria-orientation')).toBe(false);

    element.layout = 'strip';
    await element.updateComplete;
    cells(element)[6]!.click();
    expect(chosen).toEqual([TEN[6]!.id]);
    expect(element.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('keeps every iframe when the layout changes, so a mode switch navigates nothing', async () => {
    const element = await strip(TEN);
    loadAll(element);
    const before = frames(element);
    const writes = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute');

    element.layout = 'grid';
    await element.updateComplete;

    expect(frames(element)).toEqual(before);
    expect(writes.mock.calls.filter(([name]) => name === 'srcdoc')).toEqual([]);
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
