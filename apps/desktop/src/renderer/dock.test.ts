// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LAYOUT,
  EDITOR_PANEL,
  PROBLEMS_PANEL,
  withPanelOpen,
  withPanelSize,
} from '../../shared/layout.js';
import { arrange } from './dock.js';
import './panels.js';
// For the side effect: the queue panel's element, so the pane shape can be read off it.
import './queue-panel.js';

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
    // Empty since the preview became a tab (TYTO-287, ADR 0084).
    expect(panelsIn('right')).toEqual([]);
    expect(panelsIn('bottom')).toEqual([PROBLEMS_PANEL]);
    expect(panelsIn('left')).toEqual([]);
  });

  it('renders what is inside each panel, which is what everything else looks up', async () => {
    // `main.ts` lays the editor groups out in `[data-editor-groups]`, whose first pane is
    // `#editor` (TYTO-286), and the previews are tabs inside them (TYTO-287). Those nodes used
    // to be in `index.html`; they are in the panels now and nothing else changed.
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(document.querySelector('[data-editor-groups]')).not.toBeNull();
    expect(document.getElementById('problems-list')).not.toBeNull();
    // The template picker is no panel's since TYTO-288: `main.ts` makes it once and moves it
    // into the focused group's header row.
    expect(document.getElementById('template')).toBeNull();
  });

  it('gives each dock its size, and the elastic one none', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(dockOf('bottom').style.height).toBe('140px');
    // The centre is the remainder, which is the only answer that survives a window resize.
    expect(dockOf('centre').style.width).toBe('');
    expect(dockOf('centre').style.height).toBe('');
  });

  it('hides a dock with nothing in it, and its splitter with it', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(dockOf('left').hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-splitter="left"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-splitter="right"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-splitter="bottom"]')?.hidden).toBe(false);
  });
});

describe('closing a panel', () => {
  it('removes its element rather than hiding it', async () => {
    // The claim ADR 0024's measurement rests on: a repaint walks the whole document, so a
    // panel nobody has open must not be in it.
    await arrange(document, DEFAULT_LAYOUT, host());
    expect(document.getElementById('problems-list')).not.toBeNull();

    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false), host());

    expect(panelsIn('bottom')).toEqual([]);
    expect(document.getElementById('problems-list')).toBeNull();
    expect(dockOf('bottom').hidden).toBe(true);
  });

  it('never built the element of a panel that started closed', async () => {
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false), host());

    expect(document.getElementById('problems-list')).toBeNull();
    expect(document.querySelectorAll('[data-panel]')).toHaveLength(1);
  });

  it('builds it again when it reopens', async () => {
    const closed = withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false);
    await arrange(document, closed, host());
    await arrange(document, withPanelOpen(closed, PROBLEMS_PANEL, true), host());

    expect(document.getElementById('problems-list')).not.toBeNull();
  });
});

describe('what survives a rearrangement', () => {
  it('keeps the node the CodeMirror panes are mounted in', async () => {
    // The failure this prevents is silent and total: a rebuilt container is every editor
    // group gone, with no text in it and no way back. The editor panel is `fixed` so it is
    // never removed, and Lit keeps a node it did not have to change.
    await arrange(document, DEFAULT_LAYOUT, host());
    const before = document.querySelector('[data-editor-groups]');
    before?.append(document.createElement('tyto-editor-group'));

    await arrange(document, withPanelSize(DEFAULT_LAYOUT, PROBLEMS_PANEL, 300), host());
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false), host());

    expect(document.querySelector('[data-editor-groups]')).toBe(before);
    expect(before?.childElementCount).toBe(1);
  });

  it('draws every docked panel as a pane: a one-tab strip, then a header row (TYTO-288)', async () => {
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, 'queue', true), host());

    for (const id of [PROBLEMS_PANEL, 'queue']) {
      const panel = document.querySelector(`[data-panel="${id}"]`);
      const children = [...(panel?.children ?? [])].map((child) => child.className);
      // The header row is drawn even with nothing in it: it is what lines the panes up.
      expect(children.slice(0, 2), id).toEqual(['pane__strip', 'pane__header']);
    }
    // The problems heading keeps its id and its key, now as the tab's name.
    const heading = document.querySelector('.pane__strip #problems-heading');
    expect(heading?.getAttribute('data-i18n')).toBe('problems.heading');
    // The editor panel has no bar of its own any more: each group is a pane (ADR 0085).
    const editor = document.querySelector(`[data-panel="${EDITOR_PANEL}"]`);
    expect(editor?.querySelector('.pane__strip, #editor-heading, #template')).toBeNull();
  });

  it('gives no close button to a fixed panel', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    const editor = document.querySelector(`[data-panel="${EDITOR_PANEL}"]`);
    const problems = document.querySelector(`[data-panel="${PROBLEMS_PANEL}"]`);
    expect(editor?.querySelector('.panel__close')).toBeNull();
    expect(problems?.querySelector('.panel__close')).not.toBeNull();
  });

  it('reports the panel a close button belongs to', async () => {
    const chrome = host();
    await arrange(document, DEFAULT_LAYOUT, chrome);

    document.querySelector<HTMLElement>(`[data-panel="${PROBLEMS_PANEL}"] .panel__close`)?.click();

    expect(chrome.onClose).toHaveBeenCalledWith(PROBLEMS_PANEL);
  });
});
