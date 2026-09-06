import { applyMatrix } from './matrix.js';
import type { TextNode } from './nodes.js';
import type { Size } from './primitives.js';
import type { Artwork, Frame, Scene } from './scene.js';
import { type SceneVisitor, type VisitContext, walk, walkFrame } from './visitor.js';

/**
 * Where the artwork actually is: the axis-aligned box, in frame coordinates, that the
 * visible nodes occupy. `export-svg` needs it for a `viewBox`, a crop-to-content export
 * needs it, and E4.5 needs it to know whether a text still fits.
 *
 * These are **layout** bounds, not ink bounds. A stroke aligned `outside` paints half a
 * stroke width past the box, a shadow paints wherever its offset and blur put it, and
 * neither is counted here — both are computable from the node, and the visitor that wants
 * them wraps this one rather than making every caller pay for them.
 */

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /**
   * False when some node did not fully declare its own box: a text that left a dimension
   * to its content, or one whose `overflow` is `grow`. The real box is then *at least*
   * this large and never smaller, so a caller that must not clip pads or waits for E4.5,
   * which is where laid-out text gets measured.
   */
  readonly exact: boolean;
}

/** The smallest box containing every part. Absent parts contribute nothing. */
export function unionBounds(parts: readonly (Bounds | undefined)[]): Bounds | undefined {
  const present = parts.filter((part): part is Bounds => part !== undefined);
  if (present.length === 0) return undefined;

  return {
    minX: Math.min(...present.map((part) => part.minX)),
    minY: Math.min(...present.map((part) => part.minY)),
    maxX: Math.max(...present.map((part) => part.maxX)),
    maxY: Math.max(...present.map((part) => part.maxY)),
    // One inexact part makes the union inexact: it could still be growing outwards.
    exact: present.every((part) => part.exact),
  };
}

/**
 * A node's own box, mapped through its accumulated transform.
 *
 * All four corners are mapped and then bounded, rather than the two opposite ones: under
 * a rotation the corners of the result are not the images of the corners of the input.
 */
function boxBounds(size: Size, exact: boolean, context: VisitContext): Bounds | undefined {
  // A hidden node occupies nothing. `walk()` visits it anyway so that this decision is
  // made here, where the reason for walking is known.
  if (!context.visible) return undefined;

  const corners = [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ].map((corner) => applyMatrix(context.transform, corner));

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
    exact,
  };
}

/**
 * A text is the one node that can be larger than what it declares: an absent `box.w` or
 * `box.h` means "as large as the content needs", and `overflow: 'grow'` says so outright.
 */
function textBox(node: TextNode): { size: Size; exact: boolean } {
  return {
    size: { w: node.box.w ?? 0, h: node.box.h ?? 0 },
    exact: node.box.w !== undefined && node.box.h !== undefined && node.overflow !== 'grow',
  };
}

/**
 * The bounding-box visitor, exported so a caller can wrap it — to keep bounds per node
 * id, to add the ink a stroke or a shadow paints, or to stop treating hidden nodes as
 * empty. A group is the union of its children and nothing more: a group has no box.
 */
export const boundsVisitor: SceneVisitor<Bounds | undefined> = {
  group: (_node, _context, children) => unionBounds(children),
  rect: (node, context) => boxBounds(node.size, true, context),
  image: (node, context) => boxBounds(node.size, true, context),
  vector: (node, context) => boxBounds(node.size, true, context),
  text: (node, context) => {
    const { size, exact } = textBox(node);
    return boxBounds(size, exact, context);
  },
};

/** Everything visible in one frame. `undefined` when the frame draws nothing. */
export function frameBounds(scene: Scene, artwork: Artwork, frame: Frame): Bounds | undefined {
  return unionBounds(walkFrame(scene, artwork, frame, boundsVisitor));
}

export interface FrameBounds {
  readonly artwork: Artwork;
  readonly frame: Frame;
  readonly bounds: Bounds | undefined;
}

/** Every frame of every artwork, in document order — one walk rather than one per frame. */
export function sceneBounds(scene: Scene): readonly FrameBounds[] {
  return walk(scene, boundsVisitor).map(({ artwork, frame, children }) => ({
    artwork,
    frame,
    bounds: unionBounds(children),
  }));
}
