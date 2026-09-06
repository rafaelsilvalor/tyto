import { type Matrix, identityMatrix, multiplyMatrix, transformMatrix } from './matrix.js';
import type { GroupNode, ImageNode, RectNode, SceneNode, TextNode, VectorNode } from './nodes.js';
import type { Size } from './primitives.js';
import type { Artwork, Frame, Scene } from './scene.js';

/**
 * The one traversal of the Scene IR (`docs/architecture.md`, Visitor).
 *
 * Every exporter is a `SceneVisitor`: `export-html` builds strings, `export-svg` builds
 * other strings, a future bounds pass builds rectangles. What none of them should build
 * again is the recursion, the transform composition and the opacity product — get any of
 * those subtly different between two exporters and the same scene renders two ways.
 *
 * A visitor never recurses itself. `walk()` does the descent and hands `group()` the
 * results its children already produced, which is what makes a visitor a fold over the
 * tree rather than a callback that has to remember where it is.
 */

/** Where the node being visited sits, and what it inherited on the way down. */
export interface VisitContext {
  readonly scene: Scene;
  readonly artwork: Artwork;
  readonly frame: Frame;
  /** `frame.format`, hoisted because a visitor asks for the format far more often. */
  readonly format: string;
  /** Outermost first, the node itself excluded. Only a group can be an ancestor. */
  readonly ancestors: readonly GroupNode[];
  /**
   * Node coordinates → frame coordinates, the node's *own* transform already applied.
   * A visitor that needs the parent's matrix instead reads it from `ancestors`.
   */
  readonly transform: Matrix;
  /** The product of every opacity from the frame down to and including this node. */
  readonly opacity: number;
  /**
   * False when this node or any ancestor is invisible.
   *
   * `walk()` visits it anyway. A hidden node is still a node an exporter may have to
   * render — the mask in `valid-promo.json` is `visible: false` and exists only to be
   * rendered into a `<mask>` — so the decision to skip belongs to the visitor that knows
   * why it is walking, not to the walk.
   */
  readonly visible: boolean;
}

/**
 * One method per node kind, dispatched on `kind` rather than on `instanceof`, which the
 * IR could not offer anyway: a parsed scene is plain data.
 */
export interface SceneVisitor<T> {
  /** `children` holds what the group's own children already returned, in order. */
  group(node: GroupNode, context: VisitContext, children: readonly T[]): T;
  rect(node: RectNode, context: VisitContext): T;
  text(node: TextNode, context: VisitContext): T;
  image(node: ImageNode, context: VisitContext): T;
  vector(node: VectorNode, context: VisitContext): T;
}

/** What one frame produced: an exporter turns this into one file. */
export interface FrameVisit<T> {
  readonly artwork: Artwork;
  readonly frame: Frame;
  /** One result per top-level node of the frame, in document order. */
  readonly children: readonly T[];
}

/** Everything a node inherits from its parent; `walk` turns it into a `VisitContext`. */
type Inherited = Omit<VisitContext, 'format'>;

/**
 * The box `Transform.anchor` is normalised against.
 *
 * A group has no box of its own and a text may leave a dimension to its content, so both
 * fall back to zero — their anchor is their origin. Resolving them properly means
 * measuring laid-out text, which the IR does not record and E4.5 is where it arrives.
 */
function anchorBox(node: SceneNode): Size {
  switch (node.kind) {
    case 'rect':
    case 'image':
    case 'vector':
      return node.size;
    case 'text':
      return { w: node.box.w ?? 0, h: node.box.h ?? 0 };
    case 'group':
      return { w: 0, h: 0 };
  }
}

function contextFor(node: SceneNode, inherited: Inherited): VisitContext {
  return {
    scene: inherited.scene,
    artwork: inherited.artwork,
    frame: inherited.frame,
    format: inherited.frame.format,
    ancestors: inherited.ancestors,
    transform: multiplyMatrix(
      inherited.transform,
      transformMatrix(node.transform, anchorBox(node)),
    ),
    opacity: inherited.opacity * node.opacity,
    visible: inherited.visible && node.visible,
  };
}

function visitNode<T>(node: SceneNode, visitor: SceneVisitor<T>, inherited: Inherited): T {
  const context = contextFor(node, inherited);

  switch (node.kind) {
    case 'group': {
      const forChildren: Inherited = {
        ...context,
        ancestors: [...context.ancestors, node],
      };
      const children = node.children.map((child) => visitNode(child, visitor, forChildren));
      return visitor.group(node, context, children);
    }
    case 'rect':
      return visitor.rect(node, context);
    case 'text':
      return visitor.text(node, context);
    case 'image':
      return visitor.image(node, context);
    case 'vector':
      return visitor.vector(node, context);
  }
}

/**
 * Walks one frame, for an exporter that already knows which frame it is rendering.
 *
 * The frame itself is not a visited node — it has no transform and no opacity, only a
 * size and a background — so the walk starts at identity with the frame's children.
 */
export function walkFrame<T>(
  scene: Scene,
  artwork: Artwork,
  frame: Frame,
  visitor: SceneVisitor<T>,
): readonly T[] {
  const root: Inherited = {
    scene,
    artwork,
    frame,
    ancestors: [],
    transform: identityMatrix,
    opacity: 1,
    visible: true,
  };
  return frame.children.map((child) => visitNode(child, visitor, root));
}

/** Every frame of every artwork, in document order. */
export function walk<T>(scene: Scene, visitor: SceneVisitor<T>): readonly FrameVisit<T>[] {
  return scene.artworks.flatMap((artwork) =>
    artwork.frames.map((frame) => ({
      artwork,
      frame,
      children: walkFrame(scene, artwork, frame, visitor),
    })),
  );
}
