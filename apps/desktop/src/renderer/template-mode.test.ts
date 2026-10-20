// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type IpcRequest, type IpcResponse } from '../../shared/ipc.js';
import {
  type OpenedTemplate,
  type TemplateMode,
  type TemplateModePorts,
  type TemplateFrame,
  TEMPLATE_MODE_TAG,
  artworksIn,
  cellScale,
  noticeFor,
} from './template-mode.js';

/**
 * The template mode's element in jsdom (TYTO-44).
 *
 * What is asserted here is what the element decides by itself: when it is unsaved, what a
 * refused save leaves behind, and when closing asks. The drawing, the save that reaches the disk
 * and the brief behind redrawn are `e2e/template-mode.desktop.test.ts`, because jsdom does no
 * layout and has no main process.
 */

const MANIFEST =
  'name: cartaz\nversion: 1.0.0\nformats: [feed]\nslots:\n  titulo: { type: rich-text }\n';
const MARKUP = '<frame format="feed" bg="#000000" />\n';

const opened = (
  over: Partial<Extract<OpenedTemplate, { kind: 'markup' }>> = {},
): OpenedTemplate => ({
  kind: 'markup',
  directory: '/t/cartaz',
  manifest: MANIFEST,
  markup: MARKUP,
  examples: [{ name: 'cartaz.brief', path: '/t/cartaz/examples/cartaz.brief', text: '' }],
  ...over,
});

interface Recorded {
  saves: IpcRequest<'template:save'>[];
  confirms: number;
  savedAnswers: IpcResponse<'template:save'>[];
  changes: number;
  /** Each folder New reported as made, in order. */
  created: string[];
}

function ports(
  answer: Partial<IpcResponse<'template:save'>> = {},
  confirm = false,
  template: OpenedTemplate = opened(),
  made: IpcResponse<'template:new'> = { directory: null },
): TemplateModePorts & { recorded: Recorded } {
  const recorded: Recorded = { saves: [], confirms: 0, savedAnswers: [], changes: 0, created: [] };
  return {
    recorded,
    open: () => Promise.resolve(template),
    preview: (request) =>
      Promise.resolve({ requestId: request.requestId, frames: [], diagnostics: [] }),
    save: (request) => {
      recorded.saves.push(request);
      return Promise.resolve({ saved: true, registered: true, diagnostics: [], ...answer });
    },
    create: () => Promise.resolve(made),
    confirmDiscard: () => {
      recorded.confirms += 1;
      return Promise.resolve(confirm);
    },
    saved: (saved) => {
      recorded.savedAnswers.push(saved);
    },
    created: (directory) => {
      recorded.created.push(directory);
    },
    changed: () => {
      recorded.changes += 1;
    },
  };
}

async function mode(given: TemplateModePorts): Promise<TemplateMode> {
  const element = document.createElement(TEMPLATE_MODE_TAG);
  element.ports = given;
  document.body.append(element);
  await element.updateComplete;
  await element.openFolder('/t/cartaz');
  await element.updateComplete;
  return element;
}

/**
 * jsdom does not implement `Range.getClientRects`, which CodeMirror's measuring pass calls —
 * the hole `panel.test.ts` fills, filled the same way and for its reason.
 */
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () => {
    const rects: DOMRect[] = [];
    return Object.assign(rects, { item: () => null }) as unknown as DOMRectList;
  };
}

/** Types into a buffer the way a person does, through the view and not `setValue`. */
function type(element: TemplateMode, buffer: 'manifest' | 'markup', text: string): void {
  const view = element.editorOf(buffer)?.view;
  if (view === undefined) throw new Error(`no ${buffer} buffer`);
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the pieces', () => {
  it('shrinks a frame to its cell and never enlarges one', () => {
    expect(cellScale({ width: 1080, height: 1920 }, { width: 300, height: 300 })).toBeCloseTo(
      300 / 1920,
    );
    expect(cellScale({ width: 100, height: 100 }, { width: 300, height: 300 })).toBe(1);
  });

  it('lists each artwork once, in the order it was drawn', () => {
    const frame = (artwork: string, format: string) => ({
      artwork,
      format,
      width: 1,
      height: 1,
      html: '',
    });
    expect(
      artworksIn([frame('slide-1', 'feed'), frame('slide-1', 'story'), frame('slide-2', 'feed')]),
    ).toEqual(['slide-1', 'slide-2']);
  });

  it('says a save outside the searched folders is not a registration', () => {
    const answer = { saved: true, registered: false, diagnostics: [] };
    expect(noticeFor(answer)).toBe('unregistered');
    expect(noticeFor({ ...answer, registered: true })).toBe('saved');
    expect(noticeFor({ ...answer, saved: false })).toBe('refused');
  });
});

describe('<tyto-template-mode>', () => {
  it('opens clean, and is unsaved exactly while a buffer differs from the file', async () => {
    const element = await mode(ports());
    expect(element.unsaved).toBe(false);

    type(element, 'markup', '<!-- x -->');
    expect(element.isDirty('markup')).toBe(true);
    expect(element.isDirty('manifest')).toBe(false);
    expect(element.unsaved).toBe(true);
  });

  it('draws indent guides in both buffers, and follows the indentGuides setting (TYTO-293)', async () => {
    const layers = (element: TemplateMode): readonly boolean[] =>
      (['manifest', 'markup'] as const).map(
        (buffer) =>
          (element.editorOf(buffer)?.view.dom.querySelector('.cm-indent-guides') ?? null) !== null,
      );
    const element = await mode(ports());
    expect(layers(element)).toEqual([true, true]);
    element.showIndentGuides(false);
    expect(layers(element)).toEqual([false, false]);

    // A mode told before its buffers exist makes them without.
    const later = document.createElement(TEMPLATE_MODE_TAG);
    later.ports = ports();
    later.showIndentGuides(false);
    document.body.append(later);
    await later.updateComplete;
    await later.openFolder('/t/cartaz');
    await later.updateComplete;
    expect(layers(later)).toEqual([false, false]);
  });

  it('is clean again after a save, and hands the answer on', async () => {
    const given = ports();
    const element = await mode(given);
    type(element, 'markup', '<!-- x -->');

    expect(await element.save()).toBe(true);

    expect(given.recorded.saves).toEqual([
      { directory: '/t/cartaz', manifest: MANIFEST, markup: `${MARKUP}<!-- x -->` },
    ]);
    expect(element.unsaved).toBe(false);
    expect(given.recorded.savedAnswers).toHaveLength(1);
  });

  it('stays unsaved after a refused save, shows why, and tells nobody', async () => {
    const refusal = {
      severity: 'error' as const,
      code: 'E_MANIFEST_SHAPE',
      message: 'slots must be a mapping',
      file: 'manifest' as const,
    };
    const given = ports({ saved: false, registered: false, diagnostics: [refusal] });
    const element = await mode(given);
    type(element, 'manifest', 'slots: [nope]\n');

    expect(await element.save()).toBe(false);
    await element.updateComplete;

    expect(element.unsaved).toBe(true);
    expect(element.notice).toBe('refused');
    expect(given.recorded.savedAnswers).toEqual([]);
    const row = element.querySelector('.template-mode__problem-row[data-file="manifest"]');
    expect(row?.getAttribute('data-code')).toBe('E_MANIFEST_SHAPE');
  });

  it('closes without asking when there is nothing to lose', async () => {
    const given = ports();
    const element = await mode(given);

    expect(await element.close()).toBe(true);
    expect(given.recorded.confirms).toBe(0);
    expect(element.open).toBe(false);
  });

  it('asks before closing over unsaved work, and stays when told to', async () => {
    const given = ports({}, false);
    const element = await mode(given);
    type(element, 'markup', '<!-- x -->');

    expect(await element.close()).toBe(false);
    expect(given.recorded.confirms).toBe(1);
    expect(element.open).toBe(true);
  });

  it('drops the drafts when a close is confirmed, so nothing waits in a hidden view', async () => {
    const given = ports({}, true);
    const element = await mode(given);
    type(element, 'markup', '<!-- x -->');

    expect(await element.close()).toBe(true);

    expect(given.recorded.confirms).toBe(1);
    expect(element.open).toBe(false);
    expect(element.unsaved).toBe(false);
    expect(element.textOf('markup')).toBe(MARKUP);
  });

  it('shows a code template as one sentence and no buffers', async () => {
    const element = await mode(ports({}, false, { kind: 'code', directory: '/t/codigo' }));

    expect(element.querySelector('[data-testid="template-refusal"]')?.textContent).toContain(
      'template.ts',
    );
    expect(element.querySelector('.template-mode__work')?.hasAttribute('hidden')).toBe(true);
    expect(element.unsaved).toBe(false);
  });
});

describe('New tells the window the folder changed (TYTO-324)', () => {
  it('reports the folder it made before opening it, so the list need not wait for a Save', async () => {
    const given = ports({}, false, opened({ directory: '/t/first-card' }), {
      directory: '/t/first-card',
    });
    const element = document.createElement(TEMPLATE_MODE_TAG);
    element.ports = given;
    document.body.append(element);
    await element.updateComplete;

    expect(await element.create(' first-card ')).toBe(true);

    expect(given.recorded.created).toEqual(['/t/first-card']);
    expect(given.recorded.savedAnswers).toEqual([]);
    expect(element.open).toBe(true);
  });

  it('reports nothing when the scaffold was refused', async () => {
    const given = ports({}, false, opened(), { directory: null, problem: 'exists' });
    const element = document.createElement(TEMPLATE_MODE_TAG);
    element.ports = given;
    document.body.append(element);
    await element.updateComplete;

    expect(await element.create('cartaz')).toBe(false);

    expect(given.recorded.created).toEqual([]);
    expect(element.problem?.key).toBe('templateMode.new.problem.exists');
  });
});

describe('the grid shows one srcdoc navigation at a time (TYTO-220)', () => {
  // TYTO-219's race, measured on this grid too: a fresh cell whose sample changed before its
  // first `load` kept the first sample, in 20 of 20 runs. jsdom fires its own `load` for a
  // fresh iframe's `about:blank` a task after insertion, and never one for a `srcdoc` document,
  // so its event is stopped before it reaches the rule and each test fires `load` where
  // Chromium would.

  const ours = new WeakSet<Event>();

  const frame = (format: string, text: string): TemplateFrame => ({
    artwork: 'slide-1',
    format,
    width: 1080,
    height: 1080,
    html: `<p>${format} ${text}</p>`,
  });

  /** A mode whose previews answer with whatever `answer.frames` holds when they are asked. */
  async function gridMode(): Promise<{
    element: TemplateMode;
    answer: { frames: TemplateFrame[] };
  }> {
    const answer: { frames: TemplateFrame[] } = { frames: [] };
    const element = await mode({
      ...ports(),
      preview: (request) =>
        Promise.resolve({ requestId: request.requestId, frames: answer.frames, diagnostics: [] }),
    });
    element.addEventListener(
      'load',
      (event) => {
        if (!ours.has(event)) event.stopImmediatePropagation();
      },
      true,
    );
    // The refresh `openFolder` schedules, out of the way before a test drives its own.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
    return { element, answer };
  }

  async function show(
    element: TemplateMode,
    answer: { frames: TemplateFrame[] },
    frames: TemplateFrame[],
  ): Promise<HTMLIFrameElement[]> {
    answer.frames = frames;
    await element.refresh();
    await element.updateComplete;
    return [...element.querySelectorAll<HTMLIFrameElement>('.template-mode__frame')];
  }

  /** Counts `srcdoc` writes from here on, which is the number of navigations asked for. */
  function writesTo(iframe: HTMLIFrameElement): string[] {
    const writes: string[] = [];
    const write = iframe.setAttribute.bind(iframe);
    iframe.setAttribute = (name: string, value: string) => {
      if (name === 'srcdoc') writes.push(value);
      write(name, value);
    };
    return writes;
  }

  const loaded = (iframe: HTMLIFrameElement): void => {
    const event = new Event('load');
    ours.add(event);
    iframe.dispatchEvent(event);
  };

  it('keeps a fresh cell on its first sample until load, then applies the newest', async () => {
    const { element, answer } = await gridMode();
    const [cell] = await show(element, answer, [frame('feed', 'first')]);
    if (cell === undefined) throw new Error('no cell');
    expect(cell.getAttribute('srcdoc')).toBe('<p>feed first</p>');
    const writes = writesTo(cell);

    await show(element, answer, [frame('feed', 'second')]);
    await show(element, answer, [frame('feed', 'third')]);
    expect(writes).toEqual([]);
    expect(cell.getAttribute('srcdoc')).toBe('<p>feed first</p>');

    loaded(cell);
    expect(writes).toEqual(['<p>feed third</p>']);
    loaded(cell);
    expect(writes).toEqual(['<p>feed third</p>']);
  });

  it('writes nothing to a cell the grid dropped while it loaded', async () => {
    const { element, answer } = await gridMode();
    const [, story] = await show(element, answer, [
      frame('feed', 'first'),
      frame('story', 'first'),
    ]);
    if (story === undefined) throw new Error('no story cell');
    // A newer story is waiting on that cell's load when the grid shrinks under it.
    await show(element, answer, [frame('feed', 'second'), frame('story', 'second')]);
    const writes = writesTo(story);

    const left = await show(element, answer, [frame('feed', 'third')]);
    expect(left).toHaveLength(1);
    expect(story.isConnected).toBe(false);

    loaded(story);
    expect(writes).toEqual([]);
    expect(story.getAttribute('srcdoc')).toBe('<p>story first</p>');
  });

  it('holds a cell the grid grew by to the same rule as the first', async () => {
    const { element, answer } = await gridMode();
    const [feed] = await show(element, answer, [frame('feed', 'first')]);
    if (feed === undefined) throw new Error('no cell');
    loaded(feed);

    const [, story] = await show(element, answer, [
      frame('feed', 'second'),
      frame('story', 'second'),
    ]);
    if (story === undefined) throw new Error('no new cell');
    expect(story.getAttribute('srcdoc')).toBe('<p>story second</p>');
    const writes = writesTo(story);

    await show(element, answer, [frame('feed', 'third'), frame('story', 'third')]);
    expect(writes).toEqual([]);
    expect(story.getAttribute('srcdoc')).toBe('<p>story second</p>');

    loaded(story);
    expect(story.getAttribute('srcdoc')).toBe('<p>story third</p>');
  });
});

describe('the template mode in the session (TYTO-266)', () => {
  it('is nothing to keep before it opens, and after it closes', async () => {
    const element = document.createElement(TEMPLATE_MODE_TAG);
    element.ports = ports();
    document.body.append(element);
    await element.updateComplete;
    expect(element.snapshot()).toBeNull();

    await element.openFolder('/t/cartaz');
    expect(element.snapshot()).toEqual({ visible: 'markup', manifest: null, markup: null });

    await element.close();
    expect(element.snapshot()).toBeNull();
  });

  it('hands over each unsaved buffer as its text and the text it differs from', async () => {
    const given = ports();
    const element = await mode(given);
    const before = given.recorded.changes;
    type(element, 'markup', '<!-- x -->');

    expect(element.snapshot()).toEqual({
      visible: 'markup',
      manifest: null,
      markup: { text: `${MARKUP}<!-- x -->`, savedText: MARKUP },
    });
    // A keystroke is a change the session has to hear about.
    expect(given.recorded.changes).toBeGreaterThan(before);
  });

  it('restores over the folder as read now: drafts in the views, unsaved, the file as saved', async () => {
    const element = document.createElement(TEMPLATE_MODE_TAG);
    element.ports = ports();
    document.body.append(element);
    await element.updateComplete;
    const folder = opened();
    if (folder.kind !== 'markup') throw new Error('a markup folder');

    element.restore(folder, { manifest: `${MANIFEST}# meu\n` }, 'manifest');
    await element.updateComplete;

    expect(element.open).toBe(true);
    expect(element.visible).toBe('manifest');
    expect(element.textOf('manifest')).toBe(`${MANIFEST}# meu\n`);
    expect(element.isDirty('manifest')).toBe(true);
    expect(element.isDirty('markup')).toBe(false);
    expect(element.snapshot()?.manifest).toEqual({
      text: `${MANIFEST}# meu\n`,
      savedText: MANIFEST,
    });
  });
});
