import { describe, expect, it } from 'vitest';

import {
  type Layout,
  DEFAULT_LAYOUT,
  DOCKS,
  EDITOR_PANEL,
  ELASTIC_DOCK,
  PREVIEW_PANEL,
  PROBLEMS_PANEL,
  clampSize,
  dockIsOpen,
  layoutFrom,
  openPanelsOf,
  panelOf,
  withPanelOpen,
  withPanelSize,
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
        { id: 'queue', element: 'tyto-queue', dock: 'left', open: true, size: 200, fixed: false },
      ],
    });

    expect(panelOf(layout, 'queue')).toBeUndefined();
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
