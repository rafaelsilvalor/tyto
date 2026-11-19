import { GAP_COLOR } from './gap.js';
import type { ImageNode, RectNode, SceneNode } from './nodes.js';
import {
  type AssetRef,
  type Paint,
  type Size,
  type Stroke,
  identityTransform,
} from './primitives.js';
import type { Frame } from './scene.js';

/**
 * What a slot drawn outside Tyto shows while its file does not exist yet (ADR 0220).
 *
 * A slot whose manifest declares `external` is art somebody paints in another program, at a
 * size the manifest states per format. Until that file is there, `resolve` hands the template
 * a placeholder ref in its place, the template places it as it would place the picture, and
 * `compile` swaps every node that draws the placeholder for an outlined empty box. The box
 * keeps the template's own position, size and stacking, so the run shows where the art goes,
 * and it is a plain rect, so every exporter draws it as it is. Never a silent blank.
 *
 * Magenta like the gap marker (ADR 0035), because it is the same message: something the
 * artwork needs is not there.
 */

const PLACEHOLDER_PREFIX = 'external-art:';

/**
 * The ref `resolve` hands a template for an external slot with no file (ADR 0220). Its `size`
 * is set by `compile` for each format, from the manifest's declaration, since one ref cannot
 * hold two formats' sizes and a template sizes a picture by its ref (ADR 0158).
 */
export function externalArtPlaceholder(slot: string): AssetRef {
  return {
    id: `${PLACEHOLDER_PREFIX}${slot}`,
    source: 'inline',
    hash: `${PLACEHOLDER_PREFIX}${slot}`,
  };
}

/** Whether `asset` is a placeholder for missing external art rather than a picture. */
export function isExternalArtPlaceholder(asset: AssetRef): boolean {
  return (
    asset.source === 'inline' && asset.path === undefined && asset.id.startsWith(PLACEHOLDER_PREFIX)
  );
}

/** The slot a placeholder stands for, or `undefined` for any other ref. */
export function externalArtSlotOf(asset: AssetRef): string | undefined {
  return isExternalArtPlaceholder(asset) ? asset.id.slice(PLACEHOLDER_PREFIX.length) : undefined;
}

/** The box's outline: thinner than the gap stamp, which marks a whole frame. */
function outline(size: Size): Stroke {
  return {
    paint: { kind: 'solid', color: GAP_COLOR },
    width: Math.max(2, Math.round(Math.min(size.w, size.h) / 120)),
    align: 'inside',
  };
}

function placeholderOf(paint: Paint | undefined): string | undefined {
  return paint?.kind === 'image' ? externalArtSlotOf(paint.asset) : undefined;
}

/** The box that takes an image node's place: same id, transform, size, opacity and mask. */
function boxOf(node: ImageNode, slot: string): RectNode {
  const { asset: _asset, fit: _fit, position: _position, kind: _kind, ...shared } = node;
  return {
    ...shared,
    name: `${PLACEHOLDER_PREFIX}${slot}`,
    kind: 'rect',
    radius: [0, 0, 0, 0],
    stroke: outline(node.size),
  };
}

function swapNodes(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.map((node): SceneNode => {
    switch (node.kind) {
      case 'group':
        return { ...node, children: swapNodes(node.children) };
      case 'image': {
        const slot = externalArtSlotOf(node.asset);
        return slot === undefined ? node : boxOf(node, slot);
      }
      case 'rect':
      case 'vector': {
        // A placeholder used as a paint: the paint goes, the shape stays, outlined.
        const slot = placeholderOf(node.fill) ?? placeholderOf(node.stroke?.paint);
        if (slot === undefined) return node;
        const { fill: _fill, stroke: _stroke, ...rest } = node;
        return { ...rest, name: `${PLACEHOLDER_PREFIX}${slot}`, stroke: outline(node.size) };
      }
      default:
        return node;
    }
  });
}

/**
 * `frame` with every placeholder of missing external art drawn as an outlined empty box
 * (ADR 0220). A frame background painted with one becomes a box the size of the frame, under
 * everything the template drew. A frame with no placeholder comes back unchanged.
 */
export function withExternalArtBoxes(frame: Frame, idPrefix: string): Frame {
  const children = swapNodes(frame.children);
  const slot = placeholderOf(frame.background);
  if (slot === undefined) return { ...frame, children };
  const { background: _background, ...rest } = frame;
  const box: RectNode = {
    id: `${idPrefix}.external-art-${slot}`,
    name: `${PLACEHOLDER_PREFIX}${slot}`,
    kind: 'rect',
    transform: identityTransform,
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    size: frame.size,
    radius: [0, 0, 0, 0],
    stroke: outline(frame.size),
  };
  return { ...rest, children: [box, ...children] };
}
