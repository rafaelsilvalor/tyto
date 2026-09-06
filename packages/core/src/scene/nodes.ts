import { z } from 'zod';

import {
  type BlendMode,
  type Effect,
  type MaskRef,
  type Transform,
  assetRefSchema,
  blendModeSchema,
  effectSchema,
  fitSchema,
  fontRefSchema,
  identityTransform,
  maskRefSchema,
  paintSchema,
  sizeSchema,
  strokeSchema,
  transformSchema,
  unitPointSchema,
} from './primitives.js';

/**
 * The drawable nodes (docs/ir-schema.md).
 *
 * `kind` is the discriminant the spec left implicit. Naming it is what lets Zod report
 * "expected one of group, rect, text, image, vector" instead of walking every branch of
 * an untagged union and reporting all of them, and what lets `SceneVisitor` (E2.2)
 * dispatch without instanceof.
 */

const baseShape = {
  id: z.string().min(1),
  name: z.string().optional(),
  transform: transformSchema.default(identityTransform),
  opacity: z.number().min(0).max(1).default(1),
  blend: blendModeSchema.default('normal'),
  visible: z.boolean().default(true),
  mask: maskRefSchema.optional(),
  clip: z.boolean().default(false),
  effects: z.array(effectSchema).default([]),
};

export const textAlignSchema = z.enum(['left', 'center', 'right', 'justify']);
export type TextAlign = z.infer<typeof textAlignSchema>;

export const textVerticalAlignSchema = z.enum(['top', 'middle', 'bottom']);
export type TextVerticalAlign = z.infer<typeof textVerticalAlignSchema>;

/**
 * What to do when the text does not fit: cut it, shrink it to fit, or let the box grow.
 * `shrink` is what E4.5 measures against; the IR only records the intent.
 */
export const textOverflowSchema = z.enum(['clip', 'shrink', 'grow']);
export type TextOverflow = z.infer<typeof textOverflowSchema>;

export const textRunSchema = z.strictObject({
  text: z.string(),
  font: fontRefSchema,
  size: z.number().finite().positive(),
  /** CSS weights, 100..900 in steps of 100. */
  weight: z
    .number()
    .int()
    .min(100)
    .max(900)
    .refine((value) => value % 100 === 0, { message: 'weight must be a multiple of 100' }),
  style: z.enum(['normal', 'italic']),
  color: paintSchema,
  decoration: z.enum(['underline', 'line-through']).optional(),
});
export type TextRun = z.infer<typeof textRunSchema>;

/**
 * `svg` and `path` are the two shapes the spec gives a Vector, tagged so that an exporter
 * cannot mistake one for the other. `markup` is expected to be sanitized before it
 * reaches the IR; the schema cannot verify that and does not pretend to.
 */
export const vectorGeometrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('svg'), markup: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('path'),
    d: z.string().min(1),
    fillRule: z.enum(['nonzero', 'evenodd']).default('nonzero'),
  }),
]);
export type VectorGeometry = z.infer<typeof vectorGeometrySchema>;

export const rectNodeSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('rect'),
  size: sizeSchema,
  /** Corner radii in `[topLeft, topRight, bottomRight, bottomLeft]` order, like CSS. */
  radius: z.tuple([
    z.number().finite().nonnegative(),
    z.number().finite().nonnegative(),
    z.number().finite().nonnegative(),
    z.number().finite().nonnegative(),
  ]),
  fill: paintSchema.optional(),
  stroke: strokeSchema.optional(),
});
export type RectNode = z.infer<typeof rectNodeSchema>;

export const textNodeSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('text'),
  /** An absent dimension means "as large as the content needs". */
  box: z.strictObject({
    w: z.number().finite().nonnegative().optional(),
    h: z.number().finite().nonnegative().optional(),
  }),
  /**
   * Emptiness is left to `invariants.ts`: a shape error would report a path like
   * `artworks.0.frames.0.children.2.runs`, and the author needs the node id.
   */
  runs: z.array(textRunSchema),
  align: textAlignSchema,
  valign: textVerticalAlignSchema,
  /** A multiplier of the run's font size, so resizing the text keeps the leading. */
  lineHeight: z.number().finite().positive(),
  letterSpacing: z.number().finite().default(0),
  overflow: textOverflowSchema,
});
export type TextNode = z.infer<typeof textNodeSchema>;

export const imageNodeSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('image'),
  asset: assetRefSchema,
  size: sizeSchema,
  fit: fitSchema,
  /** Focal point kept in frame when `fit` crops. */
  position: unitPointSchema.default({ x: 0.5, y: 0.5 }),
});
export type ImageNode = z.infer<typeof imageNodeSchema>;

export const vectorNodeSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('vector'),
  geometry: vectorGeometrySchema,
  size: sizeSchema,
  fill: paintSchema.optional(),
  stroke: strokeSchema.optional(),
});
export type VectorNode = z.infer<typeof vectorNodeSchema>;

/**
 * A group holds nodes, so its schema refers to itself. Zod defers the recursion through a
 * getter and TypeScript needs the type written out once, because inference cannot close
 * the loop on its own.
 */
export interface GroupNode {
  readonly id: string;
  readonly name?: string | undefined;
  readonly kind: 'group';
  readonly transform: Transform;
  readonly opacity: number;
  readonly blend: BlendMode;
  readonly visible: boolean;
  readonly mask?: MaskRef | undefined;
  readonly clip: boolean;
  readonly effects: Effect[];
  readonly children: SceneNode[];
}

export type SceneNode = GroupNode | RectNode | TextNode | ImageNode | VectorNode;

export const groupNodeSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('group'),
  // The annotation is what breaks the inference cycle between the group and the union.
  get children(): z.ZodArray<z.ZodType<SceneNode>> {
    return z.array(sceneNodeSchema);
  },
});

export const sceneNodeSchema: z.ZodType<SceneNode> = z.discriminatedUnion('kind', [
  groupNodeSchema,
  rectNodeSchema,
  textNodeSchema,
  imageNodeSchema,
  vectorNodeSchema,
]);
