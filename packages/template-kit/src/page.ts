import { image } from '@tyto/core/template';

import { type Block, at, block } from './blocks.js';

import type { AssetRef, TemplateContext } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * A page in three bands: a header pinned to the top, a footer pinned to the bottom, and a
 * middle centred in the room left between them.
 *
 * Every Azul slide is laid out this way (TYTO-185), and nothing about it is a brand: the
 * edges and the header band are numbers the brand's tokens supply. Centring is the only
 * position that is right for every brief when the middle's height comes from the brief — a
 * slide with one row and a slide with twelve are both balanced. Only a middle taller than
 * the room is pinned under the header instead, because centring it would lay it over the
 * header; that case is a brief with too much in one slide, not a layout.
 */
export interface BandedPageOptions {
  readonly size: { readonly w: number; readonly h: number };
  /** Paper above the header band and below the footer, and the gutter on either side. */
  readonly edges: { readonly top: number; readonly bottom: number; readonly side: number };
  /** The header, centred vertically in a band of the stated height. */
  readonly header: { readonly item: Block; readonly band: number };
  /** The footer, standing on the bottom edge; its band is its own height. */
  readonly footer: Block;
  readonly middle: Block;
}

/** The three bands, placed: the frame's children, in paint order. */
export function bandedPage(options: BandedPageOptions): NodeDraft[] {
  const { edges, header, footer, middle } = options;

  const headerY = edges.top + (header.band - header.item.height) / 2;
  const top = edges.top + header.band;
  const bottom = options.size.h - edges.bottom - footer.height;
  const middleY = Math.max(top, top + (bottom - top - middle.height) / 2);

  return [
    at(edges.side, headerY, header.item),
    at(edges.side, middleY, middle),
    at(edges.side, bottom, footer),
  ];
}

/** A seal: an art the width of the frame, glued to its foot (TYTO-201). */
export interface Seal {
  readonly asset: AssetRef;
  readonly height: number;
}

/**
 * The page a layout has once a seal is glued to its foot, and the seal drawn there.
 *
 * **The page shrinks by the seal's height** (the maintainer, 2026-09-29): whatever lays the
 * slide out is handed the shorter size, so a middle centred on the page centres above the
 * seal and a footer standing on the bottom edge stands on the seal instead — nothing is
 * drawn under it. With no seal, the size is the frame's and there is nothing to draw.
 *
 * The seal is drawn with `cover`, so an art a few pixels off 1080 × `height` still fills
 * the band rather than leaving a sliver of paper beside it.
 */
export function sealed(
  size: { readonly w: number; readonly h: number },
  seal: Seal | undefined,
): { readonly size: { readonly w: number; readonly h: number }; readonly seal: NodeDraft[] } {
  if (seal === undefined) return { size, seal: [] };

  const band = { w: size.w, h: seal.height };
  const art = block(
    band.w,
    band.h,
    image({ name: 'seal', asset: seal.asset, size: band, fit: 'cover' }),
  );
  return { size: { w: size.w, h: size.h - seal.height }, seal: [at(0, size.h - seal.height, art)] };
}

/**
 * Reports content whose foot lands below the page's, and says nothing when it fits
 * (TYTO-202, ADR 0058).
 *
 * A frame draws what fits in its size and the rest is cut, so a slide written for the taller
 * story and rendered on the grid lost its last rows with nothing in the run saying so. The
 * layout is the only thing that knows where its content ends, so it asks here; `compile`
 * turns the report into `W_TEMPLATE_OVERFLOW` on the directive the slide came from.
 *
 * `bottom` is where the lowest thing drawn ends and `limit` is the height it must end by,
 * both in the frame's pixels. The difference is rounded by the catalog, not here.
 */
export function reportOverflow(
  report: TemplateContext['report'],
  bottom: number,
  limit: number,
): void {
  const overflow = bottom - limit;
  if (overflow > 0) report({ code: 'W_TEMPLATE_OVERFLOW', overflow });
}
