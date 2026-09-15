import type { Size } from '@tyto/core';

import { attribute, svgNumber } from './values.js';

/**
 * An inline SVG file, read far enough to place it — and no further.
 *
 * `Vector.geometry` of kind `svg` is a whole file, root element and all, handed over
 * verbatim by `template-lang` (`docs/ir-schema.md`). Drawing it used to mean nesting it
 * inside an `<svg width height>`, which is what SVG gives you for free: the nested
 * viewport scales the file's `viewBox` to the node's box and no arithmetic is needed.
 *
 * Figma does not scale a nested viewport. A 24×24 mark placed on a 48×48 node imports at
 * 24×24, which is why TYTO-60 replaces the viewport with a `<g transform>` the importer
 * does read. That trade is the reason this file exists: the scale SVG was computing has
 * to be computed here, and computing it means reading the file's `viewBox`.
 *
 * Nothing else about the file is read, and nothing at all is rewritten. What comes back
 * is the root's children as they stand, the box they are drawn in, and the namespace
 * declarations the root carried — those move onto the `<g>` because the element that
 * declared them is the element being dropped, and a child using `xlink:href` would
 * otherwise reference a prefix nobody bound.
 */

export interface InlineSvg {
  /** The root element's children, verbatim. */
  readonly content: string;
  /** `xmlns:*` declarations from the dropped root, as attribute text. */
  readonly namespaces: string;
  /** The box `content` is drawn in, from `viewBox` or from `width`/`height`. */
  readonly box: InlineBox | undefined;
}

export interface InlineBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const ROOT = /<svg((?:"[^"]*"|'[^']*'|[^>"'])*)>/iu;
const ATTRIBUTES = /([a-zA-Z_:][\w.:-]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][\w.:-]*)\s*=\s*'([^']*)'/gu;

function attributesOf(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTES)) {
    const [, doubleName, doubleValue, singleName, singleValue] = match;
    const name = doubleName ?? singleName;
    const value = doubleValue ?? singleValue;
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
}

/** A length attribute, which may carry the one unit that means user units. */
function lengthOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value.trim().replace(/px$/iu, ''));
  return Number.isFinite(number) ? number : undefined;
}

/**
 * The box the file's content lives in.
 *
 * `viewBox` first, because it is what the nested viewport used to read. A file with none
 * but with `width`/`height` states its own box the long way and is treated the same;
 * a file with neither has not said, and `undefined` travels up to be reported.
 */
function boxOf(attributes: Map<string, string>): InlineBox | undefined {
  const viewBox = attributes.get('viewBox');
  if (viewBox !== undefined) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    const [x, y, w, h] = parts;
    if (
      parts.length === 4 &&
      parts.every((part) => Number.isFinite(part)) &&
      x !== undefined &&
      y !== undefined &&
      w !== undefined &&
      h !== undefined &&
      w > 0 &&
      h > 0
    ) {
      return { x, y, w, h };
    }
    return undefined;
  }

  const w = lengthOf(attributes.get('width'));
  const h = lengthOf(attributes.get('height'));
  return w !== undefined && h !== undefined && w > 0 && h > 0 ? { x: 0, y: 0, w, h } : undefined;
}

/**
 * The default `xmlns` is dropped and every prefixed one is kept.
 *
 * The document this content is moving into is already the SVG namespace, so re-declaring
 * it says nothing; a prefix, on the other hand, is bound nowhere else.
 */
function namespacesOf(attributes: Map<string, string>): string {
  return [...attributes]
    .filter(([name]) => name.startsWith('xmlns:'))
    .map(([name, value]) => attribute(name, value))
    .join('');
}

/** The file split into what is drawn and where; `undefined` when the root is not `<svg>`. */
export function readInlineSvg(markup: string): InlineSvg | undefined {
  const root = ROOT.exec(markup);
  if (root === null) return undefined;

  const close = markup.lastIndexOf('</svg>');
  const open = root.index + root[0].length;
  if (close < open) return undefined;

  const attributes = attributesOf(root[1] ?? '');
  return {
    content: markup.slice(open, close),
    namespaces: namespacesOf(attributes),
    box: boxOf(attributes),
  };
}

/**
 * The transform the viewport used to apply: `xMidYMid meet`, written out.
 *
 * A nested `<svg>` with no `preserveAspectRatio` of its own scales uniformly and centres
 * the remainder, so that is what is reproduced here — anything else would keep Figma
 * happy by moving the picture in Chrome, and the card forbids that trade.
 */
export function fitTransform(box: InlineBox, size: Size): string | undefined {
  const scale = Math.min(size.w / box.w, size.h / box.h);
  const x = (size.w - box.w * scale) / 2 - box.x * scale;
  const y = (size.h - box.h * scale) / 2 - box.y * scale;

  const moved = Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6;
  const scaled = Math.abs(scale - 1) > 1e-6;
  if (!moved && !scaled) return undefined;

  // `translate` and `scale` rather than one `matrix`: this is the one transform in the
  // document a designer is meant to recognise, and the two words say what happened.
  return [
    moved ? `translate(${svgNumber(x)} ${svgNumber(y)})` : '',
    scaled ? `scale(${svgNumber(scale)})` : '',
  ]
    .filter((part) => part !== '')
    .join(' ');
}
