import { z } from 'zod';

/**
 * What a frame says about itself when it is a guide for art painted outside Tyto (ADR 0220).
 *
 * `compile(..., { guide: true })` runs the one layout path every render runs and then tells
 * the exporter that writes a layered file (PR4 of TYTO-740) how to cut the frame into
 * layers: which of the frame's own nodes go where, and which are locked, hidden or faded. It
 * is metadata over nodes the frame already holds, so every other exporter draws a guide
 * frame as it draws any frame, and a frame compiled without `guide` has no such field.
 *
 * A later pull request (ADR 0221) rasterises each layer into the Scene; the field it adds to
 * a layer is that pull request's, not this one's.
 */

/** Top to bottom, the order a layered file stacks them in (ADR 0220). */
export const GUIDE_LAYER_NAMES = ['texto', 'areas', 'arte', 'decoracao'] as const;
export type GuideLayerName = (typeof GUIDE_LAYER_NAMES)[number];

/** A box in frame coordinates: where the art goes. */
export const guideBoxSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});
export type GuideBox = z.infer<typeof guideBoxSchema>;

export const guideArtSchema = z.strictObject({
  /** The manifest slot the art is painted for. */
  slot: z.string().min(1),
  kind: z.enum(['full', 'inline']),
  box: guideBoxSchema,
});
export type GuideArt = z.infer<typeof guideArtSchema>;

export const guideLayerSchema = z.strictObject({
  name: z.enum(GUIDE_LAYER_NAMES),
  /**
   * What the layered file calls the layer: the name, except an `inline` canvas's `arte`,
   * which carries the width it is painted at (`arte 920px`), as ADR 0220 says.
   */
  label: z.string().min(1),
  /**
   * Ids of the frame's top-level children, in paint order (bottom first). Every top-level
   * child is in exactly one layer; `parseScene` refuses a guide where one is not.
   */
  nodes: z.array(z.string().min(1)),
  locked: z.boolean(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
});
export type GuideLayer = z.infer<typeof guideLayerSchema>;

export const frameGuideSchema = z.strictObject({
  /** The art this frame is a guide for; absent when the template declares none. */
  art: guideArtSchema.optional(),
  /** Top to bottom. */
  layers: z.array(guideLayerSchema),
});
export type FrameGuide = z.infer<typeof frameGuideSchema>;
