import type {
  Artwork,
  Diagnostic,
  Frame,
  ImageNode,
  Matrix,
  Paint,
  RectNode,
  Scene,
  SceneNode,
  Size,
  VectorNode,
} from '@tyto/core';
import {
  type SceneVisitor,
  type VisitContext,
  diagnostic,
  invertMatrix,
  multiplyMatrix,
  nodeMatrix,
  walkFrame,
} from '@tyto/core';

import {
  type Sink,
  type SvgResources,
  approximated,
  aspectRatio,
  assetUri,
  filterMarkup,
  nextId,
  paintAttributes,
  strokeMarkup,
  unsupported,
} from './defs.js';
import { textMarkup } from './text.js';
import {
  attribute,
  element,
  escapeXml,
  isIdentity,
  roundedRectPath,
  svgColor,
  svgMatrix,
  svgNumber,
} from './values.js';

/**
 * The Scene IR as one SVG document per frame (`docs/ir-schema.md`).
 *
 * SVG nests the way the IR nests, so this is the closest of the two exporters to the tree
 * it is given: a node is a `<g>` carrying its own matrix, and the browser — or Figma, or
 * Illustrator — composes the rest. Where it differs from `export-html` is what the format
 * can say precisely. A stroke aligned `inside` is exact here and approximate there; a
 * shadow's spread is drawn here and reported there (ADR 0018). It runs the other way once:
 * SVG has no backdrop filter and no line breaking, and both are reported.
 *
 * Masks are the one place the walk is not enough. A mask is resolved when the *masked*
 * node is visited and may name a node the walk has not reached yet, so every node's
 * markup is recorded as it is produced and the `<mask>` elements are built afterwards,
 * from the recording. That also settles what a hidden mask means: `display: none` is added
 * when the tree is assembled, never when a node is recorded, so a mask that exists only to
 * be a mask still draws inside one.
 */

export interface SvgExportOptions {
  readonly resources?: SvgResources;
  /**
   * Draw every run as glyph outlines instead of `<text>`, so the document depends on no
   * font. Needs `resources.outline`; without one it is an error rather than silent text.
   */
  readonly textAsPaths?: boolean;
  /** One element per line and two spaces of indentation. On by default. */
  readonly pretty?: boolean;
}

/** A node's markup, kept apart from where it sits so a mask can put it somewhere else. */
interface Recorded {
  readonly node: SceneNode;
  readonly transform: Matrix;
  /** Everything but `transform` and `display`, both of which depend on the context. */
  readonly attributes: string;
  readonly inner: string;
}

interface Pending {
  readonly maskId: string;
  readonly node: SceneNode;
  readonly targetId: string;
  readonly inverse: Matrix;
  readonly mode: 'alpha' | 'luminance';
}

interface Frames {
  readonly sink: Sink;
  readonly recorded: Map<string, Recorded>;
  readonly pending: Pending[];
  readonly options: SvgExportOptions;
}

/* --------------------------------------------------------------------------- shapes -- */

function rectShape(node: RectNode, sink: Sink): string {
  const path = roundedRectPath(node.size, node.radius);
  const fill = element('path', [
    attribute('d', path),
    paintAttributes('fill', node.fill, node.size, node.id, sink),
  ]);
  const stroke =
    node.stroke === undefined ? '' : strokeMarkup(node.stroke, path, node.size, node.id, sink);
  return fill + stroke;
}

function vectorShape(node: VectorNode, sink: Sink): string {
  if (node.geometry.kind === 'path') {
    const fill = element('path', [
      attribute('d', escapeXml(node.geometry.d)),
      node.geometry.fillRule === 'nonzero' ? '' : attribute('fill-rule', node.geometry.fillRule),
      paintAttributes('fill', node.fill, node.size, node.id, sink),
    ]);
    const stroke =
      node.stroke === undefined
        ? ''
        : strokeMarkup(node.stroke, escapeXml(node.geometry.d), node.size, node.id, sink);
    return fill + stroke;
  }

  // A nested `<svg>` is how a file keeps its own coordinate system while taking the
  // node's size: the namespaces inside it stay the file's own, which is what "normalized"
  // means here — nothing is rewritten, because `template-lang` hands the markup over
  // verbatim and the schema calls it already sanitized.
  //
  // `fill` and `stroke` inherit into it, so a solid paint on the node reaches every shape
  // in the file that set none. A gradient would need a `<defs>` inside markup this package
  // does not rewrite, so it is reported instead of dropped.
  return element(
    'svg',
    [
      attribute('width', svgNumber(node.size.w)),
      attribute('height', svgNumber(node.size.h)),
      attribute('overflow', 'visible'),
      inheritedPaint('fill', node.fill, node, sink),
      inheritedPaint('stroke', node.stroke?.paint, node, sink),
      node.stroke === undefined ? '' : attribute('stroke-width', svgNumber(node.stroke.width)),
    ],
    node.geometry.markup,
  );
}

/** A solid paint an inline SVG file can inherit; anything else is reported and left off. */
function inheritedPaint(
  name: 'fill' | 'stroke',
  paint: Paint | undefined,
  node: VectorNode,
  sink: Sink,
): string {
  if (paint === undefined) return '';
  if (paint.kind === 'solid') {
    return (
      attribute(name, svgColor(paint.color)) +
      (paint.color.a === 1 ? '' : attribute(`${name}-opacity`, svgNumber(paint.color.a)))
    );
  }
  approximated(
    sink,
    node.id,
    `a ${name} that is not a colour over inline SVG markup`,
    'the file carries its own paint and this package does not rewrite it, so the IR paint is left off',
  );
  return '';
}

/**
 * The nine alignments `preserveAspectRatio` has, from the focal point the IR carries.
 *
 * A `UnitPoint` is continuous and `preserveAspectRatio` is not, so anything off the ninths
 * is snapped and reported. Doing it properly means an explicit transform and a clip per
 * image, which is a lot of markup for a case the template language cannot even express
 * today — `fit` is an attribute and the focal point is not.
 */
function imageShape(node: ImageNode, sink: Sink): string {
  const href = assetUri(sink, node.id, node.asset);
  if (href === undefined) return '';

  const snapped = (value: number): 'Min' | 'Mid' | 'Max' =>
    value < 0.25 ? 'Min' : value > 0.75 ? 'Max' : 'Mid';
  const exact = (value: number): boolean => value === 0 || value === 0.5 || value === 1;

  let ratio = aspectRatio(node.fit);
  if (node.fit !== 'fill') {
    const align = `x${snapped(node.position.x)}Y${snapped(node.position.y)}`;
    ratio = `${align} ${node.fit === 'cover' ? 'slice' : 'meet'}`;
    if (!exact(node.position.x) || !exact(node.position.y)) {
      approximated(
        sink,
        node.id,
        'a focal point off the thirds',
        `preserveAspectRatio has nine alignments and this one is (${svgNumber(node.position.x)}, ${svgNumber(node.position.y)}); it is snapped to ${align}`,
      );
    }
  }

  return element('image', [
    attribute('href', escapeXml(href)),
    attribute('width', svgNumber(node.size.w)),
    attribute('height', svgNumber(node.size.h)),
    attribute('preserveAspectRatio', ratio),
  ]);
}

/* ---------------------------------------------------------------------- node attributes -- */

/** The box a `clip` clips to, which a group does not have (ADR 0018). */
function clipAttribute(node: SceneNode, sink: Sink): string {
  if (!node.clip) return '';

  const size: Size | undefined =
    node.kind === 'group'
      ? undefined
      : node.kind === 'text'
        ? node.box.w !== undefined && node.box.h !== undefined
          ? { w: node.box.w, h: node.box.h }
          : undefined
        : node.size;

  if (size === undefined) {
    approximated(
      sink,
      node.id,
      node.kind === 'group' ? 'clip on a group' : 'clip on a text with no declared box',
      'there is no box to clip to; put the flag on the node that declares one',
    );
    return '';
  }

  const id = nextId(sink, 'clip');
  const radius = node.kind === 'rect' ? node.radius : ([0, 0, 0, 0] as const);
  sink.defs.push(
    element(
      'clipPath',
      [attribute('id', id)],
      element('path', [attribute('d', roundedRectPath(size, radius))]),
    ),
  );
  return attribute('clip-path', `url(#${id})`);
}

function maskAttribute(node: SceneNode, context: VisitContext, frames: Frames): string {
  const reference = node.mask;
  if (reference === undefined) return '';

  const inverse = invertMatrix(context.transform);
  if (inverse === undefined) {
    approximated(
      frames.sink,
      node.id,
      'a mask on a node scaled to nothing',
      'the node has no invertible transform, so the mask is left off',
    );
    return '';
  }

  const maskId = nextId(frames.sink, 'mask');
  frames.pending.push({
    maskId,
    node,
    targetId: reference.nodeId,
    inverse,
    mode: reference.mode,
  });
  return attribute('mask', `url(#${maskId})`);
}

/** Everything a `<g>` carries that does not depend on where in the tree it is emitted. */
function nodeAttributes(node: SceneNode, context: VisitContext, frames: Frames): string {
  return [
    node.opacity === 1 ? '' : attribute('opacity', svgNumber(node.opacity)),
    node.blend === 'normal' ? '' : attribute('style', `mix-blend-mode:${node.blend}`),
    attribute('filter', filterMarkup(node.effects, node.id, frames.sink)),
    clipAttribute(node, frames.sink),
    maskAttribute(node, context, frames),
  ].join('');
}

function record(node: SceneNode, context: VisitContext, frames: Frames, inner: string): string {
  const attributes = nodeAttributes(node, context, frames);
  frames.recorded.set(node.id, { node, transform: context.transform, attributes, inner });

  return element(
    'g',
    [
      attribute('id', escapeXml(node.id)),
      isIdentity(nodeMatrix(node)) ? '' : attribute('transform', svgMatrix(nodeMatrix(node))),
      node.visible ? '' : attribute('display', 'none'),
      attributes,
    ],
    inner,
  );
}

/* ---------------------------------------------------------------------------- masks -- */

/**
 * The `<mask>` elements, built once the walk has seen every node it could name.
 *
 * `inverse(masked) × mask` puts the mask node in the masked node's own coordinates, which
 * is the space SVG resolves a mask in — the element's `transform` establishes it, and
 * clip, mask and filter are read there.
 */
function resolveMasks(frames: Frames): void {
  for (const item of frames.pending) {
    const target = frames.recorded.get(item.targetId);
    if (target === undefined) {
      unsupported(
        frames.sink,
        item.node.id,
        'a mask naming a node outside this frame',
        `no node with the id '${item.targetId}' is drawn in this frame; a mask names a node in the same frame (docs/template-authoring.md)`,
      );
      continue;
    }

    const placement = multiplyMatrix(item.inverse, target.transform);
    const body = element(
      'g',
      [
        isIdentity(placement) ? '' : attribute('transform', svgMatrix(placement)),
        target.attributes,
      ],
      target.inner,
    );

    frames.sink.defs.push(
      element(
        'mask',
        [
          attribute('id', item.maskId),
          attribute('maskUnits', 'userSpaceOnUse'),
          // An SVG mask is luminance by default; the IR's `alpha` mode needs saying, and
          // `mask-type` is the CSS property SVG 2 reads for it.
          item.mode === 'alpha' ? attribute('style', 'mask-type:alpha') : '',
        ],
        body,
      ),
    );
  }
}

/* ------------------------------------------------------------------------ document -- */

function fontStyle(sink: Sink): string {
  const faces = [...sink.faces.values()].sort((left, right) =>
    `${left.family}|${String(left.weight)}|${left.style}`.localeCompare(
      `${right.family}|${String(right.weight)}|${right.style}`,
    ),
  );

  const rules = faces.flatMap((face) => {
    const uri = sink.resources.font?.(face);
    if (uri === undefined) {
      sink.problems.push(
        diagnostic('E_EXPORT_FONT_UNRESOLVED', {
          font: `${face.family} ${String(face.weight)} ${face.style}`,
        }),
      );
      return [];
    }
    return [
      `@font-face{font-family:"${face.family}";font-weight:${svgNumber(face.weight)};font-style:${face.style};src:url("${uri}")}`,
    ];
  });

  return rules.length === 0 ? '' : element('style', [], rules.join(''));
}

function backgroundMarkup(frame: Frame, sink: Sink): string {
  if (frame.background === undefined) return '';
  return element('rect', [
    attribute('width', svgNumber(frame.size.w)),
    attribute('height', svgNumber(frame.size.h)),
    paintAttributes('fill', frame.background, frame.size, `${frame.format} frame`, sink),
  ]);
}

/**
 * One element per line, indented by depth — except inside a `<text>`.
 *
 * That exception is the whole reason this is a scanner and not a `replaceAll('><', …)`.
 * A `<text>` carries `xml:space="preserve"`, so a newline and two spaces between two
 * `<tspan>`s are not formatting: they are a space in the artwork, and they move every
 * glyph after them. The first draft of this function did exactly that.
 */
function prettify(markup: string): string {
  let out = '';
  let depth = 0;
  let inText = 0;
  let index = 0;

  const tags = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|[^>"])*)>/gu;

  for (let match = tags.exec(markup); match !== null; match = tags.exec(markup)) {
    const [whole, slash = '', name = '', rest = ''] = match;
    out += markup.slice(index, match.index);
    index = match.index + whole.length;

    const closing = slash === '/';
    const selfClosing = rest.trimEnd().endsWith('/');

    if (closing) depth -= 1;
    if (inText === 0 && out !== '') out += `\n${'  '.repeat(Math.max(depth, 0))}`;
    out += whole;

    if (name === 'text' && !selfClosing) inText += closing ? -1 : 1;
    if (!closing && !selfClosing) depth += 1;
  }

  return out + markup.slice(index);
}

export interface SvgFrame {
  readonly artwork: Artwork;
  readonly frame: Frame;
  readonly svg: string;
}

export function renderFrame(
  scene: Scene,
  artwork: Artwork,
  frame: Frame,
  options: SvgExportOptions,
): { svg: string; problems: readonly Diagnostic[] } {
  const sink: Sink = {
    defs: [],
    faces: new Map(),
    problems: [],
    resources: options.resources ?? {},
    counter: 0,
  };
  const frames: Frames = { sink, recorded: new Map(), pending: [], options };
  const textOptions = { textAsPaths: options.textAsPaths ?? false };

  const visitor: SceneVisitor<string> = {
    group: (node, context, children) => record(node, context, frames, children.join('')),
    rect: (node, context) => record(node, context, frames, rectShape(node, sink)),
    image: (node, context) => record(node, context, frames, imageShape(node, sink)),
    vector: (node, context) => record(node, context, frames, vectorShape(node, sink)),
    text: (node, context) => record(node, context, frames, textMarkup(node, sink, textOptions)),
  };

  const children = walkFrame(scene, artwork, frame, visitor).join('');
  resolveMasks(frames);
  // Before the defs are read, not after: a frame background can be a gradient or an image,
  // and both declare an entry. The first draft built `<defs>` first and left the
  // background pointing at a `url(#…)` no element defined, which renders as nothing.
  const background = backgroundMarkup(frame, sink);

  // `<style>` last of all: which faces the document needs is only known once every run has
  // been visited, and a mask resolved after the walk can pull in one more.
  const defs = [...sink.defs, fontStyle(sink)].filter((entry) => entry !== '');
  const body =
    (defs.length === 0 ? '' : element('defs', [], defs.join(''))) + background + children;

  const document = element(
    'svg',
    [
      attribute('xmlns', 'http://www.w3.org/2000/svg'),
      attribute('width', svgNumber(frame.size.w)),
      attribute('height', svgNumber(frame.size.h)),
      attribute('viewBox', `0 0 ${svgNumber(frame.size.w)} ${svgNumber(frame.size.h)}`),
    ],
    body,
  );

  return {
    svg: (options.pretty ?? true) ? `${prettify(document)}\n` : document,
    problems: sink.problems,
  };
}
