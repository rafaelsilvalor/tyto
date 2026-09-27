import { solid, vector } from '@tyto/core/template';

import { type Block, block } from './blocks.js';

/**
 * A mark: a flat, single-colour icon held as geometry — the box its `d` was drawn in, and
 * the `d` itself. **No colour**: the fill is decided where the mark is placed, which is what
 * lets the same owl be blue on paper and white on a dark panel without a second copy
 * (`docs/template-conventions.md`, "Geometry in, colour out").
 *
 * Moved here from `agenda-semana/parts.ts` by TYTO-185: the geometry belongs to a brand,
 * drawing it at a height does not.
 */
export interface Mark {
  readonly box: { readonly w: number; readonly h: number };
  readonly d: string;
  /**
   * `evenodd` when the shape has holes punched by inner subpaths.
   *
   * Winding order would do it under `nonzero`, but a hole that depends on the direction a
   * subpath happens to run is a hole that closes the first time somebody redraws it.
   */
  readonly fillRule: 'nonzero' | 'evenodd';
}

/**
 * A mark drawn at a chosen height, in a chosen colour.
 *
 * **`size` is the box the `d` was drawn in, not the size it appears at.** A path vector's
 * `size` is its viewport: `export-html` emits `<svg width=size.w viewBox="0 0 size.w
 * size.h">`, so geometry outside that box is clipped, and `export-svg` emits the `d` raw
 * into the node's own transform. Passing the *drawn* size here clips a 120-unit owl at 77
 * units, which is a silhouette with its right side sliced off and no diagnostic anywhere.
 *
 * The scale is therefore a transform, which composes as translate-then-scale about an
 * anchor of `(0, 0)` (`packages/core/src/scene/matrix.ts`) — so the coordinate a caller
 * placed the block at stays exactly where they put it.
 */
export function mark(shape: Mark, height: number, fill: string, name: string): Block {
  const scale = height / shape.box.h;

  return block(
    shape.box.w * scale,
    height,
    vector({
      name,
      geometry: { kind: 'path', d: shape.d, fillRule: shape.fillRule },
      size: shape.box,
      fill: solid(fill),
      transform: { scaleX: scale, scaleY: scale },
    }),
  );
}
