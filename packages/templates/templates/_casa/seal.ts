/**
 * The seal every Casa carousel may close with (TYTO-201): an art 1080 × 140 glued to
 * the foot of the last grid slide, supplied by the brief's optional `selo` slot.
 *
 * The house's, not one brand's, because Azul's agenda and approved list and the three
 * brands' mock-exam agenda all take it the same way (the maintainer, 2026-09-29). The kit's
 * `sealed` draws it and shrinks the page above it; this file decides **when**.
 */

import type { TemplateContext } from '@tyto/core';
import type { Seal } from '@tyto/template-kit';

/** The seal art's height; its width is the frame's. */
export const SEAL_HEIGHT = 140;

/**
 * The seal this slide carries: the brief's `selo`, on the last slide of a grid, and nothing
 * anywhere else.
 *
 * The last slide because the seal closes the carousel; a one-slide grid is its own last. Not
 * on a story, which the maintainer did not ask for. The format is read by name, and every
 * template that calls this declares its grid as `grid`.
 */
export function sealOf(context: TemplateContext): Seal | undefined {
  if (context.format !== 'grid') return undefined;
  if (context.artwork.index !== context.artwork.count - 1) return undefined;

  const value = context.slots['selo']?.value;
  return value?.kind === 'image' ? { asset: value.asset, height: SEAL_HEIGHT } : undefined;
}
