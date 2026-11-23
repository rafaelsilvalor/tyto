import { z } from 'zod';

import { BRAND_ID, HEX_COLOR } from './manifest.js';

/**
 * The checks a brand kit meets where it arrives as somebody else's data — registered by an
 * installed plugin, across its process boundary (ADR 0063). Apart from `brand.ts`, whose
 * types are what a template reads: these are what a boundary checks, and only `@tyto/core`
 * exports them, not the template SDK.
 */

/**
 * The longest `d` a kit may carry, in characters.
 *
 * A kit crosses with every call an installed code template answers (ADR 0063), so a path
 * of any length would be paid for on every frame. 64 Ki characters holds a detailed logo
 * with room to spare; a path past it is refused when the kit is registered, not cut.
 */
export const MARK_PATH_LIMIT = 65_536;

/** The longest signature a kit may carry, in characters: a line of text, not a document. */
export const SIGNATURE_LIMIT = 500;

const boxSchema = z.strictObject({
  w: z.number().positive().finite(),
  h: z.number().positive().finite(),
});

const fillRuleSchema = z.enum(['nonzero', 'evenodd']);

const toneSchema = z.enum(['primary', 'secondary']);

export const markSchema = z.strictObject({
  box: boxSchema,
  d: z.string().min(1).max(MARK_PATH_LIMIT),
  fillRule: fillRuleSchema,
});

/**
 * The most layers a toned mark may hold (ADR 0066). A logo in two tones needs two; sixteen
 * leaves room for a shape cut into several pieces without inviting one layer per detail.
 */
export const MARK_LAYER_LIMIT = 16;

/**
 * A toned mark. `MARK_PATH_LIMIT` bounds the **sum** of its layers' paths, not each one: the
 * cost the limit exists for is the kit riding every call, and sixteen layers each at the limit
 * would be sixteen times what a one-path mark may cost.
 */
export const tonedMarkSchema = z
  .strictObject({
    box: boxSchema,
    layers: z
      .array(
        z.strictObject({
          tone: toneSchema,
          d: z.string().min(1),
          fillRule: fillRuleSchema,
        }),
      )
      .min(1)
      .max(MARK_LAYER_LIMIT),
  })
  .refine(
    (mark) => mark.layers.reduce((total, layer) => total + layer.d.length, 0) <= MARK_PATH_LIMIT,
    { message: `the layers' paths together must be at most ${String(MARK_PATH_LIMIT)} characters` },
  );

/** A kit's logo or wordmark: one shape, or toned layers (ADR 0066). */
export const brandMarkSchema = z.union([markSchema, tonedMarkSchema]);

/**
 * A kit's colours (ADR 0155): closed, so a colour nobody declared is refused at activation
 * rather than read by a template that guessed its name. A second colour joins by an ADR.
 */
export const brandColorsSchema = z.strictObject({
  accent: z.string().regex(HEX_COLOR, "must be a hex colour such as '#5900a7'").optional(),
});

/**
 * A kit's background pattern (ADR 0228): a tile and its layers, each filled or stroked, no
 * colour. The same bounds as a toned mark — the tile rides every call as a logo does — and a
 * stroke no wider than the tile, which past that would paint the whole tile in one tone.
 */
export const brandPatternSchema = z
  .strictObject({
    tile: boxSchema,
    layers: z
      .array(
        z.union([
          z.strictObject({ tone: toneSchema, d: z.string().min(1), fillRule: fillRuleSchema }),
          z.strictObject({
            tone: toneSchema,
            d: z.string().min(1),
            stroke: z.number().positive().finite(),
          }),
        ]),
      )
      .min(1)
      .max(MARK_LAYER_LIMIT),
  })
  .refine(
    (pattern) =>
      pattern.layers.reduce((total, layer) => total + layer.d.length, 0) <= MARK_PATH_LIMIT,
    { message: `the layers' paths together must be at most ${String(MARK_PATH_LIMIT)} characters` },
  )
  .refine(
    (pattern) =>
      pattern.layers.every(
        (layer) => !('stroke' in layer) || layer.stroke <= Math.min(pattern.tile.w, pattern.tile.h),
      ),
    { message: "a layer's stroke must be no wider than the tile" },
  );

export const brandKitSchema = z.strictObject({
  logo: brandMarkSchema.optional(),
  wordmark: brandMarkSchema.optional(),
  signature: z.string().max(SIGNATURE_LIMIT).optional(),
  colors: brandColorsSchema.optional(),
  pattern: brandPatternSchema.optional(),
});

/** A brand id, as a manifest's `brand` spells it (ADR 0052). */
export const brandIdSchema = z
  .string()
  .regex(BRAND_ID, 'must be lower case letters, digits and single hyphens, like my-brand');
