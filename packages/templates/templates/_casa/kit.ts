/**
 * The brand kit's logo and signature, or the placeholders where the kit leaves them out
 * (ADR 0065).
 *
 * Every template of the house reads its kit through these two, so "what is drawn when no kit
 * is installed" is decided once.
 */

import { PLACEHOLDER_LOGO, PLACEHOLDER_SIGNATURE } from './marks.js';

import type { BrandKit } from '@tyto/core';
import type { Mark } from '@tyto/template-kit';

/** The kit's logo, or the placeholder. */
export function logoOf(kit: BrandKit): Mark {
  return kit.logo ?? PLACEHOLDER_LOGO;
}

/** The kit's signature, or the placeholder. */
export function signatureOf(kit: BrandKit): string {
  return kit.signature ?? PLACEHOLDER_SIGNATURE;
}
