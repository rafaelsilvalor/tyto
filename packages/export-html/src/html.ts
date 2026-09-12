import type {
  Artwork,
  AssetRef,
  Diagnostic,
  Effect,
  FontRef,
  Frame,
  GroupNode,
  ImageNode,
  Matrix,
  Paint,
  RectNode,
  Scene,
  SceneNode,
  Size,
  Stroke,
  TextNode,
  TextSpan,
  VectorNode,
  VisitContext,
} from '@tyto/core';
import {
  type SceneVisitor,
  applyMatrix,
  diagnostic,
  identityMatrix,
  identityTransform,
  invertMatrix,
  multiplyMatrix,
  nodeMatrix,
  walkFrame,
} from '@tyto/core';

import { cssIdSelector, escapeHtml, svgDataUri } from './escape.js';
import { type ShapeContext, type ShapeRegion, shapeDocument } from './svg-shapes.js';
import {
  cssBackgroundSize,
  cssColor,
  cssGradient,
  cssLength,
  cssMatrix,
  cssNumber,
  cssObjectPosition,
  cssRadius,
  isIdentity,
} from './values.js';

/**
 * The Scene IR as one self-contained HTML document per frame (`docs/ir-schema.md`).
 *
 * Two decisions shape everything below.
 *
 * **The output nests, so every element carries only its own transform.** `VisitContext`
 * offers the accumulated matrix, and using it would mean flattening the tree — which
 * would throw away exactly the thing a group is for, since `opacity`, `mix-blend-mode`,
 * `clip` and `mask` on a group are inherited by its children through the DOM and nowhere
 * else. So each element gets `nodeMatrix(node)` and the browser composes them, which is
 * the same composition `walk()` does and is why that helper lives in `core`.
 *
 * **Per-node styling goes in the stylesheet, not in `style=""`.** A mask is a whole SVG
 * document inside a `url()`, and an attribute would have to carry it through HTML
 * escaping — a snapshot full of `&lt;svg` is a snapshot nobody reviews, and the card asks
 * for reviewable ones. Ids in the IR read as paths, so the selector is escaped rather
 * than the id rewritten: `#slide-1\.feed\.copy` still says which node it is.
 */

/** One face a document needs: the family, and the weight and style text asked it for. */
export interface HtmlFontFace {
  readonly font: FontRef;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/**
 * Where the bytes come from. The package is pure (ADR 0010) and reads no files, so
 * whoever loaded the scene answers these; a resolver returning `undefined` is a
 * diagnostic, never a silent gap, because the document has to load offline.
 */
export interface HtmlResources {
  readonly asset?: (ref: AssetRef) => string | undefined;
  readonly font?: (face: HtmlFontFace) => string | undefined;
}

export interface HtmlExportOptions {
  readonly resources?: HtmlResources;
  /** Two spaces of indentation and one node per line. On by default; off for bytes. */
  readonly pretty?: boolean;
}

/** Everything one frame's rendering accumulates besides the markup itself. */
interface Emit {
  readonly frame: Frame;
  readonly resources: HtmlResources;
  readonly rules: string[];
  readonly faces: Map<string, HtmlFontFace>;
  readonly problems: Diagnostic[];
  /** Every node in the scene by id, with the matrix that puts it in its frame. */
  readonly nodes: ReadonlyMap<string, { node: SceneNode; transform: Matrix }>;
}

function unsupported(emit: Emit, node: string, feature: string, detail: string): void {
  emit.problems.push(
    diagnostic('E_EXPORT_UNSUPPORTED', { node, feature, detail, exporter: 'export-html' }),
  );
}

function approximated(emit: Emit, node: string, feature: string, detail: string): void {
  emit.problems.push(
    diagnostic('W_EXPORT_APPROXIMATED', { node, feature, detail, exporter: 'export-html' }),
  );
}

function assetUri(emit: Emit, node: string, ref: AssetRef): string | undefined {
  const uri = emit.resources.asset?.(ref);
  if (uri === undefined) {
    emit.problems.push(diagnostic('E_EXPORT_ASSET_UNRESOLVED', { asset: ref.id, node }));
    return undefined;
  }
  return uri;
}

/** The SVG renderer's channel back to this one, so both report through the same catalog. */
function shapeContext(emit: Emit): ShapeContext {
  return {
    asset: (ref) => emit.resources.asset?.(ref),
    report: (problem) => {
      if (problem.kind === 'asset') {
        emit.problems.push(
          diagnostic('E_EXPORT_ASSET_UNRESOLVED', { asset: problem.asset, node: problem.node }),
        );
        return;
      }
      unsupported(emit, problem.node, problem.feature, problem.detail);
    },
  };
}

/* -------------------------------------------------------------------------- paints -- */

/**
 * A paint as `background` declarations.
 *
 * A gradient is `background-image` rather than `background`, so a caller can set a colour
 * underneath it; an image paint carries its own `background-size`, which is the same
 * three-way choice `object-fit` makes for an `<image>` node.
 */
function backgroundDeclarations(paint: Paint, emit: Emit, node: string): readonly string[] {
  if (paint.kind === 'solid') return [`background-color: ${cssColor(paint.color)}`];

  if (paint.kind !== 'image') {
    // `cssGradient` answers for exactly the two gradient kinds, and the discriminant
    // above is what tells the compiler so; the fallback is unreachable.
    return [`background-image: ${cssGradient(paint) ?? 'none'}`];
  }

  const uri = assetUri(emit, node, paint.asset);
  if (uri === undefined) return [];
  return [
    `background-image: url("${uri}")`,
    `background-size: ${cssBackgroundSize(paint.fit)}`,
    'background-position: center',
    'background-repeat: no-repeat',
  ];
}

/* ------------------------------------------------------------------------- effects -- */

function effectDeclarations(
  effects: readonly Effect[],
  emit: Emit,
  node: string,
): readonly string[] {
  const filters: string[] = [];
  const backdrops: string[] = [];

  for (const effect of effects) {
    if (effect.kind === 'blur') {
      filters.push(`blur(${cssLength(effect.radius)})`);
      continue;
    }
    if (effect.kind === 'background-blur') {
      backdrops.push(`blur(${cssLength(effect.radius)})`);
      continue;
    }
    if (effect.spread !== 0) {
      approximated(
        emit,
        node,
        'a shadow with a spread',
        `CSS drop-shadow() has no spread, so ${cssNumber(effect.spread)}px of it is not drawn`,
      );
    }
    filters.push(
      `drop-shadow(${cssLength(effect.x)} ${cssLength(effect.y)} ${cssLength(effect.blur)} ${cssColor(effect.color)})`,
    );
  }

  return [
    ...(filters.length === 0 ? [] : [`filter: ${filters.join(' ')}`]),
    ...(backdrops.length === 0 ? [] : [`backdrop-filter: ${backdrops.join(' ')}`]),
  ];
}

/* ---------------------------------------------------------------------------- mask -- */

/**
 * The box the mask document covers, in the masked node's own coordinates.
 *
 * A node that declares a box is masked over that box and nothing else, because it paints
 * nowhere else. A group declares none and a text may leave a dimension to its content, so
 * the region falls back to the whole frame mapped back into local coordinates — larger
 * than needed and never smaller, which is the only safe direction to be wrong in.
 */
function maskRegion(node: SceneNode, inverse: Matrix, frame: Size): ShapeRegion {
  const box =
    node.kind === 'group'
      ? undefined
      : node.kind === 'text'
        ? node.box.w !== undefined && node.box.h !== undefined
          ? { w: node.box.w, h: node.box.h }
          : undefined
        : node.size;

  if (box !== undefined) return { x: 0, y: 0, w: box.w, h: box.h };

  const corners = [
    { x: 0, y: 0 },
    { x: frame.w, y: 0 },
    { x: frame.w, y: frame.h },
    { x: 0, y: frame.h },
  ].map((corner) => applyMatrix(inverse, corner));

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function maskDeclarations(node: SceneNode, context: VisitContext, emit: Emit): readonly string[] {
  const reference = node.mask;
  if (reference === undefined) return [];

  const target = emit.nodes.get(reference.nodeId);
  if (target === undefined) {
    unsupported(emit, node.id, 'a mask', `no node in the scene has the id '${reference.nodeId}'`);
    return [];
  }

  const inverse = invertMatrix(context.transform);
  if (inverse === undefined) {
    approximated(
      emit,
      node.id,
      'a mask on a node scaled to nothing',
      'the node has no invertible transform, so the mask is left off',
    );
    return [];
  }

  const region = maskRegion(node, inverse, emit.frame.size);
  const markup = shapeDocument(
    target.node,
    multiplyMatrix(inverse, target.transform),
    region,
    shapeContext(emit),
  );

  if (markup === '') return [];

  return [
    `mask-image: url("${svgDataUri(markup)}")`,
    `mask-size: ${cssLength(region.w)} ${cssLength(region.h)}`,
    `mask-position: ${cssLength(region.x)} ${cssLength(region.y)}`,
    'mask-repeat: no-repeat',
    `mask-mode: ${reference.mode}`,
  ];
}

/* --------------------------------------------------------------------------- nodes -- */

/**
 * `clip`, which only means something on a node that has a box.
 *
 * A group has no size in the IR, so its element is a 0×0 box its children overflow —
 * `overflow: hidden` on that would hide the entire group rather than clip it. There is
 * nothing to clip to and nothing to clip: a child is inside its own box by construction,
 * so the honest answer is to leave the flag off and say so once.
 */
function clipDeclarations(node: SceneNode, emit: Emit): readonly string[] {
  if (!node.clip) return [];
  if (node.kind !== 'group') return ['overflow: hidden'];

  approximated(
    emit,
    node.id,
    'clip on a group',
    'a group has no box in the IR, so there is nothing to clip to; put the flag on the rect or image that defines the box',
  );
  return [];
}

/** What every node carries, whatever it draws. */
function baseDeclarations(node: SceneNode, context: VisitContext, emit: Emit): string[] {
  const matrix = nodeMatrix(node);

  return [
    ...(isIdentity(matrix) ? [] : [`transform: ${cssMatrix(matrix)}`]),
    ...(node.opacity === 1 ? [] : [`opacity: ${cssNumber(node.opacity)}`]),
    ...(node.blend === 'normal' ? [] : [`mix-blend-mode: ${node.blend}`]),
    ...(node.visible ? [] : ['display: none']),
    ...clipDeclarations(node, emit),
    ...effectDeclarations(node.effects, emit, node.id),
    ...maskDeclarations(node, context, emit),
  ];
}

function sizeDeclarations(size: Size): readonly string[] {
  return [`width: ${cssLength(size.w)}`, `height: ${cssLength(size.h)}`];
}

/**
 * A solid stroke as an `outline`, offset by where the IR says it sits.
 *
 * `outline` is the only CSS ring that follows `border-radius` without eating into the
 * box the way `border` does, and a negative `outline-offset` is what moves it inwards. A
 * stroke painted with anything but a colour has no CSS ring at all, and the rect is drawn
 * as SVG instead — see `rectHtml`.
 */
function outlineDeclarations(stroke: Stroke): readonly string[] {
  if (stroke.paint.kind !== 'solid') return [];
  const offset =
    stroke.align === 'outside' ? 0 : stroke.align === 'inside' ? -stroke.width : -stroke.width / 2;
  return [
    `outline: ${cssLength(stroke.width)} solid ${cssColor(stroke.paint.color)}`,
    `outline-offset: ${cssLength(offset)}`,
  ];
}

/* ------------------------------------------------------------------------ the sheet -- */

function addRule(emit: Emit, id: string, declarations: readonly string[]): void {
  if (declarations.length === 0) return;
  emit.rules.push(`${cssIdSelector(id)} { ${declarations.join('; ')}; }`);
}

/* ---------------------------------------------------------------------------- text -- */

function fontKey(face: HtmlFontFace): string {
  return `${face.font.family}|${String(face.weight)}|${face.style}`;
}

function runDeclarations(run: TextSpan, nodeId: string, emit: Emit): string[] {
  emit.faces.set(fontKey({ font: run.font, weight: run.weight, style: run.style }), {
    font: run.font,
    weight: run.weight,
    style: run.style,
  });

  const paint =
    run.color.kind === 'solid'
      ? [`color: ${cssColor(run.color.color)}`]
      : // A gradient has to be painted behind the glyphs and clipped to them; there is no
        // other way to put one inside a letter, and it is what `background-clip` is for.
        [
          ...backgroundDeclarations(run.color, emit, nodeId),
          'background-clip: text',
          'color: transparent',
        ];

  return [
    `font-family: "${run.font.family}"`,
    `font-size: ${cssLength(run.size)}`,
    `font-weight: ${cssNumber(run.weight)}`,
    ...(run.style === 'normal' ? [] : [`font-style: ${run.style}`]),
    ...paint,
    ...(run.decoration === undefined ? [] : [`text-decoration-line: ${run.decoration}`]),
  ];
}

/**
 * The run whose face the node's line boxes are built from: the largest, ties to the first.
 *
 * A block's line box is at least as tall as its **strut** — an invisible zero-width box
 * carrying the block's own font and `line-height` — and a `<div>` that declares neither
 * gets the document's defaults, which is Times New Roman at 16px. That is how a node
 * asking for `lineHeight: 1.45` over a single 15px run laid out at 23.75px per line
 * instead of 21.75: a strut nobody wrote, made of a font nobody bundled.
 *
 * The largest run rather than the first, because the strut has to be the tallest thing in
 * the line or it decides nothing: CSS gives a line box the height of its tallest inline
 * box, so a strut under the biggest run would leave the leading to that run and a node
 * with two sizes would space its lines by whichever one happened to be there. Sized to the
 * largest, every line of the node advances by `lineHeight × that size` — one leading per
 * node, which is the one the IR declares (`docs/ir-schema.md`).
 */
function referenceRun(node: TextNode): TextSpan | undefined {
  let largest: TextSpan | undefined;
  for (const run of node.runs) {
    if (run.kind !== 'text') continue;
    if (largest === undefined || run.size > largest.size) largest = run;
  }
  return largest;
}

/**
 * `font-family`, `font-size` and `font-weight` for the node itself, so the strut is a face
 * the document actually embeds rather than the browser's default.
 *
 * Every span writes all three of its own, so putting them here changes no run — it only
 * gives the block the metrics its line boxes are measured against.
 */
function strutDeclarations(node: TextNode): string[] {
  const run = referenceRun(node);
  // A node whose runs are all breaks draws nothing, and there is no face to name.
  if (run === undefined) return [];

  return [
    `font-family: "${run.font.family}"`,
    `font-size: ${cssLength(run.size)}`,
    `font-weight: ${cssNumber(run.weight)}`,
  ];
}

const VERTICAL_ALIGN: Readonly<Record<TextNode['valign'], string>> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

function textDeclarations(node: TextNode, emit: Emit, context: VisitContext): string[] {
  if (node.overflow === 'shrink') {
    approximated(
      emit,
      node.id,
      "overflow: 'shrink'",
      'nothing has measured the text yet, so it is clipped like overflow: clip until E4.5 resizes it in the IR',
    );
  }

  return [
    ...baseDeclarations(node, context, emit),
    // An absent dimension means "as large as the content needs", which is what
    // `max-content` says; a declared one is a box the text wraps inside.
    `width: ${node.box.w === undefined ? 'max-content' : cssLength(node.box.w)}`,
    ...(node.box.h === undefined ? [] : [`height: ${cssLength(node.box.h)}`]),
    'display: flex',
    'flex-direction: column',
    `justify-content: ${VERTICAL_ALIGN[node.valign]}`,
    `text-align: ${node.align}`,
    // Before `line-height`, because the number below is a multiple of the size above and a
    // reader should meet them in that order.
    ...strutDeclarations(node),
    `line-height: ${cssNumber(node.lineHeight)}`,
    ...(node.letterSpacing === 0 ? [] : [`letter-spacing: ${cssLength(node.letterSpacing)}`]),
    // Runs carry their own spaces and the IR says where the lines end, so neither
    // collapsing whitespace nor breaking on it is this exporter's decision to make.
    'white-space: pre-wrap',
    ...(node.overflow === 'grow' || node.clip ? [] : ['overflow: hidden']),
  ];
}

function textHtml(node: TextNode, emit: Emit): string {
  const spans = node.runs
    .map((run) =>
      run.kind === 'break'
        ? '<br>'
        : `<span style="${escapeHtml(runDeclarations(run, node.id, emit).join('; '))}">${escapeHtml(run.text)}</span>`,
    )
    .join('');
  return `<div>${spans}</div>`;
}

/* ------------------------------------------------------------------- the node kinds -- */

function attributesFor(node: SceneNode): string {
  const name = node.name === undefined ? '' : ` data-name="${escapeHtml(node.name)}"`;
  return ` id="${escapeHtml(node.id)}" class="tyto-node"${name}`;
}

function radiusDeclaration(radius: RectNode['radius']): readonly string[] {
  const value = cssRadius(radius);
  return value === undefined ? [] : [`border-radius: ${value}`];
}

function rectHtml(node: RectNode, context: VisitContext, emit: Emit): string {
  // A stroke painted with a gradient or an image has no CSS ring, so the whole rect drops
  // to the SVG renderer the masks already use rather than losing the paint.
  if (node.stroke !== undefined && node.stroke.paint.kind !== 'solid') {
    if (node.stroke.align !== 'center') {
      approximated(
        emit,
        node.id,
        `a ${node.stroke.align} stroke that is not a colour`,
        'the rect is drawn as SVG to keep the paint, and an SVG stroke straddles the outline; it is drawn centred',
      );
    }
    return svgRectHtml(node, context, emit);
  }

  addRule(emit, node.id, [
    ...baseDeclarations(node, context, emit),
    ...sizeDeclarations(node.size),
    ...(node.fill === undefined ? [] : backgroundDeclarations(node.fill, emit, node.id)),
    ...radiusDeclaration(node.radius),
    ...(node.stroke === undefined ? [] : outlineDeclarations(node.stroke)),
  ]);

  return `<div${attributesFor(node)}></div>`;
}

function svgRectHtml(node: RectNode, context: VisitContext, emit: Emit): string {
  addRule(emit, node.id, [
    ...baseDeclarations(node, context, emit),
    ...sizeDeclarations(node.size),
  ]);

  // The wrapper div already carries the transform, the opacity and the mask, so the SVG
  // draws the shape alone, at the origin, at the node's own size.
  const bare = { ...node, transform: identityTransform, opacity: 1, effects: [] };
  const markup = shapeDocument(
    bare,
    identityMatrix,
    { x: 0, y: 0, w: node.size.w, h: node.size.h },
    shapeContext(emit),
  );

  return `<div${attributesFor(node)}>${markup}</div>`;
}

function imageHtml(node: ImageNode, context: VisitContext, emit: Emit): string {
  const uri = assetUri(emit, node.id, node.asset);

  addRule(emit, node.id, [
    ...baseDeclarations(node, context, emit),
    ...sizeDeclarations(node.size),
    `object-fit: ${node.fit === 'fill' ? 'fill' : node.fit}`,
    `object-position: ${cssObjectPosition(node.position)}`,
  ]);

  if (uri === undefined) return `<div${attributesFor(node)}></div>`;
  return `<img${attributesFor(node)} src="${escapeHtml(uri)}" alt="">`;
}

function vectorHtml(node: VectorNode, context: VisitContext, emit: Emit): string {
  const paint = node.geometry.kind === 'svg' ? svgGeometryPaint(node, emit) : [];

  addRule(emit, node.id, [
    ...baseDeclarations(node, context, emit),
    ...sizeDeclarations(node.size),
    ...paint,
  ]);

  if (node.geometry.kind === 'svg') {
    // The file is inlined as it stands — `template-lang` hands it over verbatim and the
    // schema calls it already sanitized — and the stylesheet stretches it to the node's
    // box, which is the one thing the file cannot know.
    return `<div${attributesFor(node)}>${node.geometry.markup}</div>`;
  }

  const fill = node.fill === undefined ? '' : svgPaintAttribute('fill', node.fill, node, emit);
  const stroke =
    node.stroke === undefined
      ? ''
      : `${svgPaintAttribute('stroke', node.stroke.paint, node, emit)} stroke-width="${cssNumber(node.stroke.width)}"`;
  const rule = node.geometry.fillRule === 'nonzero' ? '' : ` fill-rule="${node.geometry.fillRule}"`;

  return `<svg${attributesFor(node)} viewBox="0 0 ${cssNumber(node.size.w)} ${cssNumber(node.size.h)}"><path d="${escapeHtml(node.geometry.d)}"${rule}${fill}${stroke}/></svg>`;
}

/**
 * A vector's own `fill`/`stroke` over inline SVG markup, which the markup may override.
 *
 * CSS `fill` and `stroke` inherit into an inline SVG, so a solid paint reaches every
 * shape that did not set its own. A gradient does not inherit that way — it would need a
 * `<defs>` inside markup this package may not rewrite — so it is reported rather than
 * silently dropped.
 */
function svgGeometryPaint(node: VectorNode, emit: Emit): readonly string[] {
  const declarations: string[] = [];

  for (const [property, paint] of [
    ['fill', node.fill],
    ['stroke', node.stroke?.paint],
  ] as const) {
    if (paint === undefined) continue;
    if (paint.kind === 'solid') {
      declarations.push(`${property}: ${cssColor(paint.color)}`);
      continue;
    }
    approximated(
      emit,
      node.id,
      `a ${property} that is not a colour over inline SVG markup`,
      'the markup carries its own paint and this package does not rewrite it, so the IR paint is left off',
    );
  }

  if (node.stroke !== undefined) declarations.push(`stroke-width: ${cssNumber(node.stroke.width)}`);
  return declarations;
}

function svgPaintAttribute(
  attribute: 'fill' | 'stroke',
  paint: Paint,
  node: VectorNode,
  emit: Emit,
): string {
  if (paint.kind === 'solid') {
    const alpha = paint.color.a === 1 ? '' : ` ${attribute}-opacity="${cssNumber(paint.color.a)}"`;
    return ` ${attribute}="${cssColor({ ...paint.color, a: 1 })}"${alpha}`;
  }
  approximated(
    emit,
    node.id,
    `a ${attribute} that is not a colour on a path`,
    'gradients on a path arrive with export-svg (E5.2); the paint is left off here',
  );
  return ` ${attribute}="none"`;
}

function groupHtml(
  node: GroupNode,
  context: VisitContext,
  emit: Emit,
  children: readonly string[],
): string {
  addRule(emit, node.id, baseDeclarations(node, context, emit));
  // A group has no box in the IR, so it gets none here either: `overflow: visible` on a
  // zero-sized box is what lets children sit wherever their own transforms put them.
  return `<div${attributesFor(node)}>${children.join('')}</div>`;
}

/* --------------------------------------------------------------------- the document -- */

function frameDeclarations(frame: Frame, emit: Emit): readonly string[] {
  return [
    `width: ${cssLength(frame.size.w)}`,
    `height: ${cssLength(frame.size.h)}`,
    ...(frame.background === undefined
      ? []
      : backgroundDeclarations(frame.background, emit, `${emit.frame.format} frame`)),
  ];
}

function fontFaceRules(emit: Emit): readonly string[] {
  return [...emit.faces.values()]
    .sort((left, right) => fontKey(left).localeCompare(fontKey(right)))
    .flatMap((face) => {
      const uri = emit.resources.font?.(face);
      if (uri === undefined) {
        emit.problems.push(
          diagnostic('E_EXPORT_FONT_UNRESOLVED', {
            font: `${face.font.family} ${String(face.weight)} ${face.style}`,
          }),
        );
        return [];
      }
      return [
        `@font-face { font-family: "${face.font.family}"; font-weight: ${cssNumber(face.weight)}; font-style: ${face.style}; src: url("${uri}"); }`,
      ];
    });
}

/**
 * The rules every document starts with.
 *
 * `position: absolute` on every node and `transform-origin: 0 0` under it are what make
 * the matrix mean what the IR means: the element's own coordinates start at its parent's
 * origin, and the matrix moves them from there.
 */
const RESET = [
  '* { margin: 0; padding: 0; border: 0; box-sizing: border-box; }',
  'html, body { background: transparent; }',
  '.tyto-frame { position: relative; overflow: hidden; }',
  '.tyto-node { position: absolute; left: 0; top: 0; transform-origin: 0 0; }',
  '.tyto-node > svg { display: block; width: 100%; height: 100%; }',
];

const INDENT = '      ';

function document(title: string, styles: readonly string[], body: string, pretty: boolean): string {
  const sheet = pretty ? styles.map((rule) => `${INDENT}${rule}`).join('\n') : styles.join('');
  const head = pretty
    ? `  <head>\n    <meta charset="utf-8">\n    <title>${escapeHtml(title)}</title>\n    <style>\n${sheet}\n    </style>\n  </head>`
    : `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${sheet}</style></head>`;
  const bodyMarkup = pretty ? `  <body>\n    ${body}\n  </body>` : `<body>${body}</body>`;

  return pretty
    ? `<!doctype html>\n<html>\n${head}\n${bodyMarkup}\n</html>\n`
    : `<!doctype html><html>${head}${bodyMarkup}</html>`;
}

/** Every node in the scene by id, with the matrix that puts it in its own frame. */
function indexNodes(scene: Scene): Map<string, { node: SceneNode; transform: Matrix }> {
  const index = new Map<string, { node: SceneNode; transform: Matrix }>();

  const collector: SceneVisitor<undefined> = {
    group: (node, context) => {
      index.set(node.id, { node, transform: context.transform });
      return undefined;
    },
    rect: (node, context) => {
      index.set(node.id, { node, transform: context.transform });
      return undefined;
    },
    text: (node, context) => {
      index.set(node.id, { node, transform: context.transform });
      return undefined;
    },
    image: (node, context) => {
      index.set(node.id, { node, transform: context.transform });
      return undefined;
    },
    vector: (node, context) => {
      index.set(node.id, { node, transform: context.transform });
      return undefined;
    },
  };

  for (const artwork of scene.artworks) {
    for (const frame of artwork.frames) walkFrame(scene, artwork, frame, collector);
  }

  return index;
}

export interface HtmlFrame {
  readonly artwork: Artwork;
  readonly frame: Frame;
  readonly html: string;
}

/**
 * One frame as a document, plus everything the exporter had to say about it.
 *
 * The problems come back beside the string rather than replacing it: a warning is a
 * document that still renders (ADR 0013), and even an error leaves markup a human can
 * open to see what went missing.
 */
export function renderFrame(
  scene: Scene,
  artwork: Artwork,
  frame: Frame,
  options: HtmlExportOptions,
  nodes: ReadonlyMap<string, { node: SceneNode; transform: Matrix }>,
): { html: string; problems: readonly Diagnostic[] } {
  const emit: Emit = {
    frame,
    resources: options.resources ?? {},
    rules: [],
    faces: new Map(),
    problems: [],
    nodes,
  };

  const visitor: SceneVisitor<string> = {
    group: (node, context, children) => groupHtml(node, context, emit, children),
    rect: (node, context) => rectHtml(node, context, emit),
    image: (node, context) => imageHtml(node, context, emit),
    vector: (node, context) => vectorHtml(node, context, emit),
    text: (node, context) => {
      addRule(emit, node.id, textDeclarations(node, emit, context));
      return `<div${attributesFor(node)}>${textHtml(node, emit)}</div>`;
    },
  };

  const children = walkFrame(scene, artwork, frame, visitor).join('');
  const frameId = `${artwork.id}:${frame.format}`;

  // The faces are only known once every run has been visited, so the `@font-face` rules
  // are built last and put first — which is also the order a browser wants them in.
  const styles = [
    ...RESET,
    ...fontFaceRules(emit),
    `.tyto-frame { ${frameDeclarations(frame, emit).join('; ')}; }`,
    ...emit.rules,
  ];

  const body = `<div class="tyto-frame">${children}</div>`;

  return {
    html: document(frameId, styles, body, options.pretty ?? true),
    problems: emit.problems,
  };
}

export { indexNodes };
