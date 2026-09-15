// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LAYOUT,
  EDITOR_PANEL,
  PREVIEW_PANEL,
  PROBLEMS_PANEL,
  withPanelOpen,
  withPanelSize,
} from '../../shared/layout.js';
import { arrange } from './dock.js';
import './panels.js';

/**
 * The dock, arranging a document from a record (E9.10).
 *
 * jsdom lays nothing out, so how wide a dock *ends up* is the end-to-end suite's question.
 * What is here is everything about which elements exist and where — which is the whole of
 * what this module decides, and the part that used to be written in `index.html`.
 *
 * The assertion that earns the card is the last describe: a panel that closes is **gone
 * from the document**, not hidden. That is what keeps a repaint's cost flat as panels are
 * added, because the cost scales with the size of the whole document (ADR 0024).
 */

const DOCK_MARKUP = `
  <div class="work">
    <div data-dock="left"></div><div data-splitter="left"></div>
    <div data-dock="centre"></div>
    <div data-splitter="right"></div><div data-dock="right"></div>
  </div>
  <div data-splitter="bottom"></div><div data-dock="bottom"></div>
`;

const host = () => ({ locale: 'pt-BR' as const, onClose: vi.fn(), onResize: vi.fn() });

const panelsIn = (dock: string): string[] =>
  [...document.querySelectorAll(`[data-dock="${dock}"] [data-panel]`)].map(
    (node) => node.getAttribute('data-panel') ?? '',
  );

const dockOf = (dock: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-dock="${dock}"]`) as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = DOCK_MARKUP;
});

describe('building the window from the record', () => {
  it('creates the element each open panel names, in the dock it names', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(panelsIn('centre')).toEqual([EDITOR_PANEL]);
    expect(panelsIn('right')).toEqual([PREVIEW_PANEL]);
    expect(panelsIn('bottom')).toEqual([PROBLEMS_PANEL]);
    expect(panelsIn('left')).toEqual([]);
  });

  it('renders what is inside each panel, which is what everything else looks up', async () => {
    // `preview.ts` writes into `#preview-stage` and `main.ts` finds `#editor` by id. Those
    // ids used to be in `index.html`; they are in the panels now and nothing else changed.
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(document.getElementById('editor')).not.toBeNull();
    expect(document.getElementById('preview-stage')).not.toBeNull();
    expect(document.getElementById('problems-list')).not.toBeNull();
    expect(document.getElementById('template')).not.toBeNull();
  });

  it('gives each dock its size, and the elastic one none', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(dockOf('right').style.width).toBe('560px');
    expect(dockOf('bottom').style.height).toBe('140px');
    // The centre is the remainder, which is the only answer that survives a window resize.
    expect(dockOf('centre').style.width).toBe('');
    expect(dockOf('centre').style.height).toBe('');
  });

  it('hides a dock with nothing in it, and its splitter with it', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(dockOf('left').hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-splitter="left"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-splitter="right"]')?.hidden).toBe(false);
  });
});

describe('closing a panel', () => {
  it('removes its element rather than hiding it', async () => {
    // The claim ADR 0024's measurement rests on: a repaint walks the whole document, so a
    // panel nobody has open must not be in it.
    await arrange(document, DEFAULT_LAYOUT, host());
    expect(document.getElementById('preview-stage')).not.toBeNull();

    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PREVIEW_PANEL, false), host());

    expect(panelsIn('right')).toEqual([]);
    expect(document.getElementById('preview-stage')).toBeNull();
    expect(dockOf('right').hidden).toBe(true);
  });

  it('never built the element of a panel that started closed', async () => {
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false), host());

    expect(document.getElementById('problems-list')).toBeNull();
    expect(document.querySelectorAll('[data-panel]')).toHaveLength(2);
  });

  it('builds it again when it reopens', async () => {
    const closed = withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false);
    await arrange(document, closed, host());
    await arrange(document, withPanelOpen(closed, PROBLEMS_PANEL, true), host());

    expect(document.getElementById('problems-list')).not.toBeNull();
  });
});

describe('what survives a rearrangement', () => {
  it('keeps the node CodeMirror is mounted in', async () => {
    // The failure this prevents is silent and total: a rebuilt `#editor` is an editor with
    // no text in it and no way back. The editor panel is `fixed` so it is never removed,
    // and Lit keeps a node it did not have to change.
    await arrange(document, DEFAULT_LAYOUT, host());
    const before = document.getElementById('editor');

    await arrange(document, withPanelSize(DEFAULT_LAYOUT, PREVIEW_PANEL, 300), host());
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false), host());

    expect(document.getElementById('editor')).toBe(before);
  });

  it('gives no close button to a fixed panel', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    const editor = document.querySelector(`[data-panel="${EDITOR_PANEL}"]`);
    const preview = document.querySelector(`[data-panel="${PREVIEW_PANEL}"]`);
    expect(editor?.querySelector('.panel__close')).toBeNull();
    expect(preview?.querySelector('.panel__close')).not.toBeNull();
  });

  it('reports the panel a close button belongs to', async () => {
    const chrome = host();
    await arrange(document, DEFAULT_LAYOUT, chrome);

    document.querySelector<HTMLElement>(`[data-panel="${PROBLEMS_PANEL}"] .panel__close`)?.click();

    expect(chrome.onClose).toHaveBeenCalledWith(PROBLEMS_PANEL);
  });
});
