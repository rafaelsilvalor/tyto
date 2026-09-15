import {
  type Dock,
  type Layout,
  type PanelRecord,
  DOCKS,
  ELASTIC_DOCK,
  clampSize,
  openPanelsOf,
} from '../../shared/layout.js';
import { type Locale } from '../../shared/i18n/index.js';
import { type DockedPanel } from './panels.js';

/**
 * The window, arranged from a record (E9.10, ADR 0024).
 *
 * `index.html` declares four empty docks and nothing else about where anything goes. This
 * module reads the layout, creates the element each open panel names, puts it in its dock,
 * and gives the docks their sizes. **Nothing in the markup says which panel lives where**,
 * which is the whole claim of this card — and it is what lets the next one add dragging by
 * changing values rather than structure.
 *
 * A closed panel's element is not created, and a panel that closes has its element removed.
 * That is the cheap half of ADR 0024's measurement: a repaint's cost scales with the size
 * of the whole document, so a panel nobody opened should not be in it.
 */

export const DOCK_ATTRIBUTE = 'data-dock';
export const SPLITTER_ATTRIBUTE = 'data-splitter';

/** What the dock needs from the app to build a panel and to report what a person did. */
export interface DockHost {
  readonly locale: Locale;
  readonly onClose: (panelId: string) => void;
  /** While the pointer is down. `settled` marks the drag's end, which is what persists. */
  readonly onResize: (panelId: string, size: number, settled: boolean) => void;
}

const dockElement = (root: ParentNode, dock: Dock): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[${DOCK_ATTRIBUTE}="${dock}"]`);

const splitterElement = (root: ParentNode, dock: Dock): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[${SPLITTER_ATTRIBUTE}="${dock}"]`);

/**
 * The panel a dock's splitter resizes, which is the first open one in it.
 *
 * A dock holds a list and a splitter moves one edge, so something has to say which panel's
 * `size` that edge is. The first is the honest answer while every dock holds one panel; the
 * card that stacks two in a dock is the card that has to decide what a shared edge means,
 * and it will have a second panel on screen to decide it against.
 */
const resizedPanelOf = (layout: Layout, dock: Dock): PanelRecord | undefined =>
  openPanelsOf(layout, dock)[0];

/**
 * Puts the window in the shape the record describes.
 *
 * Returns once every panel has rendered. That `await` is load-bearing rather than tidy:
 * `main.ts` looks its elements up by id straight afterwards, and a Lit element schedules its
 * first render on a microtask — so without it the lookups would run against a panel that is
 * in the document and still empty.
 */
export async function arrange(root: ParentNode, layout: Layout, host: DockHost): Promise<void> {
  const pending: Promise<unknown>[] = [];

  for (const dock of DOCKS) {
    const container = dockElement(root, dock);
    if (container === null) continue;

    const open = openPanelsOf(layout, dock);
    const wanted = new Set(open.map((panel) => panel.id));

    // Gone first, so a panel that closed is out of the document before anything is measured.
    for (const existing of [...container.children]) {
      const id = existing.getAttribute('data-panel');
      if (id === null || !wanted.has(id)) existing.remove();
    }

    for (const [index, panel] of open.entries()) {
      const element = ensurePanel(container, panel, index);
      element.locale = host.locale;
      element.panelId = panel.id;
      element.fixed = panel.fixed;
      element.onClose = host.onClose;
      pending.push(element.updateComplete);
    }

    applySize(container, dock, resizedPanelOf(layout, dock));

    const splitter = splitterElement(root, dock);
    // A dock with nothing in it takes up no room, and neither does the edge it would have
    // had. Hiding the panel and leaving a draggable 4px stripe behind it would be a control
    // for resizing nothing.
    if (splitter !== null) splitter.hidden = dock === ELASTIC_DOCK || open.length === 0;
  }

  await Promise.all(pending);
}

/** The element for `panel`, created if the dock does not already hold one. */
function ensurePanel(container: HTMLElement, panel: PanelRecord, index: number): DockedPanel {
  const existing = container.querySelector<DockedPanel>(`[data-panel="${panel.id}"]`);
  if (existing !== null) {
    // Moved rather than rebuilt when the order changed, which is what keeps a CodeMirror or
    // an iframe alive across a rearrangement.
    if (container.children[index] !== existing) {
      container.insertBefore(existing, container.children[index] ?? null);
    }
    return existing;
  }

  const created = container.ownerDocument.createElement(panel.element) as DockedPanel;
  created.setAttribute('data-panel', panel.id);
  created.className = 'panel';
  container.insertBefore(created, container.children[index] ?? null);
  return created;
}

/**
 * A dock's size along its own axis, or nothing at all when it is empty.
 *
 * `centre` never gets one: it is the remainder, which is the only answer that survives the
 * window being resized (`shared/layout.ts`).
 */
function applySize(container: HTMLElement, dock: Dock, panel: PanelRecord | undefined): void {
  container.hidden = panel === undefined;
  if (dock === ELASTIC_DOCK || panel === undefined) {
    container.style.removeProperty('width');
    container.style.removeProperty('height');
    return;
  }

  const size = `${String(clampSize(panel.size))}px`;
  if (dock === 'bottom') container.style.height = size;
  else container.style.width = size;
}

/**
 * Makes the splitters draggable, once.
 *
 * Pointer events and not mouse events, so a trackpad, a pen and a touch screen are the same
 * code path; and `setPointerCapture`, so a drag that leaves the 4px stripe — which every
 * drag does immediately — keeps arriving here instead of stopping the moment the pointer is
 * over the pane it is resizing.
 */
export function wireSplitters(root: ParentNode, layoutOf: () => Layout, host: DockHost): void {
  for (const dock of DOCKS) {
    if (dock === ELASTIC_DOCK) continue;
    const splitter = splitterElement(root, dock);
    const container = dockElement(root, dock);
    if (splitter === null || container === null) continue;

    splitter.addEventListener('pointerdown', (event: PointerEvent) => {
      const panel = resizedPanelOf(layoutOf(), dock);
      if (panel === undefined) return;

      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);

      const box = container.getBoundingClientRect();
      const from = dock === 'bottom' ? event.clientY : event.clientX;
      const start = dock === 'bottom' ? box.height : box.width;
      // `right` and `bottom` grow when the pointer moves towards the origin, because the
      // edge being dragged is the one facing into the window rather than away from it.
      const sign = dock === 'left' ? 1 : -1;

      const move = (moved: PointerEvent): void => {
        const now = dock === 'bottom' ? moved.clientY : moved.clientX;
        host.onResize(panel.id, clampSize(start + (now - from) * sign), false);
      };

      const up = (ended: PointerEvent): void => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        splitter.releasePointerCapture(ended.pointerId);
        const now = dock === 'bottom' ? ended.clientY : ended.clientX;
        // Persisted once, at the end. A write per pointermove would be sixty disk writes a
        // second to remember one number.
        host.onResize(panel.id, clampSize(start + (now - from) * sign), true);
      };

      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
  }
}
