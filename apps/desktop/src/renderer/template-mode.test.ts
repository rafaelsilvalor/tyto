// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type IpcRequest, type IpcResponse } from '../../shared/ipc.js';
import {
  type OpenedTemplate,
  type TemplateMode,
  type TemplateModePorts,
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
}

function ports(
  answer: Partial<IpcResponse<'template:save'>> = {},
  confirm = false,
  template: OpenedTemplate = opened(),
): TemplateModePorts & { recorded: Recorded } {
  const recorded: Recorded = { saves: [], confirms: 0, savedAnswers: [] };
  return {
    recorded,
    open: () => Promise.resolve(template),
    preview: (request) =>
      Promise.resolve({ requestId: request.requestId, frames: [], diagnostics: [] }),
    save: (request) => {
      recorded.saves.push(request);
      return Promise.resolve({ saved: true, registered: true, diagnostics: [], ...answer });
    },
    create: () => Promise.resolve({ directory: null }),
    confirmDiscard: () => {
      recorded.confirms += 1;
      return Promise.resolve(confirm);
    },
    saved: (saved) => {
      recorded.savedAnswers.push(saved);
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

  it('shows a code template as one sentence and no buffers', async () => {
    const element = await mode(ports({}, false, { kind: 'code', directory: '/t/codigo' }));

    expect(element.querySelector('[data-testid="template-refusal"]')?.textContent).toContain(
      'template.ts',
    );
    expect(element.querySelector('.template-mode__work')?.hasAttribute('hidden')).toBe(true);
    expect(element.unsaved).toBe(false);
  });
});
