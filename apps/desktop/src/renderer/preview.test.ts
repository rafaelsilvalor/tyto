// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  type Artwork,
  type Frame,
  type PreviewElements,
  type PreviewState,
  type Selection,
  FORMAT_ATTRIBUTE,
  ZOOM_STEPS,
  artworksOf,
  createRequestGate,
  errorCount,
  fitZoom,
  formatBytes,
  formatsOf,
  frameFor,
  imageDocument,
  imageInfoLine,
  keepSelection,
  paintImage,
  paintPreview,
  stageBox,
  stepZoom,
  svgViewBoxSize,
  artworkOfThumbnail,
  thumbnailId,
  thumbnailsOf,
} from './preview.js';
import type { SlideThumbnails } from './slide-thumbnails.js';
import './slide-thumbnails.js';
import { previewElementsOf } from './preview-pane.js';

/**
 * The preview pane, in jsdom.
 *
 * Two of the card's acceptance criteria live here rather than in the end-to-end suite, and
 * on purpose: *switching a format tab must not re-render* and *a stale answer is discarded*
 * are both claims about something **not** happening, and a real window can only show you
 * that it did not happen this time. A function that never had a bridge to call cannot call
 * one, and `requestGate` can be handed answers in an order a real one would be lucky to
 * produce.
 *
 * jsdom lays nothing out, so `fitZoom` is tested as arithmetic and the layout it drives is
 * the end-to-end suite's and the maintainer's eyes (TYTO-40 found three bugs that way).
 */

const frame = (artwork: string, format: string, width = 1080, height = 1080): Frame => ({
  artwork,
  format,
  width,
  height,
  html: `<!doctype html><title>${artwork}.${format}</title>`,
});

/** Two slides in two formats, which is the shape every interesting question needs. */
const CAROUSEL: readonly Frame[] = [
  frame('artwork-1', 'feed'),
  frame('artwork-1', 'story', 1080, 1920),
  frame('artwork-2', 'feed'),
  frame('artwork-2', 'story', 1080, 1920),
];

/**
 * The artworks behind {@link CAROUSEL}, which is a separate list on purpose.
 *
 * Since E9.3 the slide list is driven by the artworks the brief produced rather than by the
 * frames, because a slide that renders to one format only would otherwise vanish from the
 * list when the other tab is picked. The two lists agree here and the tests below are about
 * what happens when they do not.
 */
const SLIDES: readonly Artwork[] = [
  { id: 'artwork-1', index: 0, range: { start: 20, end: 30 } },
  { id: 'artwork-2', index: 1, range: { start: 31, end: 41 } },
];

/** Ten slides in one format, numbered by the brief's own order. */
const TEN: readonly Artwork[] = Array.from({ length: 10 }, (_, at) => ({
  id: `lamina-${String(at + 1)}`,
  index: at,
  range: { start: at * 10, end: at * 10 + 9 },
}));
const TEN_FRAMES: readonly Frame[] = TEN.map((artwork) => frame(artwork.id, 'grid-1x1'));

/** The toggle's two labels, as `main.ts` hands them over in English. */
const LABELS = { hide: 'Hide the slide strip', show: 'Show the slide strip' } as const;

const NOTHING: Selection = { format: undefined, artwork: undefined };

function pane(document_: Document): PreviewElements {
  const make = <T extends HTMLElement>(tag: string): T => document_.createElement(tag) as T;
  const elements = {
    tabs: make('div'),
    strip: make<SlideThumbnails>('tyto-slide-thumbnails'),
    stripToggle: make('button'),
    stage: make('div'),
    paper: make('div'),
    frame: make<HTMLIFrameElement>('iframe'),
    empty: make('p'),
    broken: make('p'),
    stale: make('p'),
    zoomLevel: make('span'),
  };
  elements.stale.hidden = true;
  elements.broken.hidden = true;
  elements.paper.append(elements.frame);
  elements.stage.append(elements.paper, elements.empty, elements.broken, elements.stale);
  document_.body.append(elements.tabs, elements.stripToggle, elements.stage, elements.strip);
  return elements;
}

/** What Chromium does once a `srcdoc` document is in; jsdom never fires it for one. */
function loaded(iframe: HTMLIFrameElement): void {
  iframe.dispatchEvent(new Event('load'));
}

describe('reading a frame list', () => {
  it('lists each format and each artwork once, in the order they appear', () => {
    expect(formatsOf(CAROUSEL)).toEqual(['feed', 'story']);
    expect(artworksOf(SLIDES)).toEqual(['artwork-1', 'artwork-2']);
  });

  it('finds the one frame a selection names', () => {
    const found = frameFor(CAROUSEL, { format: 'story', artwork: 'artwork-2' });
    expect(found?.html).toContain('artwork-2.story');
  });

  it('answers undefined for a pair that does not exist', () => {
    // Not hypothetical: a brief can render its second slide to `story` only, and then there
    // is a `feed` and an `artwork-2` and no frame where they meet. Showing a different
    // slide would be worse than showing nothing.
    const partial = [frame('artwork-1', 'feed'), frame('artwork-2', 'story', 1080, 1920)];
    expect(frameFor(partial, { format: 'feed', artwork: 'artwork-2' })).toBeUndefined();
  });
});

describe('keeping the selection across a re-render', () => {
  it('starts on the first frame when nothing was selected', () => {
    expect(keepSelection(NOTHING, CAROUSEL, SLIDES)).toEqual({
      format: 'feed',
      artwork: 'artwork-1',
    });
  });

  it('keeps what the user picked when it is still there', () => {
    // The whole point. A preview runs per keystroke, so a selection that reset on every
    // answer would drag the pane back to slide 1 while somebody types on slide 2.
    const chosen: Selection = { format: 'story', artwork: 'artwork-2' };
    expect(keepSelection(chosen, CAROUSEL, SLIDES)).toEqual(chosen);
  });

  it('falls back when what was selected stops existing', () => {
    // Deleting a slide from the brief is an ordinary edit, and the pane has to land
    // somewhere rather than showing nothing until the user clicks.
    const chosen: Selection = { format: 'story', artwork: 'artwork-2' };
    const shorter = [frame('artwork-1', 'feed'), frame('artwork-1', 'story', 1080, 1920)];
    const one = SLIDES.slice(0, 1);

    expect(keepSelection(chosen, shorter, one)).toEqual({ format: 'story', artwork: 'artwork-1' });
  });

  it('clamps to the last slide left when the selected one was past the new end', () => {
    // On slide 10 of 10, the last `::lamina` deleted: slide 9, not back to slide 1 (TYTO-323).
    const nine = TEN.slice(0, 9);
    const frames = TEN_FRAMES.slice(0, 9);
    const chosen: Selection = { format: 'grid-1x1', artwork: 'lamina-10' };

    expect(keepSelection(chosen, frames, nine, TEN)).toEqual({
      format: 'grid-1x1',
      artwork: 'lamina-9',
    });
  });

  it('keeps each half independently', () => {
    // The format survived and the artwork did not; keeping the format is what stops a
    // deleted slide from also throwing the user back to the first tab.
    const chosen: Selection = { format: 'story', artwork: 'artwork-9' };
    expect(keepSelection(chosen, CAROUSEL, SLIDES)).toEqual({
      format: 'story',
      artwork: 'artwork-1',
    });
  });
});

describe('switching format', () => {
  it('shows the other format from frames already in hand', () => {
    // *Switching format tab shows the already-rendered frame without re-rendering* — the
    // acceptance criterion, read as what it actually asserts: the frame is found in the
    // list, so nothing has to be asked for. There is no bridge in this test to ask.
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
    });
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.feed');
    loaded(elements.frame);

    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'story', artwork: 'artwork-1' },
      zoom: 1,
    });
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.story');
  });

  it('marks exactly one tab, and carries the format on it', () => {
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'story', artwork: 'artwork-1' },
      zoom: 1,
    });

    const tabs = [...elements.tabs.querySelectorAll('button')];
    expect(tabs.map((tab) => tab.getAttribute(FORMAT_ATTRIBUTE))).toEqual(['feed', 'story']);
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent).toBe(
      'story',
    );
  });
});

describe('the slide strip (TYTO-323)', () => {
  it('has one thumbnail per slide, in the brief’s order, numbered from one', () => {
    const thumbnails = thumbnailsOf({
      frames: [...TEN_FRAMES].reverse(),
      artworks: TEN,
      selection: { format: 'grid-1x1', artwork: 'lamina-1' },
    });

    expect(thumbnails.map((thumbnail) => thumbnail.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(thumbnails.map((thumbnail) => artworkOfThumbnail(thumbnail.id))).toEqual(
      TEN.map((artwork) => artwork.id),
    );
    expect(thumbnails[6]?.html).toContain('lamina-7.grid-1x1');
  });

  it('draws the selected format only, and a slide with no frame in it keeps the others’ numbers', () => {
    const partial = [frame('artwork-1', 'story', 1080, 1920), frame('artwork-2', 'feed')];
    const story = thumbnailsOf({
      frames: [...CAROUSEL.filter((each) => each.artwork === 'artwork-2'), ...partial],
      artworks: SLIDES,
      selection: { format: 'feed', artwork: 'artwork-2' },
    });

    expect(story.map((thumbnail) => thumbnail.label)).toEqual(['2']);
    expect(story[0]?.id).toBe(thumbnailId('artwork-2', 'feed'));
  });

  it('hands the strip its thumbnails and marks the selected one', () => {
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'story', artwork: 'artwork-2' },
      zoom: 1,
      stripLabel: 'Slide strip',
      stripToggleLabels: LABELS,
    });

    expect(elements.strip.hidden).toBe(false);
    expect(elements.strip.items.map((item) => item.label)).toEqual(['1', '2']);
    expect(elements.strip.selected).toBe(thumbnailId('artwork-2', 'story'));
    expect(elements.strip.label).toBe('Slide strip');
    expect(elements.stripToggle.title).toBe('Hide the slide strip');
  });

  it('says what a press does: Hide while the strip shows, Show once it is hidden', () => {
    // Rafael, 2026-10-23: "O texto muda com o estado". The label changes, so no `aria-pressed`.
    const { document } = globalThis;
    const elements = pane(document);
    const paint = (stripHidden: boolean): string[] => {
      paintPreview(elements, {
        stale: false,
        frames: CAROUSEL,
        artworks: SLIDES,
        selection: { format: 'feed', artwork: 'artwork-1' },
        zoom: 1,
        stripHidden,
        stripToggleLabels: LABELS,
      });
      return [elements.stripToggle.title, elements.stripToggle.getAttribute('aria-label') ?? ''];
    };

    expect(paint(false)).toEqual(['Hide the slide strip', 'Hide the slide strip']);
    expect(paint(true)).toEqual(['Show the slide strip', 'Show the slide strip']);
    expect(paint(false)).toEqual(['Hide the slide strip', 'Hide the slide strip']);
    expect(elements.stripToggle.hasAttribute('aria-pressed')).toBe(false);
  });

  it('hides the strip when the tab hid it, and keeps the toggle to bring it back', () => {
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
      stripHidden: true,
    });

    expect(elements.strip.hidden).toBe(true);
    expect(elements.strip.items).toEqual([]);
    expect(elements.stripToggle.hidden).toBe(false);
    expect(elements.stripToggle.classList.contains('preview__strip-toggle--on')).toBe(false);
  });

  it('hides itself, and its toggle, when there is only one slide', () => {
    // A strip of one is furniture that reads like a control.
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      stale: false,
      frames: [frame('artwork-1', 'feed')],
      artworks: SLIDES.slice(0, 1),
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
    });

    expect(elements.strip.hidden).toBe(true);
    expect(elements.stripToggle.hidden).toBe(true);
  });
});

describe('All slides mode (TYTO-323)', () => {
  /** Ten slides of one format with slide 1 on the stage, in `mode`. */
  const ten = (mode: 'one' | 'all', extra: Partial<PreviewState> = {}): PreviewState => ({
    stale: false,
    frames: TEN_FRAMES,
    artworks: TEN,
    selection: { format: 'grid-1x1', artwork: 'lamina-1' },
    zoom: 'fit',
    mode,
    ...extra,
  });

  it('draws every slide in the grid, in order and numbered, in place of the stage', () => {
    const elements = pane(globalThis.document);

    paintPreview(elements, ten('all'));

    expect(elements.strip.hidden).toBe(false);
    expect(elements.strip.layout).toBe('grid');
    expect(elements.strip.items.map((item) => item.label)).toEqual(
      TEN.map((_, at) => String(at + 1)),
    );
    expect(elements.strip.items.map((item) => artworkOfThumbnail(item.id))).toEqual(
      TEN.map((artwork) => artwork.id),
    );
    expect(elements.stage.hidden).toBe(true);
    // The strip's toggle has nothing to hide while the grid has the pane.
    expect(elements.stripToggle.hidden).toBe(true);
  });

  it('shows the grid even when the tab hid its strip, and keeps the flag for One slide', () => {
    const elements = pane(globalThis.document);

    paintPreview(elements, ten('all', { stripHidden: true }));
    expect(elements.strip.hidden).toBe(false);
    expect(elements.strip.layout).toBe('grid');

    paintPreview(elements, ten('one', { stripHidden: true }));
    expect(elements.strip.hidden).toBe(true);
    expect(elements.strip.layout).toBe('strip');
    expect(elements.stage.hidden).toBe(false);
  });

  it('keeps the stale marker over the grid, and the stage holds nothing else', () => {
    const elements = pane(globalThis.document);

    paintPreview(elements, ten('all', { stale: true }));

    expect(elements.stage.hidden).toBe(false);
    expect(elements.stale.hidden).toBe(false);
    expect(elements.paper.hidden).toBe(true);
    expect(elements.empty.hidden).toBe(true);
  });

  it('shows a brief of one slide on the stage, whatever the mode', () => {
    const elements = pane(globalThis.document);

    paintPreview(elements, {
      ...ten('all'),
      frames: TEN_FRAMES.slice(0, 1),
      artworks: TEN.slice(0, 1),
    });

    expect(elements.strip.layout).toBe('strip');
    expect(elements.strip.hidden).toBe(true);
    expect(elements.stage.hidden).toBe(false);
    expect(elements.paper.hidden).toBe(false);
  });

  it('marks the mode that is on in the real pane’s bar, and hides the zoom for the grid', async () => {
    const element = document.createElement('tyto-preview-pane');
    document.body.append(element);
    await element.updateComplete;
    const elements = previewElementsOf(element)!;
    const pressed = (): (string | null)[] =>
      [...element.querySelectorAll('[data-preview-mode]')].map((button) =>
        button.getAttribute('aria-pressed'),
      );

    paintPreview(elements, ten('all'));
    expect(pressed()).toEqual(['false', 'true']);
    expect(elements.zoom?.hidden).toBe(true);
    expect(elements.modes?.hidden).toBe(false);

    paintPreview(elements, ten('one'));
    expect(pressed()).toEqual(['true', 'false']);
    expect(elements.zoom?.hidden).toBe(false);
    element.remove();
  });

  it('draws the thumbnails once for both modes: a keystroke on slide 3 re-navigates one document', async () => {
    // The card: "a brief's thumbnails are drawn once per change, not once per mode". The real
    // pane, so a second thumbnails element in its markup would be counted here.
    const element = document.createElement('tyto-preview-pane');
    document.body.append(element);
    await element.updateComplete;
    const elements = previewElementsOf(element)!;
    const settle = async (): Promise<void> => {
      for (const strip of element.querySelectorAll('tyto-slide-thumbnails')) {
        await (strip as SlideThumbnails).updateComplete;
      }
      for (const iframe of element.querySelectorAll('iframe')) loaded(iframe);
    };

    paintPreview(elements, ten('one'));
    await settle();
    paintPreview(elements, ten('all'));
    await settle();
    const frames = element.querySelectorAll('iframe').length;
    const writes = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute');

    const edited = TEN_FRAMES.map((each, at) =>
      at === 2 ? { ...each, html: `${each.html}<p>slide 3, edited</p>` } : each,
    );
    paintPreview(elements, ten('all', { frames: edited }));
    await settle();
    paintPreview(elements, ten('one', { frames: edited }));
    await settle();
    const navigated = writes.mock.calls.filter(([name]) => name === 'srcdoc').length;
    writes.mockRestore();

    expect(navigated, 'srcdoc writes for one keystroke on slide 3, in both modes').toBe(1);
    // The stage's frame and one thumbnail per slide, whichever mode drew them.
    expect(frames, 'iframes in the pane with ten slides').toBe(1 + TEN.length);
    element.remove();
  });
});

describe('showing a frame', () => {
  it('gives the document its own size and scales with a transform', () => {
    // The difference between a preview and a different artwork: `width: 1080px` laid out in
    // a 300px box reflows the text, and what you would be looking at is a layout nobody is
    // going to export.
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'story', artwork: 'artwork-1' },
      zoom: 0.25,
    });

    expect(elements.frame.style.width).toBe('1080px');
    expect(elements.frame.style.height).toBe('1920px');
    expect(elements.frame.style.transform).toBe('scale(0.25)');
    // The box that takes up room is the scaled one; a transform does not affect layout.
    expect(elements.paper.style.width).toBe('270px');
    expect(elements.paper.style.height).toBe('480px');
  });

  it('shows the empty message instead of an empty frame', () => {
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      frames: [],
      artworks: [],
      selection: NOTHING,
      zoom: 'fit',
      stale: false,
    });

    expect(elements.paper.hidden).toBe(true);
    expect(elements.empty.hidden).toBe(false);
  });

  /**
   * E9.13: the artwork stays and says it is out of date.
   *
   * Three claims, and the third is the one a stored flag would get wrong. The marker appears
   * beside a frame that is still drawn — the pixels are the easy half — it disappears again
   * on the next good answer with nothing resetting it, and it never appears on the empty
   * state, where there is no artwork for it to be commenting on.
   */
  it('marks the artwork as older than the text, and stops when it is not', () => {
    const { document } = globalThis;
    const elements = pane(document);
    const showing = {
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
    } as const;

    paintPreview(elements, { ...showing, stale: true });

    // The frame is still there. Blanking it is what this card exists to stop.
    expect(elements.paper.hidden).toBe(false);
    expect(elements.stale.hidden).toBe(false);

    paintPreview(elements, { ...showing, stale: false });

    expect(elements.paper.hidden).toBe(false);
    expect(elements.stale.hidden).toBe(true);
  });

  it('never marks the empty state, which has no artwork to be out of date', () => {
    const { document } = globalThis;
    const elements = pane(document);

    // `stale: true` with no frames cannot happen — `isStale` answers `false` without frames
    // — so this asserts the pane does not depend on that being true elsewhere.
    paintPreview(elements, {
      frames: [],
      artworks: [],
      selection: NOTHING,
      zoom: 'fit',
      stale: true,
    });

    expect(elements.empty.hidden).toBe(false);
    expect(elements.stale.hidden).toBe(true);
  });

  it('says the brief cannot be drawn in place of "write a brief" when told so (TYTO-268)', () => {
    const { document } = globalThis;
    const elements = pane(document);
    const nothing = {
      frames: [],
      artworks: [],
      selection: NOTHING,
      zoom: 'fit',
      stale: false,
    } as const;

    paintPreview(elements, { ...nothing, broken: true });

    expect(elements.paper.hidden).toBe(true);
    expect(elements.empty.hidden).toBe(true);
    expect(elements.broken.hidden).toBe(false);

    paintPreview(elements, { ...nothing, broken: false });

    expect(elements.empty.hidden).toBe(false);
    expect(elements.broken.hidden).toBe(true);
  });

  it('hides the broken line once a frame is on screen', () => {
    const { document } = globalThis;
    const elements = pane(document);
    elements.broken.hidden = false;

    paintPreview(elements, {
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
      stale: true,
      broken: true,
    });

    expect(elements.paper.hidden).toBe(false);
    expect(elements.broken.hidden).toBe(true);
    expect(elements.empty.hidden).toBe(true);
  });

  it('does not rewrite srcdoc for a document that has not changed', () => {
    // Assigning `srcdoc` reloads the iframe. Repainting for a zoom change or a language
    // change would otherwise flash the frame white on every keystroke that produced the
    // same document.
    const { document } = globalThis;
    const elements = pane(document);
    const state = {
      frames: CAROUSEL,
      artworks: SLIDES,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1 as const,
    };

    paintPreview(elements, { ...state, stale: false });
    let writes = 0;
    elements.frame.setAttribute = new Proxy(elements.frame.setAttribute, {
      apply(target, thisArgument, args: [string, string]) {
        if (args[0] === 'srcdoc') writes += 1;
        return Reflect.apply(target, thisArgument, args);
      },
    });

    paintPreview(elements, { ...state, zoom: 0.5, stale: false });
    expect(writes).toBe(0);
  });
});

describe('one srcdoc navigation at a time (TYTO-219)', () => {
  // A fresh iframe keeps the *first* of two `srcdoc` assignments when the second lands before
  // the first one's `load`, so a story clicked before the grid-1x1 preview loaded showed the
  // grid document, 1080 px tall, in a 1920 px frame. These pin the rule that avoids it.
  const feed = { format: 'feed', artwork: 'artwork-1' };
  const story = { format: 'story', artwork: 'artwork-1' };
  const second = { format: 'feed', artwork: 'artwork-2' };

  function show(elements: PreviewElements, selection: Selection): void {
    paintPreview(elements, {
      stale: false,
      frames: CAROUSEL,
      artworks: SLIDES,
      selection,
      zoom: 1,
    });
  }

  /** Counts `srcdoc` writes from here on, which is the number of navigations asked for. */
  function countWrites(iframe: HTMLIFrameElement): { readonly writes: string[] } {
    const record = { writes: [] as string[] };
    iframe.setAttribute = new Proxy(iframe.setAttribute, {
      apply(target, thisArgument, args: [string, string]) {
        if (args[0] === 'srcdoc') record.writes.push(args[1]);
        return Reflect.apply(target, thisArgument, args);
      },
    });
    return record;
  }

  it('does not navigate again while a document is loading, and applies the newer one on load', () => {
    const elements = pane(globalThis.document);
    show(elements, feed);
    show(elements, story);

    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.feed');
    loaded(elements.frame);
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.story');
  });

  it('applies only the last of three paints made before the first load', () => {
    const elements = pane(globalThis.document);
    const record = countWrites(elements.frame);
    show(elements, feed);
    show(elements, story);
    show(elements, second);

    loaded(elements.frame);
    loaded(elements.frame);

    expect(record.writes.map((html) => /<title>(.*)<\/title>/.exec(html)?.[1])).toEqual([
      'artwork-1.feed',
      'artwork-2.feed',
    ]);
  });

  it('does not navigate again when the newest document is the one already loading', () => {
    const elements = pane(globalThis.document);
    const record = countWrites(elements.frame);
    show(elements, feed);
    show(elements, story);
    show(elements, feed);

    loaded(elements.frame);

    expect(record.writes).toHaveLength(1);
    // And the frame is free again: the next change is applied at once.
    show(elements, story);
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.story');
  });

  it('does not write to an iframe that left the page while it loaded', () => {
    const elements = pane(globalThis.document);
    const record = countWrites(elements.frame);
    show(elements, feed);
    show(elements, story);

    elements.frame.remove();
    loaded(elements.frame);
    loaded(elements.frame);

    expect(record.writes).toHaveLength(1);
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.feed');
  });

  it('keeps nothing pending for a removed iframe, and a replacement starts on its own', () => {
    const elements = pane(globalThis.document);
    show(elements, feed);
    elements.frame.remove();
    loaded(elements.frame);

    // The same element back in the page navigates at once rather than waiting on a load that
    // already happened.
    elements.paper.append(elements.frame);
    show(elements, story);
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.story');

    // A new element is not held back by the old one's pending navigation.
    show(elements, second);
    const replacement = { ...elements, frame: globalThis.document.createElement('iframe') };
    elements.frame.replaceWith(replacement.frame);
    show(replacement, feed);
    expect(replacement.frame.getAttribute('srcdoc')).toContain('artwork-1.feed');
  });
});

describe('zoom', () => {
  it('fits the larger dimension and never enlarges past 1:1', () => {
    const story = frame('artwork-1', 'story', 1080, 1920);

    expect(fitZoom(story, { width: 1080, height: 960 })).toBeCloseTo(0.5);
    expect(fitZoom(story, { width: 540, height: 1920 })).toBeCloseTo(0.5);
    // A frame smaller than the stage stays at 1:1. Blowing a 200px frame up to fill the
    // pane would show a blurry preview of a sharp artwork.
    expect(fitZoom(frame('a', 'feed', 200, 200), { width: 1000, height: 1000 })).toBe(1);
  });

  it('takes the stage padding off before fitting', () => {
    // `clientHeight` includes padding, so fitting to it puts a frame exactly as tall as the
    // box inside a box 32px shorter — and the stage scrolls at the one zoom whose whole job
    // is not to. jsdom reports 0 for `clientHeight`, so this measures the subtraction rather
    // than the layout: the padding has to come off whatever the box reports.
    const { document } = globalThis;
    const stage = document.createElement('div');
    stage.style.padding = '16px';
    document.body.append(stage);

    Object.defineProperty(stage, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(stage, 'clientHeight', { value: 300, configurable: true });

    expect(stageBox(stage)).toEqual({ width: 368, height: 268 });
  });

  it('answers 1 for a stage that has not been laid out', () => {
    // jsdom reports 0, and so does a pane inside a `hidden` parent. A division by it would
    // be `Infinity` and a frame scaled to nothing.
    expect(fitZoom(CAROUSEL[0]!, { width: 0, height: 0 })).toBe(1);
  });

  it('steps to the next stop in each direction and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    // From a `fit` value that is not one of the stops.
    expect(stepZoom(0.37, 1)).toBe(0.5);
    expect(stepZoom(0.37, -1)).toBe(0.25);
    expect(stepZoom(ZOOM_STEPS.at(-1)!, 1)).toBe(ZOOM_STEPS.at(-1));
    expect(stepZoom(ZOOM_STEPS[0]!, -1)).toBe(ZOOM_STEPS[0]);
  });
});

describe('discarding a stale answer', () => {
  it('accepts only the id it issued last', () => {
    // *Stale results are discarded (request ids)* — the acceptance criterion. Answers
    // resolve out of order for a real reason: a compile of three slides can land after the
    // compile of the two characters that replaced them.
    const gate = createRequestGate();

    const first = gate.next();
    const second = gate.next();

    expect(gate.accept(first)).toBe(false);
    expect(gate.accept(second)).toBe(true);
  });

  it('keeps accepting the latest until another is issued', () => {
    // Not single-use: the answer arrives once, but a retry or a duplicated reply must not
    // be read as staleness.
    const gate = createRequestGate();
    const id = gate.next();

    expect(gate.accept(id)).toBe(true);
    expect(gate.accept(id)).toBe(true);
  });

  it('accepts nothing before anything is asked', () => {
    // The ids start at 1, so a 0 that arrived from anywhere is not an answer to a question
    // this gate asked.
    expect(createRequestGate().accept(0)).toBe(false);
  });
});

describe('counting problems', () => {
  it('counts errors and not warnings', () => {
    // Only errors colour the status line: a warning is a document that still renders
    // (ADR 0013), and painting it red would make every unused slot look like a failure.
    const diagnostics = [
      { severity: 'error' as const, code: 'E_X', message: '' },
      { severity: 'warning' as const, code: 'W_Y', message: '' },
      { severity: 'info' as const, code: 'W_Z', message: '' },
    ];

    expect(errorCount(diagnostics)).toBe(1);
  });
});

/** TYTO-366, ADR 0124: an image from the explorer, through the brief's one path to the screen. */
describe('an image in the preview', () => {
  const HOSTILE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">' +
    '<image href="http://127.0.0.1:9/img" width="40" height="20"/>' +
    '<script>fetch("http://127.0.0.1:9/script")</script></svg>';
  const svgUrl = `data:image/svg+xml;base64,${btoa(HOSTILE_SVG)}`;
  /** A brief of ten slides, the pane's state before an image comes in. */
  const brief: PreviewState = {
    stale: false,
    frames: TEN_FRAMES,
    artworks: TEN,
    selection: { format: 'grid-1x1', artwork: 'lamina-1' },
    zoom: 'fit',
    mode: 'one',
  };

  it('puts exactly one <img> of the data URI in the document, and no SVG markup', () => {
    const html = imageDocument(svgUrl);
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    expect([...parsed.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
      svgUrl,
    ]);
    expect(parsed.querySelectorAll('svg, script, image, iframe, object, embed')).toHaveLength(0);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('127.0.0.1');
  });

  it('writes no source at all for a value that is not a base64 image data URI', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html;base64,PHA+', 'x" onerror="y']) {
      expect(imageDocument(value)).toContain('<img alt="" src="">');
    }
  });

  it('hides the formats, the modes and the strip, keeps the zoom, and fits without enlarging', async () => {
    const element = document.createElement('tyto-preview-pane');
    document.body.append(element);
    await element.updateComplete;
    const elements = previewElementsOf(element)!;
    paintPreview(elements, brief);
    loaded(elements.frame);

    const zoom = paintImage(elements, {
      image: { dataUrl: svgUrl, width: 40, height: 20 },
      info: 'vetor.svg · 40 × 20 px (scalable) · 1 KB',
      zoom: 'fit',
    });

    expect(zoom).toBe(1);
    expect(elements.tabs.hidden).toBe(true);
    expect(elements.info?.hidden).toBe(false);
    expect(elements.info?.textContent).toBe('vetor.svg · 40 × 20 px (scalable) · 1 KB');
    expect(elements.modes?.hidden).toBe(true);
    expect(elements.stripToggle.hidden).toBe(true);
    expect(elements.strip.hidden).toBe(true);
    expect(elements.zoom?.hidden).toBe(false);
    expect(elements.paper.hidden).toBe(false);
    expect(elements.frame.getAttribute('srcdoc')).toBe(imageDocument(svgUrl));
    expect(elements.frame.style.width).toBe('40px');
    expect(fitZoom({ width: 4000, height: 2000, html: '' }, { width: 400, height: 400 })).toBe(0.1);

    // A brief painted again gets its bar back.
    paintPreview(elements, brief);
    expect(elements.tabs.hidden).toBe(false);
    expect(elements.info?.hidden).toBe(true);
    expect(elements.notice?.hidden).toBe(true);
    element.remove();
  });

  it('says why an image is not shown, in the stage, with nothing drawn', async () => {
    const element = document.createElement('tyto-preview-pane');
    document.body.append(element);
    await element.updateComplete;
    const elements = previewElementsOf(element)!;

    paintImage(elements, {
      info: 'foto.png · 40 MB',
      notice: 'This image is 40 MB, over the 32 MB the preview shows.',
      zoom: 'fit',
    });

    expect(elements.paper.hidden).toBe(true);
    expect(elements.notice?.hidden).toBe(false);
    expect(elements.notice?.textContent).toBe(
      'This image is 40 MB, over the 32 MB the preview shows.',
    );
    expect(elements.empty.hidden).toBe(true);
    expect(elements.zoomLevel.textContent).toBe('');
    element.remove();
  });

  it('writes the bar line and the sizes in the window language', () => {
    expect(
      imageInfoLine({
        name: 'logo.png',
        bytes: 84 * 1024,
        size: { width: 1200, height: 630 },
        scalable: undefined,
        locale: 'en',
      }),
    ).toBe('logo.png · 1200 × 630 px · 84 KB');
    expect(
      imageInfoLine({ name: 'a.svg', bytes: 500, size: undefined, scalable: 'x', locale: 'en' }),
    ).toBe('a.svg · 500 B');
    expect(formatBytes(32 * 1024 * 1024, 'en')).toBe('32 MB');
    expect(formatBytes(1.5 * 1024 * 1024, 'pt-BR')).toBe('1,5 MB');
  });

  it('reads an SVG size from its viewBox only when the root gives no width and height', () => {
    expect(svgViewBoxSize('<svg viewBox="0 0 40 20"></svg>')).toEqual({ width: 40, height: 20 });
    expect(svgViewBoxSize('<svg viewBox="0,0,40.4,20.6" width="100%">')).toEqual({
      width: 40,
      height: 21,
    });
    expect(svgViewBoxSize('<svg width="80" height="40" viewBox="0 0 40 20">')).toBeUndefined();
    expect(svgViewBoxSize('<svg viewBox="0 0 0 20">')).toBeUndefined();
    expect(svgViewBoxSize('<svg>')).toBeUndefined();
  });
});
