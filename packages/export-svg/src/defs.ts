import type {
  AssetRef,
  Diagnostic,
  Effect,
  Paint,
  SceneFontFace,
  Size,
  Stroke,
  UnitPoint,
} from '@tyto/core';
import { GAP_ASSET_URI, diagnostic } from '@tyto/core';

import { attribute, element, escapeXml, roundedRectPath, svgColor, svgNumber } from './values.js';

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
  /**
   * The width and height the asset's bytes have, in pixels.
   *
   * `cover` and `contain` are a scale and an offset computed from the picture's own
   * proportions, and SVG will compute them for you — that is what `preserveAspectRatio`
   * is. Figma drops the attribute and stretches the picture to fill, so TYTO-60 makes the
   * exporter do the arithmetic and emit the result as geometry, which every renderer
   * reads. Doing the arithmetic needs the number, and this is where it comes from.
   *
   * A port rather than a field on `AssetRef`, for the reason ADR 0018 gives bytes: it is
   * a property of the file, the pure packages open no files, and a resolver that already
   * read the bytes to make a `data:` URI has it in hand. Unanswered is not a diagnostic —
   * an author cannot supply it, only a composition root can — and the export falls back
   * to `preserveAspectRatio`, which is what it emitted before this port existed.
   */
  readonly assetSize?: (ref: AssetRef) => Size | undefined;
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

/**
 * One face a document needs.
 *
 * `SceneFontFace` from `core`, under the name this package has always exported. It used to
 * be declared here with `family: string` where `export-html` declared its own with
 * `font: FontRef`, so the same scene produced two lists that could not be compared.
 * `FontRef` won: a family alone cannot tell a bundled face from one in the brief's folder,
 * and a loader that has to open a file needs the `path`. `face.font.family` is the old
 * field, one hop further in (TYTO-62).
 */
export type SvgFontFace = SceneFontFace;

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

/**
 * The bytes for an asset, or the mark that says there were none (ADR 0035).
 *
 * Every caller wants an `href`, so the gap is drawn by answering with one rather than by
 * each call site learning what an unresolved asset looks like. It stays an error — the
 * export fails the build — and what changes is that the failure is now in the picture.
 */
export function assetUri(sink: Sink, node: string, ref: AssetRef): string {
  const uri = sink.resources.asset?.(ref);
  if (uri === undefined) {
    sink.problems.push(diagnostic('E_EXPORT_ASSET_UNRESOLVED', { asset: ref.id, node }));
    return GAP_ASSET_URI;
  }
  return uri;
}

/* -------------------------------------------------------------------------- images -- */

const EPSILON = 1e-6;

/** The centre of the picture, which is what a paint means by `cover` and has no field for. */
export const CENTRED: UnitPoint = { x: 0.5, y: 0.5 };

/**
 * A picture drawn at its own size and then moved and scaled into the box, plus the clip
 * that hides what hangs over the edge.
 *
 * This is `preserveAspectRatio` written out. SVG can do the fit itself and did until
 * TYTO-60, but Figma ignores the attribute — on an `<image>` and inside a `<pattern>` —
 * and stretches the picture to fill, which destroys the proportions of every `cover`
 * photo it imports. A transform and a clip are ordinary geometry that no importer has the
 * option of dropping.
 *
 * The offset is `object-position`'s: the same fraction of the leftover, in the same
 * direction, so a focal point lands where `export-html` puts it rather than at one of the
 * nine alignments `preserveAspectRatio` could name. That is the second thing this buys —
 * a focal point off the ninths is now exact instead of snapped and reported.
 *
 * `preserveAspectRatio="none"` survives on the element and is not a contradiction. The
 * `<image>` is given the picture's own width and height, so there is no fitting left to
 * do, and `none` is what makes a renderer that reads the attribute and one that ignores
 * it draw the same thing even if the measurement were wrong.
 */
export function croppedImage(
  href: string,
  natural: Size,
  box: Size,
  fit: 'cover' | 'contain' | 'fill',
  position: UnitPoint,
  sink: Sink,
): string {
  const wide = box.w / natural.w;
  const tall = box.h / natural.h;
  const uniform = fit === 'cover' ? Math.max(wide, tall) : Math.min(wide, tall);
  const scaleX = fit === 'fill' ? wide : uniform;
  const scaleY = fit === 'fill' ? tall : uniform;

  const drawn: Size = { w: natural.w * scaleX, h: natural.h * scaleY };
  // `object-position`'s arithmetic: the same fraction of the leftover, in the same
  // direction, which is what keeps this picture where `export-html` puts the same one.
  const x = (box.w - drawn.w) * position.x;
  const y = (box.h - drawn.h) * position.y;

  const parts = [
    Math.abs(x) > EPSILON || Math.abs(y) > EPSILON
      ? `translate(${svgNumber(x)} ${svgNumber(y)})`
      : '',
    scaleX === scaleY
      ? Math.abs(scaleX - 1) > EPSILON
        ? `scale(${svgNumber(scaleX)})`
        : ''
      : `scale(${svgNumber(scaleX)} ${svgNumber(scaleY)})`,
  ].filter((part) => part !== '');

  const image = element('image', [
    attribute('href', escapeXml(href)),
    attribute('width', svgNumber(natural.w)),
    attribute('height', svgNumber(natural.h)),
    attribute('preserveAspectRatio', 'none'),
    parts.length === 0 ? '' : attribute('transform', parts.join(' ')),
  ]);

  // Only `cover` can overflow, and a `cover` on a box of the picture's own proportions
  // does not. A clip path nothing crosses is a `<defs>` entry and an id for no reason.
  if (drawn.w <= box.w + EPSILON && drawn.h <= box.h + EPSILON) return image;

  const id = nextId(sink, 'crop');
  sink.defs.push(
    element(
      'clipPath',
      [attribute('id', id)],
      element('path', [attribute('d', roundedRectPath(box, [0, 0, 0, 0]))]),
    ),
  );
  return element('g', [attribute('clip-path', `url(#${id})`)], image);
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

  // User space, not `objectBoundingBox`. In bounding-box units the image's viewport is the
  // unit *square*, so `preserveAspectRatio` fits the picture to a square and the square is
  // then stretched to the node's box — which turns a circle into an ellipse on anything
  // that is not square. Giving the pattern the real box is what makes `cover` mean cover.
  //
  // A pattern is the second place `preserveAspectRatio` is dropped on import, so a measured
  // asset is cropped by hand here exactly as `imageShape` crops a node's own picture. A
  // paint carries no focal point, so it is centred.
  const natural = sink.resources.assetSize?.(paint.asset);
  const inner =
    natural === undefined
      ? element('image', [
          attribute('href', escapeXml(href)),
          attribute('width', svgNumber(size.w)),
          attribute('height', svgNumber(size.h)),
          attribute('preserveAspectRatio', aspectRatio(paint.fit)),
        ])
      : croppedImage(href, natural, size, paint.fit, CENTRED, sink);

  const id = nextId(sink, 'paint');
  sink.defs.push(
    element(
      'pattern',
      [
        attribute('id', id),
        attribute('width', svgNumber(size.w)),
        attribute('height', svgNumber(size.h)),
        attribute('patternUnits', 'userSpaceOnUse'),
      ],
      inner,
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
