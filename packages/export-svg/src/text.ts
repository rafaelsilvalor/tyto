import type { TextNode, TextSpan } from '@tyto/core';

import { type Sink, approximated, paintAttributes, paintValue, unsupported } from './defs.js';
import { attribute, element, escapeXml, svgNumber } from './values.js';

/**
 * Text laid out by hand, because SVG lays out nothing.
 *
 * HTML gets this for free: `export-html` hands a browser a box and runs and the browser
 * decides where the baselines are. SVG has no line box and no wrapping, so every `y` in
 * the output is a number this file computed — which makes the two things it cannot know
 * the honest edge of this exporter:
 *
 * **No wrapping.** A `box.w` in the IR means "wrap here", and wrapping needs the width of
 * a laid-out string. Until E4.5 measures text, the lines in an SVG are exactly the
 * `LineBreak` runs the brief wrote (ADR 0016) — so a paragraph that wraps in the HTML
 * export runs off the box here. This is a documented limit rather than a per-node warning:
 * an author cannot act on it, and a warning on every text node is a warning nobody reads.
 *
 * **An approximated ascent.** A baseline sits an ascent below the top of its line, and an
 * ascent is a font metric. `ASCENT` below is the usual stand-in until the real number
 * arrives with the font machinery; it is one constant in one place so that replacing it is
 * a single edit.
 */

/** Ascent as a fraction of the em, the stand-in until E4.5 reads the real metric. */
const ASCENT = 0.8;

interface Line {
  readonly runs: readonly TextSpan[];
  /** The tallest run decides the line, which is what a line box does. */
  readonly size: number;
}

/** The runs split at every break; a break between two breaks makes an empty line. */
function linesOf(node: TextNode): Line[] {
  const lines: Line[] = [];
  let current: TextSpan[] = [];

  const flush = (): void => {
    const size = current.reduce((tallest, run) => Math.max(tallest, run.size), 0);
    lines.push({ runs: current, size: size === 0 ? fallbackSize(node) : size });
    current = [];
  };

  for (const run of node.runs) {
    if (run.kind === 'break') flush();
    else current.push(run);
  }
  flush();

  return lines;
}

/** An empty line still takes vertical space, and it takes the text's own leading. */
function fallbackSize(node: TextNode): number {
  const first = node.runs.find((run) => run.kind === 'text');
  return first === undefined ? 0 : first.size;
}

/**
 * The x of a line and the anchor that reads it, from `align`.
 *
 * `justify` has no SVG equivalent — there is no line box to stretch — so it draws as
 * `left` and says so. Centre and right need a box to be centred in; a text that declared
 * no width has nothing to measure against and draws from the origin.
 */
function anchorOf(
  node: TextNode,
  sink: Sink,
): { readonly x: number; readonly anchor: string | undefined } {
  if (node.align === 'justify') {
    approximated(
      sink,
      node.id,
      "align: 'justify'",
      'SVG has no line box to stretch, so the text is drawn left-aligned',
    );
    return { x: 0, anchor: undefined };
  }
  if (node.align === 'left') return { x: 0, anchor: undefined };

  const width = node.box.w;
  if (width === undefined) {
    approximated(
      sink,
      node.id,
      `align: '${node.align}' on a text that declares no width`,
      'there is nothing to align against, so the text is drawn from its origin',
    );
    return { x: 0, anchor: undefined };
  }

  return node.align === 'center' ? { x: width / 2, anchor: 'middle' } : { x: width, anchor: 'end' };
}

/** Where the first line's top sits, from `valign` and the height the lines add up to. */
function verticalOffset(node: TextNode, lines: readonly Line[], sink: Sink): number {
  if (node.valign === 'top') return 0;

  const height = node.box.h;
  if (height === undefined) {
    approximated(
      sink,
      node.id,
      `valign: '${node.valign}' on a text that declares no height`,
      'there is nothing to centre in, so the text is drawn from its top',
    );
    return 0;
  }

  const total = lines.reduce((sum, line) => sum + line.size * node.lineHeight, 0);
  return node.valign === 'middle' ? (height - total) / 2 : height - total;
}

function runAttributes(run: TextSpan, node: TextNode, sink: Sink): string {
  return [
    attribute('font-family', escapeXml(run.font.family)),
    attribute('font-size', svgNumber(run.size)),
    attribute('font-weight', svgNumber(run.weight)),
    run.style === 'normal' ? '' : attribute('font-style', run.style),
    paintAttributes('fill', run.color, { w: node.box.w ?? 0, h: run.size }, node.id, sink),
    run.decoration === undefined ? '' : attribute('text-decoration', run.decoration),
  ].join('');
}

function remember(run: TextSpan, sink: Sink): void {
  sink.faces.set(`${run.font.family}|${String(run.weight)}|${run.style}`, {
    family: run.font.family,
    weight: run.weight,
    style: run.style,
  });
}

/** `<text>` with one positioned `<tspan>` per line and a nested one per run. */
function textElement(node: TextNode, lines: readonly Line[], sink: Sink): string {
  const { x, anchor } = anchorOf(node, sink);
  let top = verticalOffset(node, lines, sink);

  const spans = lines.map((line) => {
    // Half-leading above the glyphs and half below, then the ascent: the same place a
    // browser puts the first baseline, which is what keeps the two exports aligned.
    const leading = (line.size * node.lineHeight - line.size) / 2;
    const baseline = top + leading + line.size * ASCENT;
    top += line.size * node.lineHeight;

    const runs = line.runs
      .map((run) => {
        remember(run, sink);
        return element('tspan', [runAttributes(run, node, sink)], escapeXml(run.text));
      })
      .join('');

    return element(
      'tspan',
      [attribute('x', svgNumber(x)), attribute('y', svgNumber(baseline))],
      runs === '' ? ' ' : runs,
    );
  });

  return element(
    'text',
    [
      attribute('text-anchor', anchor),
      node.letterSpacing === 0 ? '' : attribute('letter-spacing', svgNumber(node.letterSpacing)),
      // The runs carry their own spaces and the IR says where the lines end, so neither
      // collapsing whitespace nor breaking on it is this exporter's decision.
      attribute('xml:space', 'preserve'),
    ],
    spans.join(''),
  );
}

/**
 * The same lines as glyph outlines, for a document that must not depend on a font at all.
 *
 * `--text-as-paths` exists because an SVG with `@font-face` renders differently wherever
 * the face fails to load, and a print shop or a design tool is exactly where that happens.
 * The outlines come from the caller: this package is pure and owns no font parser, so a
 * request nobody can answer is an error rather than text quietly left as text.
 */
function pathElement(node: TextNode, lines: readonly Line[], sink: Sink): string | undefined {
  const outline = sink.resources.outline;
  if (outline === undefined) {
    unsupported(
      sink,
      node.id,
      'text as paths',
      'no outline resolver was supplied, and this package reads no fonts; pass resources.outline or leave textAsPaths off',
    );
    return undefined;
  }

  const { x: anchorX, anchor } = anchorOf(node, sink);
  let top = verticalOffset(node, lines, sink);
  const parts: string[] = [];

  for (const line of lines) {
    const leading = (line.size * node.lineHeight - line.size) / 2;
    const baseline = top + leading + line.size * ASCENT;
    top += line.size * node.lineHeight;

    const drawn = line.runs.map((run) => ({
      run,
      shape: outline({
        text: run.text,
        family: run.font.family,
        size: run.size,
        weight: run.weight,
        style: run.style,
        letterSpacing: node.letterSpacing,
      }),
    }));

    const missing = drawn.find((item) => item.shape === undefined);
    if (missing !== undefined) {
      unsupported(
        sink,
        node.id,
        'text as paths',
        `the outline resolver had no glyphs for '${missing.run.font.family}' at weight ${String(missing.run.weight)}`,
      );
      return undefined;
    }

    const width = drawn.reduce((sum, item) => sum + (item.shape?.advance ?? 0), 0);
    // `text-anchor` has no meaning for a path, so the line is shifted by hand instead.
    let pen =
      anchor === 'middle' ? anchorX - width / 2 : anchor === 'end' ? anchorX - width : anchorX;

    for (const item of drawn) {
      if (item.shape === undefined) continue;
      const paint = paintValue(item.run.color, { w: width, h: item.run.size }, node.id, sink);
      parts.push(
        element('path', [
          attribute('d', item.shape.d),
          attribute('transform', `translate(${svgNumber(pen)} ${svgNumber(baseline)})`),
          attribute('fill', paint?.value ?? 'none'),
          paint === undefined || paint.opacity === 1
            ? ''
            : attribute('fill-opacity', svgNumber(paint.opacity)),
        ]),
      );
      pen += item.shape.advance;
    }
  }

  return parts.join('');
}

export interface TextOptions {
  readonly textAsPaths: boolean;
}

/** What a `<text>` node draws, as `<text>` or as paths. Empty when it cannot be drawn. */
export function textMarkup(node: TextNode, sink: Sink, options: TextOptions): string {
  const lines = linesOf(node);
  if (options.textAsPaths) return pathElement(node, lines, sink) ?? '';
  return textElement(node, lines, sink);
}
