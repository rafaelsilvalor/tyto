// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  type Frame,
  type PreviewElements,
  type Selection,
  FORMAT_ATTRIBUTE,
  ZOOM_STEPS,
  artworksOf,
  createRequestGate,
  errorCount,
  fitZoom,
  formatsOf,
  frameFor,
  keepSelection,
  paintPreview,
  stageBox,
  stepZoom,
} from './preview.js';

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

const NOTHING: Selection = { format: undefined, artwork: undefined };

function pane(document_: Document): PreviewElements {
  const make = <T extends HTMLElement>(tag: string): T => document_.createElement(tag) as T;
  const elements = {
    tabs: make('div'),
    slide: make<HTMLSelectElement>('select'),
    slideLabel: make('span'),
    stage: make('div'),
    paper: make('div'),
    frame: make<HTMLIFrameElement>('iframe'),
    empty: make('p'),
    zoomLevel: make('span'),
  };
  elements.paper.append(elements.frame);
  elements.stage.append(elements.paper, elements.empty);
  document_.body.append(elements.tabs, elements.slide, elements.slideLabel, elements.stage);
  return elements;
}

describe('reading a frame list', () => {
  it('lists each format and each artwork once, in the order they appear', () => {
    expect(formatsOf(CAROUSEL)).toEqual(['feed', 'story']);
    expect(artworksOf(CAROUSEL)).toEqual(['artwork-1', 'artwork-2']);
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
    expect(keepSelection(NOTHING, CAROUSEL)).toEqual({ format: 'feed', artwork: 'artwork-1' });
  });

  it('keeps what the user picked when it is still there', () => {
    // The whole point. A preview runs per keystroke, so a selection that reset on every
    // answer would drag the pane back to slide 1 while somebody types on slide 2.
    const chosen: Selection = { format: 'story', artwork: 'artwork-2' };
    expect(keepSelection(chosen, CAROUSEL)).toEqual(chosen);
  });

  it('falls back when what was selected stops existing', () => {
    // Deleting a slide from the brief is an ordinary edit, and the pane has to land
    // somewhere rather than showing nothing until the user clicks.
    const chosen: Selection = { format: 'story', artwork: 'artwork-2' };
    const shorter = [frame('artwork-1', 'feed'), frame('artwork-1', 'story', 1080, 1920)];

    expect(keepSelection(chosen, shorter)).toEqual({ format: 'story', artwork: 'artwork-1' });
  });

  it('keeps each half independently', () => {
    // The format survived and the artwork did not; keeping the format is what stops a
    // deleted slide from also throwing the user back to the first tab.
    const chosen: Selection = { format: 'story', artwork: 'artwork-9' };
    expect(keepSelection(chosen, CAROUSEL)).toEqual({ format: 'story', artwork: 'artwork-1' });
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
      frames: CAROUSEL,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
    });
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.feed');

    paintPreview(elements, {
      frames: CAROUSEL,
      selection: { format: 'story', artwork: 'artwork-1' },
      zoom: 1,
    });
    expect(elements.frame.getAttribute('srcdoc')).toContain('artwork-1.story');
  });

  it('marks exactly one tab, and carries the format on it', () => {
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      frames: CAROUSEL,
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

describe('the slide picker', () => {
  it('numbers the slides from one rather than showing their ids', () => {
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      frames: CAROUSEL,
      selection: { format: 'feed', artwork: 'artwork-2' },
      zoom: 1,
    });

    expect([...elements.slide.options].map((option) => option.textContent)).toEqual(['1', '2']);
    expect(elements.slide.value).toBe('artwork-2');
  });

  it('hides itself, and its label, when there is only one slide', () => {
    // A picker with one option is furniture that reads like a control.
    const { document } = globalThis;
    const elements = pane(document);

    paintPreview(elements, {
      frames: [frame('artwork-1', 'feed')],
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1,
    });

    expect(elements.slide.hidden).toBe(true);
    expect(elements.slideLabel.hidden).toBe(true);
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
      frames: CAROUSEL,
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

    paintPreview(elements, { frames: [], selection: NOTHING, zoom: 'fit' });

    expect(elements.paper.hidden).toBe(true);
    expect(elements.empty.hidden).toBe(false);
  });

  it('does not rewrite srcdoc for a document that has not changed', () => {
    // Assigning `srcdoc` reloads the iframe. Repainting for a zoom change or a language
    // change would otherwise flash the frame white on every keystroke that produced the
    // same document.
    const { document } = globalThis;
    const elements = pane(document);
    const state = {
      frames: CAROUSEL,
      selection: { format: 'feed', artwork: 'artwork-1' },
      zoom: 1 as const,
    };

    paintPreview(elements, state);
    let writes = 0;
    elements.frame.setAttribute = new Proxy(elements.frame.setAttribute, {
      apply(target, thisArgument, args: [string, string]) {
        if (args[0] === 'srcdoc') writes += 1;
        return Reflect.apply(target, thisArgument, args);
      },
    });

    paintPreview(elements, { ...state, zoom: 0.5 });
    expect(writes).toBe(0);
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
