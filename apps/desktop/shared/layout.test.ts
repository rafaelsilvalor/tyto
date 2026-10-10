import { describe, expect, it } from 'vitest';

import {
  type Layout,
  DEFAULT_LAYOUT,
  DOCKS,
  EDITOR_PANEL,
  ELASTIC_DOCK,
  PREVIEW_PANEL,
  PLUGIN_PANEL_ELEMENT,
  PROBLEMS_PANEL,
  QUEUE_PANEL,
  clampSize,
  dockIsOpen,
  dockIsShown,
  shownPanelsOf,
  withDockToggled,
  layoutFrom,
  openPanelsOf,
  panelOf,
  withPanelOpen,
  withPanelSize,
  withPluginPanels,
} from './layout.js';

/**
 * The layout as a value (E9.10, ADR 0024).
 *
 * Every question about where a panel is can now be asked without a window, which is the
 * point of the card as much as its result: the dock is the only part that needs a DOM, and
 * it is the small part.
 *
 * The interesting half is {@link layoutFrom}. What comes off the disk is a person's
 * preference from a possibly older release, and the rule is that it can never stop the app
 * opening — so every test below that hands it nonsense is asking the same question: does a
 * window still come out of this.
 */

describe('the default arrangement', () => {
  it('is the one ADR 0024 draws', () => {
    expect(openPanelsOf(DEFAULT_LAYOUT, 'centre').map((panel) => panel.id)).toEqual([EDITOR_PANEL]);
    expect(openPanelsOf(DEFAULT_LAYOUT, 'right').map((panel) => panel.id)).toEqual([PREVIEW_PANEL]);
    expect(openPanelsOf(DEFAULT_LAYOUT, 'bottom').map((panel) => panel.id)).toEqual([
      PROBLEMS_PANEL,
    ]);
  });

  it('leaves the left dock declared and empty', () => {
    // The templates list and the file tree are their own cards. The dock exists so that
    // adding one is an entry in this record rather than a change to `index.html`.
    expect(openPanelsOf(DEFAULT_LAYOUT, 'left')).toEqual([]);
    expect(dockIsOpen(DEFAULT_LAYOUT, 'left')).toBe(false);
    expect(DOCKS).toContain('left');
  });

  it('holds the editor fixed and nothing else', () => {
    const fixed = DEFAULT_LAYOUT.panels.filter((panel) => panel.fixed).map((panel) => panel.id);

    expect(fixed).toEqual([EDITOR_PANEL]);
  });

  it('puts the elastic dock where the editor is', () => {
    // One dock has to be the remainder or a window resize has no answer, and it should be
    // the one holding the thing a person is looking at.
    expect(panelOf(DEFAULT_LAYOUT, EDITOR_PANEL)?.dock).toBe(ELASTIC_DOCK);
  });
});

describe('opening and closing', () => {
  it('closes a panel and leaves the others alone', () => {
    const next = withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false);

    expect(panelOf(next, PROBLEMS_PANEL)?.open).toBe(false);
    expect(panelOf(next, PREVIEW_PANEL)?.open).toBe(true);
    expect(dockIsOpen(next, 'bottom')).toBe(false);
  });

  it('refuses to close a fixed panel, rather than throwing', () => {
    // The caller is a command, and a command that cannot run is `false` — not an exception
    // inside a click handler.
    const next = withPanelOpen(DEFAULT_LAYOUT, EDITOR_PANEL, false);

    expect(panelOf(next, EDITOR_PANEL)?.open).toBe(true);
  });

  it('makes a new record rather than editing the one it was given', () => {
    // Every change is a new layout, so "what is on screen" and "what is remembered" cannot
    // drift into being two things kept in step by hand.
    const next = withPanelOpen(DEFAULT_LAYOUT, PROBLEMS_PANEL, false);

    expect(panelOf(DEFAULT_LAYOUT, PROBLEMS_PANEL)?.open).toBe(true);
    expect(next).not.toBe(DEFAULT_LAYOUT);
  });

  it('ignores an id no panel has', () => {
    expect(withPanelOpen(DEFAULT_LAYOUT, 'queue', false)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('resizing', () => {
  it('clamps rather than refusing, because a screen can shrink', () => {
    expect(clampSize(10)).toBe(80);
    expect(clampSize(99_999)).toBe(4000);
    expect(clampSize(240.6)).toBe(241);
  });

  it('clamps on the way into the record too', () => {
    expect(panelOf(withPanelSize(DEFAULT_LAYOUT, PREVIEW_PANEL, 4), PREVIEW_PANEL)?.size).toBe(80);
  });
});

describe('reading what was on the disk', () => {
  const saved = (over: Partial<Layout['panels'][number]>): unknown => ({
    panels: [{ ...DEFAULT_LAYOUT.panels[1], ...over }],
  });

  it('is the default for anything that is not a layout', () => {
    for (const nonsense of [undefined, null, 42, 'layout', {}, { panels: 'no' }]) {
      expect(layoutFrom(nonsense)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('keeps what a person chose', () => {
    const layout = layoutFrom(saved({ open: false, size: 300 }));

    expect(panelOf(layout, PREVIEW_PANEL)?.open).toBe(false);
    expect(panelOf(layout, PREVIEW_PANEL)?.size).toBe(300);
  });

  it('adds a panel the saved file has never heard of', () => {
    // The failure this prevents: a release that adds a panel showing it to nobody who
    // already had a layout, which is everybody who has used the app before.
    const layout = layoutFrom(saved({}));

    expect(layout.panels.map((panel) => panel.id).sort()).toEqual(
      DEFAULT_LAYOUT.panels.map((panel) => panel.id).sort(),
    );
  });

  it('drops a panel this build no longer has', () => {
    const layout = layoutFrom({
      panels: [
        ...DEFAULT_LAYOUT.panels,
        // `logs` and not `queue`, which this test used until TYTO-45 made the queue a panel
        // this build does have.
        { id: 'logs', element: 'tyto-logs', dock: 'left', open: true, size: 200, fixed: false },
      ],
    });

    expect(panelOf(layout, 'logs')).toBeUndefined();
  });

  it('adds the queue, closed, to a layout saved before the queue existed', () => {
    // TYTO-45. Every `layout.json` on a machine today was written by a build with three
    // panels. It must still parse, and it must not open a column nobody asked for.
    const beforeTheQueue = {
      panels: DEFAULT_LAYOUT.panels
        .filter((panel) => panel.id !== QUEUE_PANEL)
        .map((panel) => ({ ...panel, size: panel.size + 3 })),
    };

    const layout = layoutFrom(beforeTheQueue);

    expect(panelOf(layout, QUEUE_PANEL)).toMatchObject({
      element: 'tyto-queue-panel',
      dock: 'left',
      open: false,
    });
    // And what the file did say is kept: the other three are where they were left.
    expect(panelOf(layout, PROBLEMS_PANEL)?.size).toBe(143);
  });

  it('takes the element name from this build and never from the file', () => {
    // A saved layout naming an element that no longer exists would be a dock creating an
    // unknown tag and a panel that silently renders nothing. `element` is code.
    const layout = layoutFrom(saved({ element: 'tyto-something-else' }));

    expect(panelOf(layout, PREVIEW_PANEL)?.element).toBe('tyto-preview-panel');
  });

  it('takes `fixed` from this build too, so a file cannot close the editor', () => {
    const layout = layoutFrom({
      panels: [{ ...DEFAULT_LAYOUT.panels[0], fixed: false, open: false }],
    });

    expect(panelOf(layout, EDITOR_PANEL)?.fixed).toBe(true);
    expect(panelOf(layout, EDITOR_PANEL)?.open).toBe(true);
  });

  it('clamps a size a person hand-edited past the end of the world', () => {
    expect(panelOf(layoutFrom(saved({ size: 99_999 })), PREVIEW_PANEL)?.size).toBe(4000);
  });
});

describe('a plugin’s panels (TYTO-49)', () => {
  const offered = [{ id: 'plugin:demo/contagem', location: 'bottom' as const }];

  it('adds an offered panel closed, in the dock it asked for', () => {
    const next = withPluginPanels(DEFAULT_LAYOUT, offered);
    expect(panelOf(next, 'plugin:demo/contagem')).toEqual({
      id: 'plugin:demo/contagem',
      element: PLUGIN_PANEL_ELEMENT,
      dock: 'bottom',
      open: false,
      size: 200,
      fixed: false,
    });
    // The built-ins are untouched.
    expect(next.panels.slice(0, DEFAULT_LAYOUT.panels.length)).toEqual(DEFAULT_LAYOUT.panels);
  });

  it('keeps a remembered plugin panel through a restart, element taken from this build', () => {
    const saved = {
      panels: [
        ...DEFAULT_LAYOUT.panels,
        {
          id: 'plugin:demo/contagem',
          element: 'script-kiddie',
          dock: 'left',
          open: true,
          size: 9_000,
          fixed: true,
        },
      ],
    };
    const read = layoutFrom(saved);
    expect(panelOf(read, 'plugin:demo/contagem')).toMatchObject({
      element: PLUGIN_PANEL_ELEMENT,
      dock: 'left',
      open: true,
      size: 4000,
      fixed: false,
    });
    // Still offered, so kept as remembered rather than reset to closed.
    expect(panelOf(withPluginPanels(read, offered), 'plugin:demo/contagem')?.open).toBe(true);
  });

  it('drops a plugin panel nobody offers any more', () => {
    const withPanel = withPluginPanels(DEFAULT_LAYOUT, offered);
    expect(panelOf(withPluginPanels(withPanel, []), 'plugin:demo/contagem')).toBeUndefined();
  });

  it('still reads a layout.json written before plugin panels existed', () => {
    const old = {
      panels: DEFAULT_LAYOUT.panels.map(({ id, element, dock, open, size, fixed }) => ({
        id,
        element,
        dock,
        open,
        size,
        fixed,
      })),
    };
    expect(layoutFrom(old)).toEqual(DEFAULT_LAYOUT);
  });

  it('never lets a plugin take a built-in’s record', () => {
    const next = withPluginPanels(DEFAULT_LAYOUT, [{ id: 'editor' }]);
    expect(next.panels.filter((panel) => panel.id === 'editor')).toHaveLength(1);
    expect(panelOf(next, 'editor')?.element).toBe('tyto-editor-panel');
  });
});

describe('hiding a whole area (TYTO-248, ADR 0076)', () => {
  it('hides a shown area and gives back exactly what was in it', () => {
    const hidden = withDockToggled(DEFAULT_LAYOUT, 'bottom');

    expect(dockIsShown(hidden, 'bottom')).toBe(false);
    expect(shownPanelsOf(hidden, 'bottom')).toEqual([]);
    // The panel's own record is untouched: the area hid, the panel did not close.
    expect(panelOf(hidden, PROBLEMS_PANEL)?.open).toBe(true);

    const back = withDockToggled(hidden, 'bottom');
    expect(shownPanelsOf(back, 'bottom').map((panel) => panel.id)).toEqual([PROBLEMS_PANEL]);
  });

  it('keeps a plugin panel and the queue together when their area comes back', () => {
    const both = withPanelOpen(
      withPluginPanels(withPanelOpen(DEFAULT_LAYOUT, QUEUE_PANEL, true), [
        { id: 'plugin:demo', location: 'left' },
      ]),
      'plugin:demo',
      true,
    );
    const round = withDockToggled(withDockToggled(both, 'left'), 'left');

    expect(shownPanelsOf(round, 'left').map((panel) => panel.id)).toEqual([
      QUEUE_PANEL,
      'plugin:demo',
    ]);
  });

  it('opens the first panel of an empty area rather than lighting up nothing', () => {
    // The left area is empty by default: the queue lives there, closed.
    const shown = withDockToggled(DEFAULT_LAYOUT, 'left');

    expect(dockIsShown(shown, 'left')).toBe(true);
    expect(panelOf(shown, QUEUE_PANEL)?.open).toBe(true);
  });

  it('does nothing for an area no panel lives in', () => {
    const noLeft: Layout = {
      panels: DEFAULT_LAYOUT.panels.filter((panel) => panel.dock !== 'left'),
    };
    expect(withDockToggled(noLeft, 'left')).toBe(noLeft);
  });

  it('shows the area again when a panel in it is opened', () => {
    const hidden = withDockToggled(DEFAULT_LAYOUT, 'bottom');
    const reopened = withPanelOpen(
      withPanelOpen(hidden, PROBLEMS_PANEL, false),
      PROBLEMS_PANEL,
      true,
    );

    expect(dockIsShown(reopened, 'bottom')).toBe(true);
  });

  it('is remembered by layout.json and read back, and an older file still reads', () => {
    const hidden = withDockToggled(DEFAULT_LAYOUT, 'right');

    expect(layoutFrom(JSON.parse(JSON.stringify(hidden))).hiddenDocks).toEqual(['right']);
    expect(layoutFrom({ panels: DEFAULT_LAYOUT.panels }).hiddenDocks).toBeUndefined();
    // A hand-edited `centre` is refused with the rest of the file rather than hiding the editor.
    expect(layoutFrom({ ...hidden, hiddenDocks: ['centre'] }).hiddenDocks).toBeUndefined();
  });
});
