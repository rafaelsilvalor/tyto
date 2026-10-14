import { type EditorGroups, type GroupNode, type GroupSplit, splitById } from './editor-groups.js';
import {
  type PairSize,
  equalShares,
  keyboardDelta,
  minimumOf,
  resizedShares,
  separatorBounds,
  separatorValue,
} from './group-resize.js';

/**
 * The line between two editor groups, as an element (TYTO-289, ADR 0083): dragged, it resizes
 * the pair either side of it; double-clicked, it gives every child of its split the same share;
 * focused, the arrow keys along its axis move it. The arithmetic is `group-resize.ts`'s.
 *
 * The docks' splitters (`dock.ts`) are the pattern: pointer capture, a hit area wider than the
 * hairline it draws, and an `onResize` whose `settled` flag is what is written down.
 */

/** On every splitter between groups, naming the split it divides; `data-index` says where. */
export const GROUP_SPLITTER_ATTRIBUTE = 'data-group-splitter';

export interface GroupSplitterHost {
  /** The groups as the window holds them now: what a drag starts from. */
  readonly groups: () => EditorGroups;
  /**
   * The split's new shares. Called on every pointer move with `settled` false — the window
   * shows them and keeps nothing — and once at the drag's end, a key or a double-click with
   * `settled` true, which is the one the window keeps and writes into the session.
   */
  readonly onResize: (splitId: string, sizes: readonly number[], settled: boolean) => void;
}

/** A new splitter between `split`'s children `index` and `index + 1`. */
export function splitterFor(split: GroupSplit, index: number): HTMLElement {
  const splitter = document.createElement('div');
  splitter.className = `group-splitter group-splitter--${split.direction}`;
  splitter.setAttribute(GROUP_SPLITTER_ATTRIBUTE, split.id);
  splitter.dataset['index'] = String(index);
  splitter.tabIndex = 0;
  splitter.setAttribute('role', 'separator');
  // A line between groups side by side runs up and down.
  splitter.setAttribute('aria-orientation', split.direction === 'row' ? 'vertical' : 'horizontal');
  splitter.setAttribute('aria-valuenow', String(separatorValue(split.sizes, index)));
  splitter.setAttribute('aria-valuemin', '0');
  splitter.setAttribute('aria-valuemax', '100');
  return splitter;
}

const isSplitter = (element: Element): boolean => element.hasAttribute(GROUP_SPLITTER_ATTRIBUTE);

/** A split box's children that are groups or nested splits, without the lines between them. */
const panesOf = (box: Element): HTMLElement[] =>
  [...box.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !isSplitter(child),
  );

const boxOf = (container: ParentNode, splitId: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-group-split="${splitId}"]`);

/** The two neighbours of a splitter, measured along its split's axis. */
function measurePair(box: HTMLElement, split: GroupSplit, index: number): PairSize {
  const children = panesOf(box);
  const along = (element: HTMLElement | undefined): number => {
    if (element === undefined) return 0;
    const rect = element.getBoundingClientRect();
    return split.direction === 'row' ? rect.width : rect.height;
  };
  return { before: along(children[index]), after: along(children[index + 1]) };
}

const minimumPair = (split: GroupSplit, index: number): PairSize => {
  const at = (child: GroupNode | undefined): number =>
    child === undefined ? 0 : minimumOf(child, split.direction);
  return { before: at(split.children[index]), after: at(split.children[index + 1]) };
};

/** Shows one split's shares: its children's grow factors and its splitters' values. */
function showSplit(box: HTMLElement, split: GroupSplit, sizes: readonly number[]): void {
  panesOf(box).forEach((child, index) => {
    child.style.flex = `${String(sizes[index] ?? 1)} 1 0`;
  });
  for (const splitter of box.children) {
    if (!isSplitter(splitter)) continue;
    const index = Number((splitter as HTMLElement).dataset['index']);
    const bounds = separatorBounds(measurePair(box, split, index), minimumPair(split, index));
    splitter.setAttribute('aria-valuenow', String(separatorValue(sizes, index)));
    splitter.setAttribute('aria-valuemin', String(bounds.min));
    splitter.setAttribute('aria-valuemax', String(bounds.max));
  }
}

/** Shows `sizes` on one split without touching the model: what a drag in progress paints. */
export function showShares(
  container: ParentNode,
  groups: EditorGroups,
  splitId: string,
  sizes: readonly number[],
): void {
  const split = splitById(groups, splitId);
  const box = boxOf(container, splitId);
  if (split !== undefined && box !== null) showSplit(box, split, sizes);
}

/**
 * Shows every split's shares from the model, after a resize settled. A change of shares alone
 * is this and not a new layout, so the splitter a person dragged or focused stays the element
 * it was. It measures, so it runs after a resize and never on an ordinary repaint.
 */
export function applyShares(container: ParentNode, groups: EditorGroups): void {
  const walk = (node: GroupNode): void => {
    if (node.kind === 'group') return;
    const box = boxOf(container, node.id);
    if (box !== null) showSplit(box, node, node.sizes);
    node.children.forEach(walk);
  };
  walk(groups.root);
}

/** The splitter an event came from, with its split and the pair it divides. */
function splitterOf(
  event: Event,
  host: GroupSplitterHost,
): { splitter: HTMLElement; split: GroupSplit; box: HTMLElement; index: number } | undefined {
  const target = event.target instanceof Element ? event.target : null;
  const splitter = target?.closest<HTMLElement>(`[${GROUP_SPLITTER_ATTRIBUTE}]`);
  if (splitter === null || splitter === undefined) return undefined;
  const split = splitById(host.groups(), splitter.getAttribute(GROUP_SPLITTER_ATTRIBUTE) ?? '');
  const box = splitter.parentElement;
  const index = Number(splitter.dataset['index']);
  if (split === undefined || box === null || !Number.isInteger(index)) return undefined;
  return { splitter, split, box, index };
}

/**
 * Listens on the editor panel for every splitter in it, once: the splitters come and go with
 * the tree, and a listener on the container survives every new layout.
 */
export function wireGroupSplitters(container: HTMLElement, host: GroupSplitterHost): void {
  container.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return;
    const found = splitterOf(event, host);
    if (found === undefined) return;
    const { splitter, split, box, index } = found;

    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add('group-splitter--dragging');
    const pair = measurePair(box, split, index);
    const minimum = minimumPair(split, index);
    const along = (pointer: PointerEvent): number =>
      split.direction === 'row' ? pointer.clientX : pointer.clientY;
    const from = along(event);
    const sharesAt = (pointer: PointerEvent): number[] =>
      resizedShares(split.sizes, index, pair, along(pointer) - from, minimum);

    const move = (moved: PointerEvent): void => {
      host.onResize(split.id, sharesAt(moved), false);
    };
    const up = (ended: PointerEvent): void => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      if (splitter.hasPointerCapture(ended.pointerId)) {
        splitter.releasePointerCapture(ended.pointerId);
      }
      splitter.classList.remove('group-splitter--dragging');
      // Kept once, at the end: a write per pointermove would be sixty a second for one number.
      host.onResize(split.id, sharesAt(ended), true);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });

  // The bounds are a measurement, so they are taken when somebody arrives at the line rather
  // than on every layout: a layout read per repaint would be a flush per keystroke.
  container.addEventListener('focusin', (event) => {
    const found = splitterOf(event, host);
    if (found !== undefined) showSplit(found.box, found.split, found.split.sizes);
  });

  container.addEventListener('dblclick', (event) => {
    const found = splitterOf(event, host);
    if (found === undefined) return;
    event.preventDefault();
    host.onResize(found.split.id, equalShares(found.split.children.length), true);
  });

  container.addEventListener('keydown', (event) => {
    const found = splitterOf(event, host);
    if (found === undefined || event.target !== found.splitter) return;
    const { split, box, index } = found;
    const delta = keyboardDelta(event.key, split.direction);
    if (delta === undefined) return;
    // The window's dispatcher and CodeMirror never see an arrow meant for the line.
    event.preventDefault();
    event.stopPropagation();
    const shares = resizedShares(
      split.sizes,
      index,
      measurePair(box, split, index),
      delta,
      minimumPair(split, index),
    );
    host.onResize(split.id, shares, true);
  });
}
