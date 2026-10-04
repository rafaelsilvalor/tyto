import { z } from 'zod';

import { BRAND_ID } from './manifest.js';

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

export const markSchema = z.strictObject({
  box: z.strictObject({
    w: z.number().positive().finite(),
    h: z.number().positive().finite(),
  }),
  d: z.string().min(1).max(MARK_PATH_LIMIT),
  fillRule: z.enum(['nonzero', 'evenodd']),
});

export const brandKitSchema = z.strictObject({
  logo: markSchema.optional(),
  signature: z.string().max(SIGNATURE_LIMIT).optional(),
});

/** A brand id, as a manifest's `brand` spells it (ADR 0052). */
export const brandIdSchema = z
  .string()
  .regex(BRAND_ID, 'must be lower case letters, digits and single hyphens, like my-brand');
