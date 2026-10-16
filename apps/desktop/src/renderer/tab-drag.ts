/**
 * Dragging a tab (TYTO-288, ADR 0083 amended): along its strip to reorder it, or onto another
 * group's strip to move it there.
 *
 * **Pointer events and not HTML5 drag and drop.** A native drag draws the OS's ghost image,
 * hands the drop to whatever is under it — CodeMirror's own drop handler inserts dragged text —
 * and cannot be told apart from a file dragged in from outside. The group splitter's pattern is
 * the one used instead (`group-splitter.ts`): one delegated `pointerdown` on the editor panel,
 * and pointer capture once a drag has begun.
 *
 * A press becomes a drag only after {@link DRAG_THRESHOLD} pixels of movement, so a click still
 * selects and a middle click still closes; the click that follows a drag is swallowed. While a
 * drag runs, the strip under the pointer is the target and the gap between its tabs nearest the
 * pointer is where the tab will land, drawn as an accent line. Letting go anywhere that is not a
 * group's strip, or pressing Escape, cancels: a drop on a group's body or edge would split it,
 * which is another card.
 */

/** How far a press must travel, in CSS pixels, before it is a drag rather than a click. */
export const DRAG_THRESHOLD = 4;

/**
 * The gap a tab lands in, given the horizontal midpoints of the strip's tabs in order: `0`
 * before the first, `midpoints.length` after the last. A pointer left of a tab's middle goes
 * before it, which is how every editor's strip answers.
 */
export function dropIndexAt(midpoints: readonly number[], x: number): number {
  let index = 0;
  for (const midpoint of midpoints) {
    if (x <= midpoint) break;
    index += 1;
  }
  return index;
}

export interface TabDragHost {
  /**
   * A drag ended on a strip: `tabId` let go in group `groupId`, before the tab `beforeTabId`, or
   * at the strip's end when that is `undefined`. Whether the move happens is the window's.
   */
  readonly onDrop: (tabId: string, groupId: string, beforeTabId: string | undefined) => void;
}

/** Where a drag would land now. */
interface DropTarget {
  readonly groupId: string;
  readonly strip: HTMLElement;
  readonly beforeTabId: string | undefined;
  /** Where the line goes, in viewport pixels: the gap's x and the strip's top and height. */
  readonly x: number;
  readonly top: number;
  readonly height: number;
}

const TAB = '.tabs__tab[data-tab-id]';
const GROUP = '[data-editor-group]';

const tabsOf = (strip: Element): HTMLElement[] => [...strip.querySelectorAll<HTMLElement>(TAB)];

/** The strip under a point, if it is an editor group's inside `container`, with the gap there. */
function targetAt(container: HTMLElement, x: number, y: number): DropTarget | undefined {
  const under = document.elementFromPoint(x, y);
  // The whole strip row counts, the empty part after the last tab and the actions included:
  // that is where "at the end" is let go.
  const row = under?.closest<HTMLElement>('.pane__strip');
  const group = row?.closest<HTMLElement>(GROUP);
  const strip = row?.querySelector<HTMLElement>('.tabs__strip');
  const groupId = group?.dataset['editorGroup'];
  if (row == null || group == null || strip == null || groupId === undefined) return undefined;
  if (!container.contains(group)) return undefined;

  const tabs = tabsOf(strip);
  const rects = tabs.map((tab) => tab.getBoundingClientRect());
  const index = dropIndexAt(
    rects.map((rect) => rect.left + rect.width / 2),
    x,
  );
  const bounds = strip.getBoundingClientRect();
  const gapX = rects[index]?.left ?? rects[rects.length - 1]?.right ?? bounds.left;
  return {
    groupId,
    strip,
    beforeTabId: tabs[index]?.dataset['tabId'],
    x: gapX,
    top: bounds.top,
    height: bounds.height,
  };
}

/** The accent line in the gap where the tab will land: one element, outside every Lit tree. */
function indicatorElement(): HTMLElement {
  const line = document.createElement('div');
  line.className = 'tabs__drop-line';
  line.hidden = true;
  line.setAttribute('aria-hidden', 'true');
  document.body.append(line);
  return line;
}

/**
 * Listens on the editor panel for a press on any tab in it, once: the strips come and go with
 * the tree, and a listener on the container survives every new layout. The document listeners
 * are registered here once too, and do nothing unless a press is under way.
 */
export function wireTabDrag(container: HTMLElement, host: TabDragHost): void {
  let press:
    | {
        readonly pointerId: number;
        readonly tab: HTMLElement;
        readonly tabId: string;
        readonly sourceGroupId: string;
        readonly startX: number;
        readonly startY: number;
        dragging: boolean;
        target: DropTarget | undefined;
      }
    | undefined;
  let swallowClick = false;
  let line: HTMLElement | undefined;

  const show = (target: DropTarget | undefined): void => {
    if (press === undefined) return;
    line ??= indicatorElement();
    for (const strip of container.querySelectorAll('.tabs__strip--drop')) {
      if (strip !== target?.strip) strip.classList.remove('tabs__strip--drop');
    }
    if (target === undefined) {
      line.hidden = true;
      return;
    }
    // Another group's strip is tinted, so the group the tab will join is plain at a glance.
    target.strip.classList.toggle('tabs__strip--drop', target.groupId !== press.sourceGroupId);
    line.hidden = false;
    line.style.left = `${String(target.x)}px`;
    line.style.top = `${String(target.top)}px`;
    line.style.height = `${String(target.height)}px`;
  };

  const end = (drop: boolean): void => {
    const ended = press;
    press = undefined;
    if (ended === undefined) return;
    if (ended.tab.hasPointerCapture(ended.pointerId)) {
      ended.tab.releasePointerCapture(ended.pointerId);
    }
    if (!ended.dragging) return;
    ended.tab.classList.remove('tabs__tab--dragging');
    for (const strip of container.querySelectorAll('.tabs__strip--drop')) {
      strip.classList.remove('tabs__strip--drop');
    }
    if (line !== undefined) line.hidden = true;
    // The click a released drag ends in is not a click on the tab under it.
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    const target = ended.target;
    if (drop && target !== undefined) host.onDrop(ended.tabId, target.groupId, target.beforeTabId);
  };

  container.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || press !== undefined) return;
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest<HTMLElement>(TAB);
    const tabId = tab?.dataset['tabId'];
    const sourceGroupId = tab?.closest<HTMLElement>(GROUP)?.dataset['editorGroup'];
    if (tab == null || tabId === undefined || sourceGroupId === undefined) return;
    press = {
      pointerId: event.pointerId,
      tab,
      tabId,
      sourceGroupId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      target: undefined,
    };
  });

  document.addEventListener('pointermove', (event: PointerEvent) => {
    if (press === undefined || event.pointerId !== press.pointerId) return;
    if (!press.dragging) {
      const travelled = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (travelled < DRAG_THRESHOLD) return;
      press.dragging = true;
      // Captured only now: captured from the press, the click a still pointer ends in would
      // land on the tab's box rather than on its name or close button.
      press.tab.setPointerCapture(event.pointerId);
      press.tab.classList.add('tabs__tab--dragging');
    }
    event.preventDefault();
    press.target = targetAt(container, event.clientX, event.clientY);
    show(press.target);
  });

  document.addEventListener('pointerup', (event: PointerEvent) => {
    if (press === undefined || event.pointerId !== press.pointerId) return;
    // Measured where the pointer let go, not where it last moved.
    if (press.dragging) press.target = targetAt(container, event.clientX, event.clientY);
    end(true);
  });

  document.addEventListener('pointercancel', (event: PointerEvent) => {
    if (press !== undefined && event.pointerId === press.pointerId) end(false);
  });

  // Capture phase, so Escape stops a drag before the window's dispatcher or vim hears it.
  document.addEventListener(
    'keydown',
    (event) => {
      if (press?.dragging !== true || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      end(false);
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
