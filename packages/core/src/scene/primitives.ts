import { z } from 'zod';

/**
 * The leaf vocabulary of the Scene IR (docs/ir-schema.md, ADR 0003).
 *
 * Everything here is `strictObject`: an unknown key is an error, not something to strip.
 * The IR is the single source of truth for the artwork, so a misspelled property has to
 * be reported to whoever wrote the template rather than silently dropped on the way to
 * an exporter that would then render something the author did not ask for.
 *
 * Fields the spec lists as required but that almost always take the same value carry a
 * `.default()`. Input may omit them; the parsed scene always has them, so an exporter
 * never writes `?? 'normal'`.
 */

/** 0..1, the unit the IR uses for opacity, gradient offsets and normalised positions. */
const unitInterval = z.number().min(0).max(1);

const finite = z.number().finite();

const nonNegative = z.number().finite().nonnegative();

export const sizeSchema = z.strictObject({ w: nonNegative, h: nonNegative });
export type Size = z.infer<typeof sizeSchema>;

/** A normalised point inside a box: (0,0) top-left, (1,1) bottom-right. */
export const unitPointSchema = z.strictObject({ x: unitInterval, y: unitInterval });
export type UnitPoint = z.infer<typeof unitPointSchema>;

/**
 * Colour is structured rather than a CSS string.
 *
 * The spec left the representation open. Exporters must never parse: `export-svg` needs
 * the channels separately for `rgba()`, the rasterizer multiplies alpha by inherited
 * opacity, and a text-to-path pass needs the fill without a regex. Whoever writes
 * `#ff0000` writes it in a brief or a template; converting it is the template SDK's job.
 */
export const colorSchema = z.strictObject({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: unitInterval.default(1),
});
export type Color = z.infer<typeof colorSchema>;

export const blendModes = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export const blendModeSchema = z.enum(blendModes);
export type BlendMode = z.infer<typeof blendModeSchema>;

export const fontRefSchema = z.strictObject({
  family: z.string().min(1),
  /** `bundled` fonts ship with Tyto; `file` ones come from the brief's folder. */
  source: z.enum(['bundled', 'file']),
  path: z.string().min(1).optional(),
});
export type FontRef = z.infer<typeof fontRefSchema>;

export const assetRefSchema = z.strictObject({
  id: z.string().min(1),
  source: z.enum(['file', 'url', 'inline']),
  path: z.string().min(1).optional(),
  /** Content hash: same brief plus same assets must produce the same bytes. */
  hash: z.string().min(1),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const fitSchema = z.enum(['cover', 'contain', 'fill']);
export type Fit = z.infer<typeof fitSchema>;

export const gradientStopSchema = z.strictObject({
  offset: unitInterval,
  color: colorSchema,
});
export type GradientStop = z.infer<typeof gradientStopSchema>;

/** At least two stops, because one stop is a solid paint written the long way. */
const gradientStops = z.array(gradientStopSchema).min(2);

export const paintSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('solid'), color: colorSchema }),
  z.strictObject({
    kind: z.literal('linear-gradient'),
    /** Degrees clockwise from "up", the way a designer states a gradient angle. */
    angle: finite,
    stops: gradientStops,
  }),
  z.strictObject({
    kind: z.literal('radial-gradient'),
    center: unitPointSchema,
    radius: nonNegative,
    stops: gradientStops,
  }),
  z.strictObject({ kind: z.literal('image'), asset: assetRefSchema, fit: fitSchema }),
]);
export type Paint = z.infer<typeof paintSchema>;

export const strokeSchema = z.strictObject({
  paint: paintSchema,
  width: nonNegative,
  align: z.enum(['inside', 'center', 'outside']).default('center'),
});
export type Stroke = z.infer<typeof strokeSchema>;

export const effectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('shadow'),
    x: finite,
    y: finite,
    blur: nonNegative,
    spread: finite,
    color: colorSchema,
  }),
  z.strictObject({ kind: z.literal('blur'), radius: nonNegative }),
  z.strictObject({ kind: z.literal('background-blur'), radius: nonNegative }),
]);
export type Effect = z.infer<typeof effectSchema>;

export const transformSchema = z.strictObject({
  x: finite.default(0),
  y: finite.default(0),
  /** Degrees, clockwise. */
  rotation: finite.default(0),
  scaleX: finite.default(1),
  scaleY: finite.default(1),
  /** Origin of rotation and scale, normalised inside the node's own box. */
  anchor: unitPointSchema.default({ x: 0, y: 0 }),
});
export type Transform = z.infer<typeof transformSchema>;

/**
 * The transform a node has when it says nothing: no translation, no rotation, no scale.
 * Spelled out because `.default()` takes a parsed value, and every node carries one.
 */
export const identityTransform: Transform = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  anchor: { x: 0, y: 0 },
};

/**
 * A mask names a node elsewhere in the scene. Whether that node exists, and whether it is
 * one of the masked node's own descendants, is checked in `invariants.ts` — the shape
 * alone cannot know.
 */
export const maskRefSchema = z.strictObject({
  nodeId: z.string().min(1),
  mode: z.enum(['alpha', 'luminance']),
});
export type MaskRef = z.infer<typeof maskRefSchema>;
