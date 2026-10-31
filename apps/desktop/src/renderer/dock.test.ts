// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMANDS_PANEL,
  DEFAULT_LAYOUT,
  EDITOR_PANEL,
  PROBLEMS_PANEL,
  withPanelInFront,
  withPanelOpen,
  withPanelSize,
} from '../../shared/layout.js';
import { arrange, paintStrips } from './dock.js';
import { type DockedPanel } from './panels.js';
// For the side effect: the command panel's element, a tab of the bottom area.
import './command-panel.js';
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

const host = () => ({
  locale: 'pt-BR' as const,
  onClose: vi.fn(),
  onResize: vi.fn(),
  tab: (panelId: string) => ({ label: panelId }),
  onPick: vi.fn(),
  onHide: vi.fn(),
});

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

  it('lets a dock give way down to the smaller of its size and the floor (TYTO-299)', async () => {
    await arrange(document, DEFAULT_LAYOUT, host());

    expect(dockOf('bottom').style.minHeight).toBe('min(140px, var(--tyto-dock-min-height))');
    expect(dockOf('centre').style.minWidth).toBe('');
    // A dock that empties forgets its floor along with its size.
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false), host());
    expect(dockOf('bottom').style.minHeight).toBe('');
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

  it('draws every docked panel with a tool header, not a tab, and no header row (TYTO-302)', async () => {
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, 'queue', true), host());

    // A side area's tool: the bottom area draws tabs instead (ADR 0163, below).
    for (const id of ['queue']) {
      const panel = document.querySelector(`[data-panel="${id}"]`);
      const children = [...(panel?.children ?? [])].map((child) => child.className);
      // A tool is not a document: its strip is a tool header (ADR 0090), and it has no header
      // row, since a tool has no breadcrumb (ADR 0085).
      expect(children[0], id).toBe('pane__strip pane__strip--tool');
      expect(panel?.querySelector(':scope > .pane__strip > .tool__title'), id).not.toBeNull();
      expect(panel?.querySelector('.pane__tab, .tabs__tab'), id).toBeNull();
      expect(panel?.querySelector(':scope > .pane__header'), id).toBeNull();
    }
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
    await arrange(document, withPanelOpen(DEFAULT_LAYOUT, 'queue', true), chrome);

    document.querySelector<HTMLElement>('[data-panel="queue"] .panel__close')?.click();

    expect(chrome.onClose).toHaveBeenCalledWith('queue');
  });
});

/** ADR 0163: the bottom area is one strip of tabs, one panel shown, as in VS Code. */
describe('the bottom area’s tabs', () => {
  const both = withPanelOpen(DEFAULT_LAYOUT, COMMANDS_PANEL, true);
  const tabs = () =>
    [...document.querySelectorAll<HTMLElement>('[data-dock="bottom"] [role="tab"]')].map(
      (tab) => `${tab.dataset['tab'] ?? ''}:${tab.getAttribute('aria-selected') ?? ''}`,
    );

  it('shows only the tab in front, and names every open panel as a tab', async () => {
    await arrange(document, both, host());

    expect(panelsIn('bottom')).toEqual([COMMANDS_PANEL]);
    expect(tabs()).toEqual([`${PROBLEMS_PANEL}:false`, `${COMMANDS_PANEL}:true`]);
    expect(document.querySelector('[data-dock="bottom"] .tool__title')).toBeNull();
  });

  it('draws the count the host gives a tab, and none for zero', async () => {
    const chrome = {
      ...host(),
      tab: (panelId: string) => ({ label: panelId, count: panelId === PROBLEMS_PANEL ? 3 : 0 }),
    };
    await arrange(document, both, chrome);

    const counts = [...document.querySelectorAll('[data-dock="bottom"] .dock-tab__count')];
    expect(counts.map((count) => count.textContent)).toEqual(['3']);
  });

  it('picks a tab on a click and on an arrow, and hides the area on ×', async () => {
    const chrome = host();
    await arrange(document, both, chrome);

    document.querySelector<HTMLElement>(`[data-tab="${PROBLEMS_PANEL}"]`)?.click();
    document
      .querySelector<HTMLElement>(`[data-tab="${COMMANDS_PANEL}"]`)
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.querySelector<HTMLElement>('[data-dock="bottom"] .panel__close')?.click();

    expect(chrome.onPick.mock.calls).toEqual([[PROBLEMS_PANEL], [PROBLEMS_PANEL]]);
    expect(chrome.onHide).toHaveBeenCalledWith('bottom');
    expect(chrome.onClose).not.toHaveBeenCalled();
  });

  it('keeps one height whichever tab is in front: the tallest open one', async () => {
    await arrange(document, both, host());
    expect(dockOf('bottom').style.height).toBe('240px');

    await arrange(document, withPanelInFront(both, PROBLEMS_PANEL), host());
    expect(dockOf('bottom').style.height).toBe('240px');
  });

  it('hands a strip over again only when what it shows changed', async () => {
    let count = 1;
    const chrome = { ...host(), tab: (panelId: string) => ({ label: panelId, count }) };
    await arrange(document, both, chrome);
    const element = document.querySelector<DockedPanel>(`[data-panel="${COMMANDS_PANEL}"]`)!;
    const first = element.strip;

    paintStrips(document, both, chrome);
    expect(element.strip).toBe(first);

    count = 2;
    paintStrips(document, both, chrome);
    expect(element.strip).not.toBe(first);
  });

  it('still stacks the panels of a side area', async () => {
    const left = withPanelOpen(withPanelOpen(DEFAULT_LAYOUT, 'queue', true), 'explorer', true);
    await arrange(document, left, host());

    expect(panelsIn('left')).toEqual(['explorer', 'queue']);
    expect(document.querySelector('[data-dock="left"] [role="tab"]')).toBeNull();
  });
});
