import type { AssetRef } from '@tyto/core';

/**
 * How tall a frame `width` wide must be to hold `asset` without cropping or bands.
 *
 * A template cannot open the file a brief names, so it cannot measure the picture; the host
 * that found the file read the size off its header and put it on the ref (ADR 0158). Before
 * that, a template that framed a person's image made them write its proportion on the slide
 * by hand (TYTO-477's `{proporcao}`).
 *
 * **`fallback` is a height, not an aspect**, and it is what the frame is when the ref has no
 * size: no image at all, a ref built by hand, or a header the host could not parse. A template
 * picks the height its layout reads well at, and the picture is fitted into it as before.
 */
export function imageHeight(asset: AssetRef | undefined, width: number, fallback: number): number {
  const size = asset?.size;
  if (size === undefined || !(size.w > 0) || !(size.h > 0)) return fallback;
  return (width * size.h) / size.w;
}
