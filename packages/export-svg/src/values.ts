import type { Color, Matrix } from '@tyto/core';

/**
 * IR leaves as SVG attribute text.
 *
 * The same job `export-html`'s `values.ts` does, in the other dialect, and separate on
 * purpose: SVG splits a colour into `fill` plus `fill-opacity` where CSS writes one
 * `rgba()`, and a shared helper would have to return both shapes and let each caller pick.
 * What the two do share is the rounding, and for the same reason — a snapshot is a diff,
 * and `matrix(6.123233995736766e-17, …)` is a line nobody can review.
 */

/** Four decimals, then the shortest form of what survives; `-0` folds to `0`. */
export function svgNumber(value: number): string {
  return String(Number(value.toFixed(4)) || 0);
}

function hex(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}

/** The colour without its alpha; SVG carries that in a separate `*-opacity` attribute. */
export function svgColor(color: Color): string {
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

export function svgMatrix(matrix: Matrix): string {
  const parts = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  return `matrix(${parts.map(svgNumber).join(' ')})`;
}

export function isIdentity(matrix: Matrix): boolean {
  return (
    matrix.a === 1 &&
    matrix.b === 0 &&
    matrix.c === 0 &&
    matrix.d === 1 &&
    matrix.e === 0 &&
    matrix.f === 0
  );
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Text and attribute values.
 *
 * `&apos;` rather than `&#39;`: the document is XML, so the named entity is defined, and
 * an SVG a designer opens in an editor reads better for it.
 */
export function escapeXml(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (character) => XML_ESCAPES[character] ?? character);
}

/** One attribute, or nothing when the value is the one SVG already assumes. */
export function attribute(name: string, value: string | undefined): string {
  return value === undefined ? '' : ` ${name}="${value}"`;
}

/** Builds an element from parts, dropping the empty ones so the output stays readable. */
export function element(tag: string, attributes: readonly string[], children?: string): string {
  const head = `<${tag}${attributes.filter((part) => part !== '').join('')}`;
  return children === undefined || children === '' ? `${head}/>` : `${head}>${children}</${tag}>`;
}

/**
 * A rounded rectangle as a path, all four corners independent.
 *
 * `<rect>` takes one `rx` and one `ry`; the IR takes `[tl, tr, br, bl]` because CSS does.
 * Writing the path is the only way to keep the fourth corner, and writing it for every
 * rect rather than only the uneven ones keeps one shape in the snapshots.
 */
export function roundedRectPath(
  size: { readonly w: number; readonly h: number },
  radius: readonly [number, number, number, number],
): string {
  const limit = Math.min(size.w, size.h) / 2;
  const [tl, tr, br, bl] = radius.map((corner) => Math.min(corner, limit)) as [
    number,
    number,
    number,
    number,
  ];
  const n = svgNumber;

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
