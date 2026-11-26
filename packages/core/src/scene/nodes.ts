import { z } from 'zod';

import {
  type BlendMode,
  type Effect,
  type MaskRef,
  type Transform,
  assetRefSchema,
  blendModeSchema,
  colorSchema,
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

const roomSchema = z.number().finite().nonnegative();
const emSchema = z.number().finite().positive();

/**
 * A filled box behind a run (ADR 0231): a word set on a colour, inside the text's own line
 * breaking.
 *
 * It is measured from the type, not from the line: `over` reaches above the cap height and
 * `under` below the baseline, both in px, so the box hugs the capitals the way a designer
 * draws it rather than covering the font's whole ascent and descent. `x` is added on each
 * side and takes room in the line, as any inline padding does. A run the exporter breaks
 * across lines draws one box per line, each with its full padding and `radius`.
 *
 * `metrics` are the run's face's vertical metrics in em, which the box is placed by. The
 * exporter cannot read a font — it is handed a URI per face — so the stage that holds the
 * face writes them here (`compile`'s text layout), and the exporter stays a function of the
 * Scene. Absent when no face could be read: the exporter then draws the box over the line's
 * own glyph box and says so.
 */
export const runBoxSchema = z.strictObject({
  /** Solid only: the box is painted as a shape, and a gradient or an image in it is a later ADR. */
  paint: z.strictObject({ kind: z.literal('solid'), color: colorSchema }),
  padding: z.strictObject({ x: roomSchema, over: roomSchema, under: roomSchema }),
  /** Corner radius in px; absent is square. */
  radius: roomSchema.optional(),
  metrics: z
    .strictObject({
      /** hhea ascent: where the browser puts the top of a run's glyph box. */
      ascent: emSchema,
      /** hhea descent, positive: where the glyph box ends below the baseline. */
      descent: emSchema,
      /** OS/2 cap height: what `over` is measured from. */
      capHeight: emSchema,
    })
    .optional(),
});
export type RunBox = z.infer<typeof runBoxSchema>;

export const textSpanSchema = z.strictObject({
  kind: z.literal('text'),
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
  box: runBoxSchema.optional(),
});
export type TextSpan = z.infer<typeof textSpanSchema>;

/**
 * A line ends here.
 *
 * It carries no styling because it has no glyph: the runs around it decide what the line
 * looks like. Leading, trailing and consecutive breaks are all legal — they are how an
 * author asks for an empty line, and the brief language produces all three (ADR 0016).
 *
 * `space` is a paragraph boundary (ADR 0205): px added between this line and the next, on
 * top of the line advance, so the text grows by exactly that. Absent is no room at all, and
 * that is how a template that declares no paragraph spacing writes a paragraph — the same
 * break it wrote before paragraphs existed, so its Scene does not change by a byte.
 */
export const lineBreakSchema = z.strictObject({
  kind: z.literal('break'),
  space: z.number().finite().positive().optional(),
});
export type LineBreak = z.infer<typeof lineBreakSchema>;

/**
 * One element of a formula (ADR 0206): plain text, a stacked fraction, or the super- and
 * subscripts set after whatever precedes them. A fraction's parts and a script hold the same
 * elements again, so a fraction may sit in a denominator.
 *
 * Written out by hand, as `GroupNode` is, because inference cannot close the recursion.
 */
export type MathItem =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'fraction';
      readonly numerator: readonly MathItem[];
      readonly denominator: readonly MathItem[];
    }
  | {
      readonly kind: 'scripts';
      readonly superscript?: readonly MathItem[] | undefined;
      readonly subscript?: readonly MathItem[] | undefined;
    };

export const mathItemSchema: z.ZodType<MathItem> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), text: z.string().min(1) }),
    z.strictObject({
      kind: z.literal('fraction'),
      numerator: z.array(mathItemSchema).min(1),
      denominator: z.array(mathItemSchema).min(1),
    }),
    z
      .strictObject({
        kind: z.literal('scripts'),
        superscript: z.array(mathItemSchema).min(1).optional(),
        subscript: z.array(mathItemSchema).min(1).optional(),
      })
      .refine((item) => item.superscript !== undefined || item.subscript !== undefined, {
        message: 'scripts needs a superscript or a subscript',
      }),
  ]),
);

const nonNegative = z.number().finite().nonnegative();

/**
 * A piece of a formula's text, placed: `x` from the formula's left edge and `y` the piece's
 * baseline below the formula's baseline (negative is above it), both in px. Each piece names
 * the face that draws it, chosen glyph by glyph through the chain of ADR 0168.
 */
export const formulaGlyphSchema = z.strictObject({
  text: z.string().min(1),
  font: fontRefSchema,
  size: z.number().finite().positive(),
  weight: textSpanSchema.shape.weight,
  style: z.enum(['normal', 'italic']),
  x: z.number().finite(),
  y: z.number().finite(),
});
export type FormulaGlyph = z.infer<typeof formulaGlyphSchema>;

/** A fraction rule: its top edge `y` px below the formula's baseline, like a glyph's `y`. */
export const formulaRuleSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  thickness: z.number().finite().positive(),
});
export type FormulaRule = z.infer<typeof formulaRuleSchema>;

/**
 * Where everything of a formula goes, as `measureText` decided it (ADR 0206).
 *
 * `ascent` and `descent` are the formula's box above and below its baseline. `above` and
 * `below` are how far that box reaches past the strut of the line it sits on, so a line
 * holding a fraction is taller by the largest of each; `export-svg` moves its baselines by
 * them, and `export-html` draws the box and the browser's line box grows by the same.
 *
 * `offset` is where the formula starts on its line and `lineWidth` how wide the line is, both
 * in px: SVG lays nothing out, so `export-svg` places the formula, and centres or right-aligns
 * a line holding one, from these two numbers instead of measuring the text before it.
 */
export const formulaLayoutSchema = z.strictObject({
  offset: nonNegative,
  lineWidth: nonNegative,
  width: nonNegative,
  ascent: nonNegative,
  descent: nonNegative,
  above: nonNegative,
  below: nonNegative,
  glyphs: z.array(formulaGlyphSchema),
  rules: z.array(formulaRuleSchema),
});
export type FormulaLayout = z.infer<typeof formulaLayoutSchema>;

/**
 * A formula: a stacked fraction, super- and subscripts, in the style of the text around it
 * (ADR 0206). `math` is what the brief wrote; `layout` is what an exporter draws, and is
 * absent only when the node could not be measured, in which case both exporters draw `text`
 * in the run's style.
 *
 * `text` is the formula's linear reading, `1/(40·10^(−3))` (`linearReading`). It is there
 * for every reader that takes a run's `text` as plain text — `kind === 'break' ? … : run.text`
 * is written all over templates in their own repositories — so they keep compiling and read
 * something sensible, as the AST's `Formula` keeps its `children` (ADR 0206 decision 13).
 */
export const formulaRunSchema = z.strictObject({
  kind: z.literal('formula'),
  text: z.string().min(1),
  math: z.array(mathItemSchema).min(1),
  font: fontRefSchema,
  size: z.number().finite().positive(),
  weight: textSpanSchema.shape.weight,
  style: z.enum(['normal', 'italic']),
  color: paintSchema,
  layout: formulaLayoutSchema.optional(),
});
export type FormulaRun = z.infer<typeof formulaRunSchema>;

/**
 * A run is a span of styled text or a break between two lines.
 *
 * A break is a node in the list rather than a `
` inside a span's text, so that no
 * exporter ever scans a string to find one — the same rule that keeps colour structured
 * (`docs/ir-schema.md`, ADR 0016). SVG has no automatic line breaking and has to split
 * into positioned `<tspan>` elements either way; reading the split off the list is that
 * work done once, in the IR, instead of once per exporter.
 */
export const textRunSchema = z.discriminatedUnion('kind', [
  textSpanSchema,
  lineBreakSchema,
  formulaRunSchema,
]);
export type TextRun = z.infer<typeof textRunSchema>;

/**
 * `svg` and `path` are the two shapes the spec gives a Vector, tagged so that an exporter
 * cannot mistake one for the other. `markup` is not sanitised by anyone: it is
 * refused unless it is flat geometry, by `checkSvgMarkup` — which `parseScene` runs on
 * every scene and both exporters run again before they inline it (ADR 0068).
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
