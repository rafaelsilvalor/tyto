import type { AssetRef, Diagnostic, Effect, Paint, Size, Stroke } from '@tyto/core';
import { diagnostic } from '@tyto/core';

import { attribute, element, escapeXml, svgColor, svgNumber } from './values.js';

/**
 * Everything that has to be declared before it can be referenced.
 *
 * SVG says a gradient, a mask, a clip path and a filter live in `<defs>` and are used by
 * id. That is the whole reason this file exists as a registry rather than as helpers: an
 * id has to be unique in the document and stable across runs, so it is a counter handed
 * out in the order the walk reaches things, and the entries come out in the same order
 * every time. Determinism (`docs/architecture.md`) is the requirement; a counter is the
 * cheapest thing that meets it.
 */

/** How the caller supplies what the IR only references. */
export interface SvgResources {
  /** A self-contained URI for an asset's bytes; `undefined` is a diagnostic. */
  readonly asset?: (ref: AssetRef) => string | undefined;
  /** A `data:` URI for one font face, embedded in the document's `<style>`. */
  readonly font?: (face: SvgFontFace) => string | undefined;
  /**
   * Glyph outlines for one run, as the `d` of a path in the run's own coordinates.
   *
   * Only asked for when `textAsPaths` is on. It is a port rather than a font parser in
   * this package for the same reason bytes are (ADR 0018): the exporter is pure, and
   * measuring and outlining text is `core`'s job once E4.5 brings the font machinery.
   */
  readonly outline?: (request: OutlineRequest) => Outline | undefined;
}

export interface SvgFontFace {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/**
 * A run drawn as a shape, and how far it advances the pen.
 *
 * The advance is what makes a second run on the same line placeable: without it a caller
 * could outline each run and would have no idea where to put the next one, and SVG does
 * no layout of its own.
 */
export interface Outline {
  /** Path data in the run's own coordinates: origin at the start of the baseline. */
  readonly d: string;
  readonly advance: number;
}

export interface OutlineRequest {
  readonly text: string;
  readonly family: string;
  readonly size: number;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  readonly letterSpacing: number;
}

/** The document being built: its `<defs>`, its font faces, and what went wrong. */
export interface Sink {
  readonly defs: string[];
  readonly faces: Map<string, SvgFontFace>;
  readonly problems: Diagnostic[];
  readonly resources: SvgResources;
  counter: number;
}

export function nextId(sink: Sink, prefix: string): string {
  const id = `${prefix}${String(sink.counter)}`;
  sink.counter += 1;
  return id;
}

export function unsupported(sink: Sink, node: string, feature: string, detail: string): void {
  sink.problems.push(
    diagnostic('E_EXPORT_UNSUPPORTED', { node, feature, detail, exporter: 'export-svg' }),
  );
}

export function approximated(sink: Sink, node: string, feature: string, detail: string): void {
  sink.problems.push(
    diagnostic('W_EXPORT_APPROXIMATED', { node, feature, detail, exporter: 'export-svg' }),
  );
}

export function assetUri(sink: Sink, node: string, ref: AssetRef): string | undefined {
  const uri = sink.resources.asset?.(ref);
  if (uri === undefined) {
    sink.problems.push(diagnostic('E_EXPORT_ASSET_UNRESOLVED', { asset: ref.id, node }));
    return undefined;
  }
  return uri;
}

/* -------------------------------------------------------------------------- paints -- */

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * The gradient line CSS draws, in the node's own coordinates.
 *
 * `angle` is clockwise from up and up is `-y`, so the direction is `(sin, -cos)`; the
 * length is the projection of the box onto it. Written in user space rather than in the
 * unit square SVG would default to, because the unit square disagrees with CSS for any
 * angle that is not a multiple of 90° on a box that is not square — and `export-html`
 * draws the CSS one. Two exporters, one gradient (ADR 0018).
 */
function gradientLine(angle: number, size: Size): readonly [number, number, number, number] {
  const radians = angle * DEGREES_TO_RADIANS;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(size.w * dx) + Math.abs(size.h * dy);

  return [
    size.w / 2 - (dx * length) / 2,
    size.h / 2 - (dy * length) / 2,
    size.w / 2 + (dx * length) / 2,
    size.h / 2 + (dy * length) / 2,
  ];
}

function stops(paint: Extract<Paint, { kind: 'linear-gradient' | 'radial-gradient' }>): string {
  return paint.stops
    .map((item) =>
      element('stop', [
        attribute('offset', svgNumber(item.offset)),
        attribute('stop-color', svgColor(item.color)),
        item.color.a === 1 ? '' : attribute('stop-opacity', svgNumber(item.color.a)),
      ]),
    )
    .join('');
}

export interface PaintValue {
  readonly value: string;
  /** The alpha a solid colour carries, which SVG keeps in a separate attribute. */
  readonly opacity: number;
}

/**
 * A paint as something `fill` or `stroke` can name, declaring a `<defs>` entry if needed.
 *
 * `undefined` means paint nothing: an unresolved asset has already been reported, and a
 * grey rectangle in its place would be the exporter inventing artwork.
 */
export function paintValue(
  paint: Paint,
  size: Size,
  node: string,
  sink: Sink,
): PaintValue | undefined {
  if (paint.kind === 'solid') return { value: svgColor(paint.color), opacity: paint.color.a };

  if (paint.kind === 'linear-gradient') {
    const id = nextId(sink, 'paint');
    const [x1, y1, x2, y2] = gradientLine(paint.angle, size);
    sink.defs.push(
      element(
        'linearGradient',
        [
          attribute('id', id),
          attribute('gradientUnits', 'userSpaceOnUse'),
          attribute('x1', svgNumber(x1)),
          attribute('y1', svgNumber(y1)),
          attribute('x2', svgNumber(x2)),
          attribute('y2', svgNumber(y2)),
        ],
        stops(paint),
      ),
    );
    return { value: `url(#${id})`, opacity: 1 };
  }

  if (paint.kind === 'radial-gradient') {
    const id = nextId(sink, 'paint');
    // `objectBoundingBox` is the default and is exactly the reading ADR 0018 gives the
    // radius: a fraction of the box on both axes, which is the ellipse CSS draws too.
    sink.defs.push(
      element(
        'radialGradient',
        [
          attribute('id', id),
          attribute('cx', svgNumber(paint.center.x)),
          attribute('cy', svgNumber(paint.center.y)),
          attribute('r', svgNumber(paint.radius)),
        ],
        stops(paint),
      ),
    );
    return { value: `url(#${id})`, opacity: 1 };
  }

  const href = assetUri(sink, node, paint.asset);
  if (href === undefined) return undefined;

  const id = nextId(sink, 'paint');
  // User space, not `objectBoundingBox`. In bounding-box units the image's viewport is the
  // unit *square*, so `preserveAspectRatio` fits the picture to a square and the square is
  // then stretched to the node's box — which turns a circle into an ellipse on anything
  // that is not square. Giving the pattern the real box is what makes `cover` mean cover.
  sink.defs.push(
    element(
      'pattern',
      [
        attribute('id', id),
        attribute('width', svgNumber(size.w)),
        attribute('height', svgNumber(size.h)),
        attribute('patternUnits', 'userSpaceOnUse'),
      ],
      element('image', [
        attribute('href', escapeXml(href)),
        attribute('width', svgNumber(size.w)),
        attribute('height', svgNumber(size.h)),
        attribute('preserveAspectRatio', aspectRatio(paint.fit)),
      ]),
    ),
  );
  return { value: `url(#${id})`, opacity: 1 };
}

export function aspectRatio(fit: 'cover' | 'contain' | 'fill'): string {
  if (fit === 'fill') return 'none';
  return fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
}

/** `fill="…" fill-opacity="…"`, or `fill="none"` when there is nothing to paint. */
export function paintAttributes(
  name: 'fill' | 'stroke',
  paint: Paint | undefined,
  size: Size,
  node: string,
  sink: Sink,
): string {
  if (paint === undefined) return name === 'fill' ? attribute('fill', 'none') : '';
  const resolved = paintValue(paint, size, node, sink);
  if (resolved === undefined) return attribute(name, 'none');
  return (
    attribute(name, resolved.value) +
    (resolved.opacity === 1 ? '' : attribute(`${name}-opacity`, svgNumber(resolved.opacity)))
  );
}

/* ------------------------------------------------------------------------- strokes -- */

/**
 * A stroke, aligned the way the IR says rather than the way SVG assumes.
 *
 * An SVG stroke always straddles the outline. `inside` and `outside` are drawn at twice
 * the width and then cut back — clipped to the shape, or masked to everything but the
 * shape — which is exact rather than approximate, and is why `export-svg` needs no warning
 * here where `export-html` does.
 */
export function strokeMarkup(
  stroke: Stroke,
  shape: string,
  size: Size,
  node: string,
  sink: Sink,
): string {
  const paint = paintAttributes('stroke', stroke.paint, size, node, sink);
  const width = stroke.align === 'center' ? stroke.width : stroke.width * 2;
  const base = [
    attribute('d', shape),
    attribute('fill', 'none'),
    paint,
    attribute('stroke-width', svgNumber(width)),
  ];

  if (stroke.align === 'center') return element('path', base);

  const id = nextId(sink, 'stroke');
  if (stroke.align === 'inside') {
    sink.defs.push(
      element('clipPath', [attribute('id', id)], element('path', [attribute('d', shape)])),
    );
    return element('path', [...base, attribute('clip-path', `url(#${id})`)]);
  }

  // Outside: everything is visible except the shape itself, so the inner half of the
  // doubled stroke is masked away. The white rectangle is the mask's "keep" area and has
  // to cover the doubled stroke, hence the padding by the full width.
  const pad = stroke.width * 2;
  sink.defs.push(
    element(
      'mask',
      [attribute('id', id), attribute('maskUnits', 'userSpaceOnUse')],
      element('rect', [
        attribute('x', svgNumber(-pad)),
        attribute('y', svgNumber(-pad)),
        attribute('width', svgNumber(size.w + pad * 2)),
        attribute('height', svgNumber(size.h + pad * 2)),
        attribute('fill', '#ffffff'),
      ]) + element('path', [attribute('d', shape), attribute('fill', '#000000')]),
    ),
  );
  return element('path', [...base, attribute('mask', `url(#${id})`)]);
}

/* ------------------------------------------------------------------------- filters -- */

/**
 * The effect list as one `<filter>`, chained in the order the IR wrote it.
 *
 * CSS applies a filter list left to right and `export-html` emits it that way, so each
 * primitive here takes the previous one's result. `feDropShadow` is used whenever the
 * spread is zero — it is one element instead of five, and it is the form Figma and
 * Illustrator read most reliably; a spread falls back to the long form, because ADR 0018
 * says a format that can draw one should.
 */
export function filterMarkup(
  effects: readonly Effect[],
  node: string,
  sink: Sink,
): string | undefined {
  // Written as a loop rather than a `filter`: the predicate would report as a side effect
  // and, worse, would not narrow the union, so every field below would need a second check.
  const drawn: Exclude<Effect, { kind: 'background-blur' }>[] = [];
  for (const effect of effects) {
    if (effect.kind === 'background-blur') {
      approximated(
        sink,
        node,
        'a background blur',
        'SVG has no backdrop filter, so the blur behind the node is not drawn; the raster and the HTML export do draw it',
      );
      continue;
    }
    drawn.push(effect);
  }
  if (drawn.length === 0) return undefined;

  const primitives: string[] = [];
  let input = 'SourceGraphic';

  for (const effect of drawn) {
    const result = nextId(sink, 'fx');

    if (effect.kind === 'blur') {
      primitives.push(
        element('feGaussianBlur', [
          attribute('in', input),
          // CSS states a blur radius; SVG states a standard deviation, and the radius is
          // twice it. `export-html` writes the radius, so halving it here is what keeps
          // the two exports the same picture.
          attribute('stdDeviation', svgNumber(effect.radius / 2)),
          attribute('result', result),
        ]),
      );
      input = result;
      continue;
    }

    if (effect.spread === 0) {
      primitives.push(
        element('feDropShadow', [
          attribute('in', input),
          attribute('dx', svgNumber(effect.x)),
          attribute('dy', svgNumber(effect.y)),
          attribute('stdDeviation', svgNumber(effect.blur / 2)),
          attribute('flood-color', svgColor(effect.color)),
          attribute('flood-opacity', svgNumber(effect.color.a)),
          attribute('result', result),
        ]),
      );
      input = result;
      continue;
    }

    primitives.push(spreadShadow(effect, input, result, sink));
    input = result;
  }

  const id = nextId(sink, 'filter');
  sink.defs.push(
    element(
      'filter',
      [
        attribute('id', id),
        // Room for the shadow and the blur to land outside the node's own box; the
        // default region is a 10% margin, which a 24px blur on a 240px badge overruns.
        attribute('x', '-50%'),
        attribute('y', '-50%'),
        attribute('width', '200%'),
        attribute('height', '200%'),
      ],
      primitives.join(''),
    ),
  );
  return `url(#${id})`;
}

/** The five primitives `feDropShadow` is short for, plus the spread it has no room for. */
function spreadShadow(
  effect: Extract<Effect, { kind: 'shadow' }>,
  input: string,
  result: string,
  sink: Sink,
): string {
  const alpha = nextId(sink, 'fx');
  const grown = nextId(sink, 'fx');
  const moved = nextId(sink, 'fx');
  const blurred = nextId(sink, 'fx');
  const flooded = nextId(sink, 'fx');
  const shadow = nextId(sink, 'fx');

  return [
    // `feMorphology` takes no negative radius, so a negative spread erodes instead.
    element('feColorMatrix', [
      attribute('in', input),
      attribute('type', 'matrix'),
      attribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'),
      attribute('result', alpha),
    ]),
    element('feMorphology', [
      attribute('in', alpha),
      attribute('operator', effect.spread > 0 ? 'dilate' : 'erode'),
      attribute('radius', svgNumber(Math.abs(effect.spread))),
      attribute('result', grown),
    ]),
    element('feOffset', [
      attribute('in', grown),
      attribute('dx', svgNumber(effect.x)),
      attribute('dy', svgNumber(effect.y)),
      attribute('result', moved),
    ]),
    element('feGaussianBlur', [
      attribute('in', moved),
      attribute('stdDeviation', svgNumber(effect.blur / 2)),
      attribute('result', blurred),
    ]),
    element('feFlood', [
      attribute('flood-color', svgColor(effect.color)),
      attribute('flood-opacity', svgNumber(effect.color.a)),
      attribute('result', flooded),
    ]),
    element('feComposite', [
      attribute('in', flooded),
      attribute('in2', blurred),
      attribute('operator', 'in'),
      attribute('result', shadow),
    ]),
    element(
      'feMerge',
      [attribute('result', result)],
      element('feMergeNode', [attribute('in', shadow)]) +
        element('feMergeNode', [attribute('in', input)]),
    ),
  ].join('');
}
