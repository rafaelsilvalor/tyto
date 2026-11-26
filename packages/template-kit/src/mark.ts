import { type MarkShape, solid, vector } from '@tyto/core/template';

import { type Block, block } from './blocks.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

/**
 * A mark: a flat, single-colour icon held as geometry — the box its `d` was drawn in, and
 * the `d` itself. **No colour**: the fill is decided where the mark is placed
 * (`docs/template-conventions.md`, "Geometry in, colour out").
 *
 * Moved here from the weekly agenda's `parts.ts` by TYTO-185, and declared in `@tyto/core` since
 * TYTO-223, because a brand kit carries one and a template's context carries the kit (ADR
 * 0063). A local alias rather than a re-export, because tsup's declaration build
 * drops the `type` modifier of a re-export and the `.d.ts` would promise a value.
 */
export type Mark = MarkShape;

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
  const drawn = markIn(shape, { width: Infinity, height }, fill, {}, { name });
  return { width: drawn.width, height: drawn.height, draft: drawn.draft };
}

/** The numbers a mark uses (TYTO-891): its height when its area does not bound one. */
export const MARK_PARAMETERS = {
  height: {
    kind: 'length',
    default: 24,
    min: 0,
    description: "The mark's height, in px; absent, the area's height when it has one.",
  },
} as const satisfies ParameterSchema;

export type MarkParameters = ValuesOf<typeof MARK_PARAMETERS>;

/**
 * A mark in `area`, as tall as the given height, else the area's, else the default; as wide as
 * its box at that height. `overflow` is how far it runs past a bounded area's width.
 */
export function markIn(
  shape: Mark,
  area: Area,
  fill: string,
  given: Partial<MarkParameters> = {},
  options: { readonly name?: string } = {},
): Block & { readonly overflow: number } {
  const values = parameterValues(MARK_PARAMETERS, given);
  const height =
    given.height !== undefined || !Number.isFinite(area.height) ? values.height : area.height;
  const scale = height / shape.box.h;

  const width = shape.box.w * scale;
  return {
    ...block(
      width,
      height,
      vector({
        name: options.name ?? 'mark',
        geometry: { kind: 'path', d: shape.d, fillRule: shape.fillRule },
        size: shape.box,
        fill: solid(fill),
        transform: { scaleX: scale, scaleY: scale },
      }),
    ),
    overflow: Number.isFinite(area.width) ? Math.max(0, width - area.width) : 0,
  };
}
