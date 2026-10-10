import { z } from 'zod';

/**
 * Where the panels are, as data (E9.10, ADR 0024).
 *
 * The whole point of this file is that **nothing about the arrangement is written in the
 * markup**. `index.html` declares four empty docks and a status bar; which panel is in
 * which one, whether it is open and how wide it is, is the record below. That is what makes
 * closing a panel a value changing rather than a DOM surgery, and it is what the card after
 * this one needs in order to add dragging without touching a structure.
 *
 * In `shared/` and not in the renderer, because both halves need it: main validates what it
 * reads off the disk and the renderer arranges the window from it. Linted as pure, like
 * `ipc.ts` and `i18n/` — a layout is a value, and neither runtime may shape it.
 */

export const DOCKS = ['left', 'centre', 'right', 'bottom'] as const;
export type Dock = (typeof DOCKS)[number];

/**
 * The dock that takes whatever room the others leave, and therefore has no size of its own.
 *
 * One of the four is always the remainder — otherwise a window resize has no answer — and
 * `centre` is it. A record's `size` is ignored there rather than rejected, because a panel
 * that moves into the centre later should not need its size deleted on the way.
 */
export const ELASTIC_DOCK: Dock = 'centre';

export const panelRecordSchema = z.object({
  /** Stable across releases: it is the key this panel is remembered under. */
  id: z.string().min(1).max(100),
  /** The custom element the dock creates. Nothing else says where a panel's body lives. */
  element: z.string().min(1).max(100),
  dock: z.enum(DOCKS),
  open: z.boolean(),
  /**
   * Pixels along the dock's axis — width for `left` and `right`, height for `bottom`.
   *
   * **The schema checks the shape and `clampSize` checks the range**, deliberately split.
   * A bound here looks stricter and is worse: `min(80).max(4000)` makes one hand-edited
   * number fail the whole object, and `layoutFrom` then throws away every other panel's
   * position to punish it. The window is a different size on every machine and on every
   * restart, so a size out of range is something to bend, not something to refuse.
   */
  size: z.number().finite(),
  /**
   * A panel that may not be closed.
   *
   * One panel is, and the reason is honest rather than architectural: the editor holds the
   * only buffer in the app and closing its panel unmounts CodeMirror, which destroys the
   * text. E9.8 landed and there is somewhere to save it now, but nothing asks before
   * discarding and there is still no second tab to keep it in (E9.11). Reopening the panel
   * gives back an *empty* editor, which is the worst kind of recoverable.
   *
   * A field rather than a special case in the dock, precisely so that taking it off — when
   * tabs land, or when closing prompts — is an edit to a value.
   */
  fixed: z.boolean(),
});

export type PanelRecord = z.infer<typeof panelRecordSchema>;

/** The three docks a person can hide whole; `centre` is the remainder and never hides. */
export const HIDEABLE_DOCKS = ['left', 'right', 'bottom'] as const;
export type HideableDock = (typeof HIDEABLE_DOCKS)[number];

export const layoutSchema = z.object({
  panels: z.array(panelRecordSchema).max(50),
  /**
   * Docks hidden whole by the status bar's area buttons (TYTO-248, ADR 0076).
   *
   * A flag beside the panels and not `open: false` on each of them, because hiding an area
   * must give back what was in it: a dock with the queue and a plugin panel open comes back
   * with both. Optional, so every `layout.json` written before it still reads.
   */
  hiddenDocks: z.array(z.enum(HIDEABLE_DOCKS)).max(3).optional(),
});

export type Layout = z.infer<typeof layoutSchema>;

export const EDITOR_PANEL = 'editor';
export const PREVIEW_PANEL = 'preview';
export const PROBLEMS_PANEL = 'problems';
export const QUEUE_PANEL = 'queue';

/**
 * A plugin's panel (TYTO-49, ADR 0045): an id under this prefix, drawn by one element.
 *
 * The prefix is what lets a saved layout keep a plugin panel's place while the plugin is not
 * running yet — the build does not know it, but it knows the shape — and what keeps a plugin
 * from naming a panel `editor` and taking a built-in's record.
 */
export const PLUGIN_PANEL_PREFIX = 'plugin:';
export const PLUGIN_PANEL_ELEMENT = 'tyto-plugin-panel';

const isPluginPanel = (id: string): boolean => id.startsWith(PLUGIN_PANEL_PREFIX);

/**
 * The arrangement ADR 0024 settled, as the record the app starts from.
 *
 * Four panels and not the seven the ADR draws: the templates list, the file tree and the
 * logs do not exist yet. They join by being added here, which is the claim
 * this card is making — a new panel should be one entry and an element, with no change to
 * the dock, the CSS or the window.
 */
export const DEFAULT_LAYOUT: Layout = {
  panels: [
    {
      id: EDITOR_PANEL,
      element: 'tyto-editor-panel',
      dock: 'centre',
      open: true,
      size: 600,
      fixed: true,
    },
    {
      id: PREVIEW_PANEL,
      element: 'tyto-preview-panel',
      dock: 'right',
      open: true,
      size: 560,
      fixed: false,
    },
    {
      id: PROBLEMS_PANEL,
      element: 'tyto-problems-panel',
      dock: 'bottom',
      open: true,
      // Three rows and a heading. E9.3 sized this panel to its contents up to 30vh, found
      // by opening the window: a flat 168px made a clean brief reserve all of it to say
      // "nothing to report". A dock that a person can drag and that remembers where they
      // left it cannot also size itself, so the fix is a smaller default and a handle.
      size: 140,
      fixed: false,
    },
    {
      // TYTO-45. Closed until somebody asks for it: most people never point the window at a
      // queue folder, and a panel that opened empty on every launch would be a column of
      // "no folder chosen". In the left dock, which is otherwise empty, so opening it takes
      // room from nothing a person was already looking at. `layoutFrom` adds it, closed, to
      // a saved layout that predates it.
      id: QUEUE_PANEL,
      element: 'tyto-queue-panel',
      dock: 'left',
      open: false,
      size: 340,
      fixed: false,
    },
  ],
};

const SIZE_FLOOR = 80;
const SIZE_CEILING = 4000;

export const clampSize = (size: number): number =>
  Math.round(Math.max(SIZE_FLOOR, Math.min(SIZE_CEILING, size)));

/** The panel with that id, or nothing. Not an error: a command may name a panel nobody has. */
export const panelOf = (layout: Layout, id: string): PanelRecord | undefined =>
  layout.panels.find((panel) => panel.id === id);

/**
 * Every operation on a layout is a new layout, and every one of them is here.
 *
 * Pure and returning a fresh value, so the renderer's flow is the same for all three:
 * change the record, arrange the window from it, send it to main to remember. A mutation in
 * place would make "what is on screen" and "what is remembered" two things that have to be
 * kept in step.
 */
export function withPanelOpen(layout: Layout, id: string, open: boolean): Layout {
  const panels = layout.panels.map((panel) =>
    // A fixed panel refuses rather than throwing: the caller is a command, and a command
    // that cannot run is `false`, not an exception in a click handler.
    panel.id === id && !(panel.fixed && !open) ? { ...panel, open } : panel,
  );
  // Opening a panel in a hidden area shows the area (ADR 0076): a toggle that changed a
  // value nobody can see would be a command that does nothing.
  const dock = panelOf(layout, id)?.dock;
  const reveal = open && dock !== undefined && dockIsHidden(layout, dock);
  return reveal ? withHidden({ ...layout, panels }, dock, false) : { ...layout, panels };
}

export function withPanelSize(layout: Layout, id: string, size: number): Layout {
  return {
    ...layout,
    panels: layout.panels.map((panel) =>
      panel.id === id ? { ...panel, size: clampSize(size) } : panel,
    ),
  };
}

/** Panels of one dock, open ones only, in the order the record lists them. */
export const openPanelsOf = (layout: Layout, dock: Dock): readonly PanelRecord[] =>
  layout.panels.filter((panel) => panel.dock === dock && panel.open);

export const dockIsHidden = (layout: Layout, dock: Dock): boolean =>
  layout.hiddenDocks?.includes(dock as HideableDock) ?? false;

/** The panels a dock shows: none while it is hidden, its open ones otherwise. */
export const shownPanelsOf = (layout: Layout, dock: Dock): readonly PanelRecord[] =>
  dockIsHidden(layout, dock) ? [] : openPanelsOf(layout, dock);

/** Whether a dock is on screen, which is what its status-bar button shows as on. */
export const dockIsShown = (layout: Layout, dock: Dock): boolean =>
  shownPanelsOf(layout, dock).length > 0;

const withHidden = (layout: Layout, dock: Dock, hidden: boolean): Layout => {
  const others = (layout.hiddenDocks ?? []).filter((each) => each !== dock);
  const hiddenDocks = hidden ? [...others, dock as HideableDock] : others;
  return { ...layout, hiddenDocks };
};

/**
 * Hides or shows a whole area (TYTO-248, ADR 0076), the way VS Code's and Zed's do.
 *
 * Shown and holding something: hidden, with every panel's `open` left as it was. Otherwise
 * shown again — and a dock that would come back empty opens its first panel, because a
 * button that lit up over nothing would be a button that seemed broken. A dock no panel
 * lives in has nothing to show and is returned unchanged.
 */
export function withDockToggled(layout: Layout, dock: HideableDock): Layout {
  if (dockIsShown(layout, dock)) return withHidden(layout, dock, true);
  const shown = withHidden(layout, dock, false);
  if (openPanelsOf(shown, dock).length > 0) return shown;
  const first = shown.panels.find((panel) => panel.dock === dock);
  return first === undefined ? layout : withPanelOpen(shown, first.id, true);
}

/**
 * Whether a dock has anything in it, which is what decides if it takes up room.
 *
 * A dock with every panel closed collapses to nothing — no splitter, no border, no empty
 * rectangle where a panel used to be. That is the difference between closing a panel and
 * emptying it.
 */
export const dockIsOpen = (layout: Layout, dock: Dock): boolean =>
  openPanelsOf(layout, dock).length > 0;

/**
 * Reads a layout off whatever was on disk, falling back rather than failing.
 *
 * A layout is a convenience, never data a person typed: a file that has been hand-edited
 * into nonsense, or written by a version that knew different panels, must open a window
 * anyway. So a parse failure is the default layout and not a dialog.
 *
 * Panels are reconciled against the default rather than trusted wholesale — an entry for a
 * panel this build does not have is dropped, and a panel the file has never heard of is
 * added from the default. That is what makes a release that adds a panel show it to
 * somebody who already has a saved layout, which is the failure this would otherwise have
 * every time the app grows.
 */
export function layoutFrom(value: unknown): Layout {
  const parsed = layoutSchema.safeParse(value);
  const saved = parsed.success ? parsed.data.panels : [];

  // A plugin panel the file remembers is kept, element and all taken from this build, so its
  // place survives the seconds before the plugins have started. Whether its plugin still
  // offers it is `withPluginPanels`'s question, asked once they have.
  const plugins = saved
    .filter((panel) => isPluginPanel(panel.id))
    .map((panel) => ({
      ...panel,
      element: PLUGIN_PANEL_ELEMENT,
      fixed: false,
      size: clampSize(panel.size),
    }));

  const hiddenDocks = parsed.success ? parsed.data.hiddenDocks : undefined;
  return {
    panels: [...builtIns(saved), ...plugins],
    ...(hiddenDocks === undefined ? {} : { hiddenDocks }),
  };
}

function builtIns(saved: readonly PanelRecord[]): PanelRecord[] {
  return DEFAULT_LAYOUT.panels.map((fallback) => {
    const remembered = saved.find((panel) => panel.id === fallback.id);
    if (remembered === undefined) return fallback;
    // `element` and `fixed` come from this build and not from the file. They are code,
    // not preference: a saved layout naming an element that no longer exists would be a
    // dock creating an unknown tag and a panel that silently renders nothing.
    return {
      ...fallback,
      open: fallback.fixed ? true : remembered.open,
      size: clampSize(remembered.size),
      dock: remembered.dock,
    };
  });
}

/** A plugin's panel as the layout needs to know it: its id, and where it asked to dock. */
export interface OfferedPluginPanel {
  readonly id: string;
  readonly location?: 'left' | 'right' | 'bottom' | undefined;
}

/**
 * The layout, reconciled against the panels the installed plugins offer this session.
 *
 * **Closed by default**: a panel appears the first time as a command, not as a column that
 * opened itself — the person decides whether a third party's page gets room in the window.
 * A plugin panel nobody offers any more is dropped, so a removed plugin leaves no empty
 * record behind; one still offered keeps whatever the file remembered.
 */
export function withPluginPanels(layout: Layout, offered: readonly OfferedPluginPanel[]): Layout {
  const wanted = new Map(offered.map((panel) => [panel.id, panel]));
  const kept = layout.panels.filter((panel) => !isPluginPanel(panel.id) || wanted.has(panel.id));
  const known = new Set(kept.map((panel) => panel.id));
  const added = offered
    .filter((panel) => !known.has(panel.id))
    .map((panel): PanelRecord => ({
      id: panel.id,
      element: PLUGIN_PANEL_ELEMENT,
      dock: panel.location ?? 'right',
      open: false,
      size: panel.location === 'bottom' ? 200 : 320,
      fixed: false,
    }));
  return { ...layout, panels: [...kept, ...added].slice(0, 50) };
}
