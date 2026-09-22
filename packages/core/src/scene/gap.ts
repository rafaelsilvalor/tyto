import type { RectNode } from './nodes.js';
import { type Color, type Size, identityTransform } from './primitives.js';

/**
 * The mark a partial render draws where something the brief promised is missing
 * (ADR 0035, closing the open question in ADR 0025).
 *
 * Three codes leave a hole that nothing in the artwork names — a required slot the brief
 * never set, an asset whose bytes never loaded, a node the exporter cannot express — and
 * each was fatal for that reason alone. The hole is what makes a partial render dangerous
 * in the way a stale one is not: it shows art that looks finished, and somebody in a hurry
 * exports it.
 *
 * **One colour and one shape, described here and nowhere else.** The two stages that can
 * meet a hole are three stages apart and draw in different alphabets — `compile` puts
 * nodes in a `Scene`, an exporter writes markup — so this module gives each the form it
 * can use and keeps the *look* single. Two descriptions would be two chances to draw a
 * marker somebody mistakes for design.
 */

/**
 * Magenta, and deliberately a colour no template in this repository uses.
 *
 * A marker has one job — to be unmistakable — and a marker in a plausible brand colour is
 * a marker that reads as a design decision. It is also the colour print and layout tools
 * have used for "missing" for decades, so it is the one somebody already recognises.
 */
export const GAP_COLOR: Color = { r: 255, g: 0, b: 170, a: 1 };

/** The same colour as CSS/SVG text, for the markup form below. */
export const GAP_COLOR_CSS = '#ff00aa';

/**
 * The stamp's stroke width for a frame of this size, floored so a small frame still shows.
 *
 * Proportional rather than constant because a 16 px band is a hairline on a 2160 px export
 * and a wall on a 320 px thumbnail, and the stamp has to read the same at both.
 */
export function gapStampWidth(size: Size): number {
  return Math.max(4, Math.round(Math.min(size.w, size.h) / 60));
}

/**
 * The stamp `compile` puts on a frame whose brief left a required slot unset.
 *
 * **It marks the frame and not the slot, and that is the decision rather than a shortcut.**
 * Where a slot would have been drawn is knowledge only the template has — `compile` hands
 * it a `slots` record and gets a finished `Frame` back — so a mark in the right place would
 * have to be drawn by the template, and a guarantee a third-party template can forget is
 * not a guarantee. What this can say honestly is *this artwork is incomplete*, on every
 * frame, in the exported bytes; which slot is missing is what the diagnostic names.
 *
 * An inside-aligned stroke, so the band is inside the frame and nothing is pushed out of
 * it: a stamp that changed the layout would be a second failure of its own.
 */
export function gapStampNode(id: string, size: Size): RectNode {
  return {
    id,
    name: 'incomplete',
    kind: 'rect',
    transform: identityTransform,
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    size,
    radius: [0, 0, 0, 0],
    stroke: {
      paint: { kind: 'solid', color: GAP_COLOR },
      width: gapStampWidth(size),
      align: 'inside',
    },
  };
}

/**
 * The mark an exporter draws in the box of a node it could not fill: a crossed box.
 *
 * Written as an SVG document rather than as IR because the stages that need it are past
 * the IR — an exporter meets an unresolved asset while it is emitting characters, and
 * ADR 0018 is the precedent for a visitor deciding there. It carries `viewBox` and
 * `preserveAspectRatio="none"` so it stretches to whatever box it is given, and
 * `vector-effect` so the stroke does not stretch with it.
 *
 * No text in it, and that is a constraint rather than a preference: a `Text` node needs a
 * face declared in the scene and resolved to bytes at export, and a marker that can fail
 * `E_EXPORT_FONT_UNRESOLVED` is a marker that disappears in exactly the runs it exists for.
 */
export const GAP_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="none">' +
  `<rect x="0" y="0" width="64" height="64" fill="${GAP_COLOR_CSS}" fill-opacity="0.12"/>` +
  `<path d="M0 0 L64 64 M64 0 L0 64" fill="none" stroke="${GAP_COLOR_CSS}" stroke-width="3" vector-effect="non-scaling-stroke"/>` +
  `<rect x="0" y="0" width="64" height="64" fill="none" stroke="${GAP_COLOR_CSS}" stroke-width="6" vector-effect="non-scaling-stroke"/>` +
  '</svg>';

/**
 * The same mark as a URI, which is the one form both exporters already have a slot for.
 *
 * An unresolved asset is reported by one function in each exporter, and every caller of it
 * wants a URI — an `<img src>`, a CSS `background-image`, an SVG `<image href>`. Answering
 * with this instead of with nothing puts the mark in all three without a call site
 * learning anything new. Percent-encoded rather than base64 so the bytes are readable in a
 * diff, and because `encodeURIComponent` leaves nothing in it that an HTML attribute, a
 * CSS `url()` or an XML attribute would have to escape again.
 */
export const GAP_ASSET_URI = `data:image/svg+xml,${encodeURIComponent(GAP_MARK_SVG)}`;
