import type {
  AssetRef,
  GroupNode,
  ImageNode,
  Matrix,
  Paint,
  RectNode,
  SceneNode,
  Size,
  Stroke,
  VectorNode,
} from '@tyto/core';
import { nodeMatrix } from '@tyto/core';

import { escapeHtml } from './escape.js';
import { cssColor, cssLength, cssMatrix, cssNumber, isIdentity } from './values.js';

/**
 * A subtree of the IR drawn as SVG, for the one thing CSS has no shape for: a mask.
 *
 * `docs/ir-schema.md` maps `mask` to `mask-image` with "mask node rendered as SVG data
 * URI", and this is that renderer. It is deliberately *not* `export-svg` (E5.2): it draws
 * the four node kinds a mask is made of and refuses the fifth, because a text mask needs
 * laid-out glyphs and a font embedded in a document that cannot see this one's
 * `@font-face` — the same problem E5.2 exists to solve, and half-solving it here would
 * give the two exporters two answers.
 *
 * Gradients are written in user space with the CSS gradient-line geometry rather than in
 * the unit square SVG would default to. The two disagree for any angle that is not a
 * multiple of 90° on a box that is not square, and a mask that faded at a different rate
 * than the fill beside it would be a bug nobody would think to look for here.
 */

export type ShapeProblem =
  | {
      readonly kind: 'unsupported';
      readonly node: string;
      readonly feature: string;
      readonly detail: string;
    }
  | { readonly kind: 'asset'; readonly node: string; readonly asset: string };

export interface ShapeContext {
  /** A self-contained URI for an asset's bytes, or `undefined` when it cannot be had. */
  readonly asset: (ref: AssetRef) => string | undefined;
  readonly report: (problem: ShapeProblem) => void;
}

/** Ids for the `<defs>` this document accumulates; scoped to one SVG, so a counter does. */
interface Defs {
  readonly entries: string[];
  next: number;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * The gradient line CSS draws, in the node's own coordinates.
 *
 * `angle` is clockwise from up, and up is `-y`, so the direction is `(sin, -cos)`. The
 * length is CSS's: the projection of the box onto that direction, which is what makes a
 * 45° gradient across a wide box reach both corners instead of stopping short.
 */
function gradientLine(
  angle: number,
  size: Size,
): { x1: number; y1: number; x2: number; y2: number } {
  const radians = angle * DEGREES_TO_RADIANS;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(size.w * dx) + Math.abs(size.h * dy);
  const cx = size.w / 2;
  const cy = size.h / 2;

  return {
    x1: cx - (dx * length) / 2,
    y1: cy - (dy * length) / 2,
    x2: cx + (dx * length) / 2,
    y2: cy + (dy * length) / 2,
  };
}

function stopMarkup(
  paint: Extract<Paint, { kind: 'linear-gradient' | 'radial-gradient' }>,
): string {
  return paint.stops
    .map(
      (item) =>
        `<stop offset="${cssNumber(item.offset)}" stop-color="${cssColor({ ...item.color, a: 1 })}" stop-opacity="${cssNumber(item.color.a)}"/>`,
    )
    .join('');
}

/**
 * A paint as a `fill`/`stroke` attribute value, adding a `<defs>` entry when it needs one.
 *
 * `undefined` means nothing should be painted: the caller writes `fill="none"` rather
 * than guessing a colour, because an unresolved asset has already been reported and a
 * silent grey would be the exporter inventing artwork.
 */
function paintValue(
  paint: Paint,
  size: Size,
  nodeId: string,
  defs: Defs,
  context: ShapeContext,
): { value: string; opacity?: number } | undefined {
  if (paint.kind === 'solid') {
    return { value: cssColor({ ...paint.color, a: 1 }), opacity: paint.color.a };
  }

  const id = `p${String(defs.next)}`;
  defs.next += 1;

  if (paint.kind === 'linear-gradient') {
    const line = gradientLine(paint.angle, size);
    defs.entries.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${cssNumber(line.x1)}" y1="${cssNumber(line.y1)}" x2="${cssNumber(line.x2)}" y2="${cssNumber(line.y2)}">${stopMarkup(paint)}</linearGradient>`,
    );
    return { value: `url(#${id})` };
  }

  if (paint.kind === 'radial-gradient') {
    defs.entries.push(
      `<radialGradient id="${id}" cx="${cssNumber(paint.center.x)}" cy="${cssNumber(paint.center.y)}" r="${cssNumber(paint.radius)}">${stopMarkup(paint)}</radialGradient>`,
    );
    return { value: `url(#${id})` };
  }

  const href = context.asset(paint.asset);
  if (href === undefined) {
    context.report({ kind: 'asset', node: nodeId, asset: paint.asset.id });
    return undefined;
  }
  const ratio =
    paint.fit === 'fill' ? 'none' : paint.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
  defs.entries.push(
    `<pattern id="${id}" width="1" height="1" patternContentUnits="objectBoundingBox"><image href="${escapeHtml(href)}" width="1" height="1" preserveAspectRatio="${ratio}"/></pattern>`,
  );
  return { value: `url(#${id})` };
}

function paintAttributes(
  attribute: 'fill' | 'stroke',
  paint: Paint | undefined,
  size: Size,
  nodeId: string,
  defs: Defs,
  context: ShapeContext,
): string {
  if (paint === undefined) return attribute === 'fill' ? ' fill="none"' : '';
  const resolved = paintValue(paint, size, nodeId, defs, context);
  if (resolved === undefined) return ` ${attribute}="none"`;
  const opacity =
    resolved.opacity === undefined || resolved.opacity === 1
      ? ''
      : ` ${attribute}-opacity="${cssNumber(resolved.opacity)}"`;
  return ` ${attribute}="${resolved.value}"${opacity}`;
}

function strokeAttributes(
  stroke: Stroke | undefined,
  size: Size,
  nodeId: string,
  defs: Defs,
  context: ShapeContext,
): string {
  if (stroke === undefined) return '';
  return `${paintAttributes('stroke', stroke.paint, size, nodeId, defs, context)} stroke-width="${cssNumber(stroke.width)}"`;
}

/**
 * A rounded rectangle as a path, all four corners independent.
 *
 * SVG's `<rect>` takes one `rx` and one `ry`, and the IR takes `[tl, tr, br, bl]` because
 * CSS does. Writing the path is the only way to keep the fourth corner, and doing it for
 * every rect rather than only the uneven ones keeps one shape in the snapshots instead of
 * two that differ for a reason the reader has to work out.
 */
function roundedRectPath(size: Size, radius: readonly [number, number, number, number]): string {
  const limit = Math.min(size.w, size.h) / 2;
  const [tl, tr, br, bl] = radius.map((corner) => Math.min(corner, limit)) as [
    number,
    number,
    number,
    number,
  ];
  const n = cssNumber;

  return [
    `M${n(tl)} 0`,
    `H${n(size.w - tr)}`,
    tr === 0 ? '' : `A${n(tr)} ${n(tr)} 0 0 1 ${n(size.w)} ${n(tr)}`,
    `V${n(size.h - br)}`,
    br === 0 ? '' : `A${n(br)} ${n(br)} 0 0 1 ${n(size.w - br)} ${n(size.h)}`,
    `H${n(bl)}`,
    bl === 0 ? '' : `A${n(bl)} ${n(bl)} 0 0 1 0 ${n(size.h - bl)}`,
    `V${n(tl)}`,
    tl === 0 ? '' : `A${n(tl)} ${n(tl)} 0 0 1 ${n(tl)} 0`,
    'Z',
  ]
    .filter((part) => part !== '')
    .join(' ');
}

function rectShape(node: RectNode, defs: Defs, context: ShapeContext): string {
  const fill = paintAttributes('fill', node.fill, node.size, node.id, defs, context);
  const stroke = strokeAttributes(node.stroke, node.size, node.id, defs, context);
  return `<path d="${roundedRectPath(node.size, node.radius)}"${fill}${stroke}/>`;
}

function vectorShape(node: VectorNode, defs: Defs, context: ShapeContext): string {
  if (node.geometry.kind === 'path') {
    const fill = paintAttributes('fill', node.fill, node.size, node.id, defs, context);
    const stroke = strokeAttributes(node.stroke, node.size, node.id, defs, context);
    const rule =
      node.geometry.fillRule === 'nonzero' ? '' : ` fill-rule="${node.geometry.fillRule}"`;
    return `<path d="${escapeHtml(node.geometry.d)}"${rule}${fill}${stroke}/>`;
  }

  // A nested `<svg>` gives the file its own viewport at the node's size, which is the
  // only way to size markup this package may not rewrite: `template-lang` hands the file
  // over verbatim and the schema calls it already sanitized.
  return `<svg width="${cssNumber(node.size.w)}" height="${cssNumber(node.size.h)}" overflow="visible">${node.geometry.markup}</svg>`;
}

function imageShape(node: ImageNode, context: ShapeContext): string {
  const href = context.asset(node.asset);
  if (href === undefined) {
    context.report({ kind: 'asset', node: node.id, asset: node.asset.id });
    return '';
  }
  const ratio =
    node.fit === 'fill' ? 'none' : node.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
  return `<image href="${escapeHtml(href)}" width="${cssNumber(node.size.w)}" height="${cssNumber(node.size.h)}" preserveAspectRatio="${ratio}"/>`;
}

function groupShape(node: GroupNode, defs: Defs, context: ShapeContext): string {
  return node.children.map((child) => shapeOf(child, defs, context)).join('');
}

/** What a node draws, before its own transform is applied. `undefined` for a text. */
function contentOf(node: SceneNode, defs: Defs, context: ShapeContext): string | undefined {
  return node.kind === 'group'
    ? groupShape(node, defs, context)
    : node.kind === 'rect'
      ? rectShape(node, defs, context)
      : node.kind === 'vector'
        ? vectorShape(node, defs, context)
        : node.kind === 'image'
          ? imageShape(node, context)
          : undefined;
}

/**
 * One node with its own transform and opacity applied, or nothing when it draws nothing.
 *
 * `override` replaces the node's own matrix, which is what the root of a mask needs: its
 * place in the document is not where the frame put it but where the masked node's own
 * coordinates put it, and those two differ by every transform between them. Passing one
 * also means this is the root, and a mask's root is drawn whatever its `visible` says —
 * being invisible is the normal state of a node that exists only to be a mask
 * (`docs/ir-schema.md`, and the badge in `valid-promo.json`). Its descendants keep their
 * own visibility, because inside the mask that is the shape the author drew.
 */
function shapeOf(node: SceneNode, defs: Defs, context: ShapeContext, override?: Matrix): string {
  if (!node.visible && override === undefined) return '';

  const inner = contentOf(node, defs, context);
  if (inner === undefined) {
    context.report({
      kind: 'unsupported',
      node: node.id,
      feature: 'a text node inside a mask',
      detail:
        'a mask is drawn into an isolated SVG document, which cannot reach this page’s @font-face; mask with a vector, or export SVG instead',
    });
    return '';
  }
  if (inner === '') return '';

  const matrix = override ?? nodeMatrix(node);
  const attributes = [
    isIdentity(matrix) ? '' : ` transform="${cssMatrix(matrix)}"`,
    node.opacity === 1 ? '' : ` opacity="${cssNumber(node.opacity)}"`,
  ].join('');

  return attributes === '' ? inner : `<g${attributes}>${inner}</g>`;
}

/** The box a mask document covers, in the coordinates of the node being masked. */
export interface ShapeRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A standalone SVG drawing `node` inside `region`, with `placement` mapping the node's
 * own coordinates onto the region's.
 *
 * `placement` replaces the node's own matrix rather than composing with it, because it
 * already carries it: it is `inverse(masked) × mask`, and both of those accumulated
 * matrices include their node's own transform. Empty when the node draws nothing, so the
 * caller can leave the `mask-image` off instead of pointing it at a blank document, which
 * would hide the node entirely.
 */
export function shapeDocument(
  node: SceneNode,
  placement: Matrix,
  region: ShapeRegion,
  context: ShapeContext,
): string {
  const defs: Defs = { entries: [], next: 0 };
  const body = shapeOf(node, defs, context, placement);
  if (body === '') return '';

  const defsMarkup = defs.entries.length === 0 ? '' : `<defs>${defs.entries.join('')}</defs>`;
  const viewBox = [region.x, region.y, region.w, region.h].map(cssNumber).join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${cssLength(region.w)}" height="${cssLength(region.h)}">${defsMarkup}${body}</svg>`;
}
