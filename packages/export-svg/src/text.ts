import { type FormulaRun, type TextNode, type TextSpan, fontFaceKey } from '@tyto/core';

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
  readonly runs: readonly (TextSpan | FormulaRun)[];
  /** The tallest run decides the line, which is what a line box does. */
  readonly size: number;
  /** The px a paragraph boundary puts above this line (ADR 0205); 0 for none. */
  readonly space: number;
  /** How far the line's formulas reach past its strut, above and below (ADR 0206). */
  readonly above: number;
  readonly below: number;
}

/**
 * A formula nobody laid out (its face could not be measured) is drawn as its linear reading,
 * in its own style, as `export-html` draws it (ADR 0206).
 */
function asDrawn(run: TextSpan | FormulaRun): TextSpan | FormulaRun {
  if (run.kind === 'text' || run.layout !== undefined) return run;
  return {
    kind: 'text',
    text: run.text,
    font: run.font,
    size: run.size,
    weight: run.weight,
    style: run.style,
    color: run.color,
  };
}

/** The total height a line takes: its leading, and what its formulas add (ADR 0206). */
function lineHeightOf(line: Line, node: TextNode): number {
  return line.size * node.lineHeight + line.above + line.below;
}

/**
 * The runs split at every break; a break between two breaks makes an empty line. The line
 * after a paragraph boundary carries the boundary's space above it (ADR 0205).
 */
function linesOf(node: TextNode): Line[] {
  const lines: Line[] = [];
  let current: (TextSpan | FormulaRun)[] = [];
  let space = 0;

  const flush = (): void => {
    const size = current.reduce((tallest, run) => Math.max(tallest, run.size), 0);
    // Every formula on a line carries the same growth, the line's (ADR 0206).
    const layouts = current.flatMap((run) =>
      run.kind === 'formula' && run.layout !== undefined ? [run.layout] : [],
    );
    lines.push({
      runs: current,
      size: size === 0 ? fallbackSize(node) : size,
      space,
      above: Math.max(0, ...layouts.map((layout) => layout.above)),
      below: Math.max(0, ...layouts.map((layout) => layout.below)),
    });
    current = [];
  };

  for (const run of node.runs) {
    if (run.kind === 'break') {
      flush();
      space = run.space ?? 0;
    } else current.push(asDrawn(run));
  }
  flush();

  return lines;
}

/** An empty line still takes vertical space, and it takes the text's own leading. */
function fallbackSize(node: TextNode): number {
  const first = node.runs.find((run) => run.kind !== 'break');
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

  const total = lines.reduce((sum, line) => sum + line.space + lineHeightOf(line, node), 0);
  return node.valign === 'middle' ? (height - total) / 2 : height - total;
}

/** One word a CSS font-family may leave unquoted: an identifier, so not led by a digit. */
const IDENTIFIER = /^-?[_a-zA-Z\u0080-\uFFFF][-_a-zA-Z0-9\u0080-\uFFFF]*$/u;

/**
 * A family as the `font-family` property reads it, quoted only when it has to be.
 *
 * An unquoted family is a list of identifiers, and `3` is not one: `font-family="Source
 * Sans 3"` is an invalid declaration, which the browser drops and draws the fallback face
 * instead (TYTO-491 found it, `document.fonts` reporting the embedded face never loaded).
 * A family of plain words keeps its bytes, which is every family that rendered correctly.
 */
function cssFamily(family: string): string {
  const plain = family.split(' ').every((word) => IDENTIFIER.test(word) && !word.startsWith('--'));
  return plain ? family : `"${family.replaceAll(/["\\]/gu, (character) => `\\${character}`)}"`;
}

function runAttributes(
  run: Pick<TextSpan, 'font' | 'size' | 'weight' | 'style' | 'color' | 'decoration'>,
  node: TextNode,
  sink: Sink,
): string {
  return [
    attribute('font-family', escapeXml(cssFamily(run.font.family))),
    attribute('font-size', svgNumber(run.size)),
    attribute('font-weight', svgNumber(run.weight)),
    run.style === 'normal' ? '' : attribute('font-style', run.style),
    paintAttributes('fill', run.color, { w: node.box.w ?? 0, h: run.size }, node.id, sink),
    run.decoration === undefined ? '' : attribute('text-decoration', run.decoration),
  ].join('');
}

function remember(run: Pick<TextSpan, 'font' | 'weight' | 'style'>, sink: Sink): void {
  const face = { font: run.font, weight: run.weight, style: run.style };
  // `core`'s key, so a document's faces deduplicate exactly as `sceneResources` counts
  // them — which is what lets a loader be given the list and the exporter find every entry.
  sink.faces.set(fontFaceKey(face), face);
}

/**
 * One `<text>` per line, each holding a `<tspan>` per run.
 *
 * The obvious shape is one `<text>` with a positioned `<tspan>` per line, and that is what
 * this drew until TYTO-60. Figma imports such a document as a single text layer with every
 * line concatenated — the two lines of the `mapping` fixture arrived as one 34px-tall
 * layer named `Turma nova<matrículas & vagas>` — because a text node in Figma has one
 * position, and the `y` on each `<tspan>` has nowhere to go. A `<text>` per line is the
 * same picture in a browser, since every baseline was already an absolute number this file
 * computed, and it is as many layers as there are lines in a design tool.
 *
 * An empty line is skipped rather than drawn as a `<text>` holding a space. It still takes
 * its vertical room — `top` advances either way — but it has nothing to draw, and what a
 * designer would get for it is an empty layer to delete.
 */
function textElement(node: TextNode, lines: readonly Line[], sink: Sink): string {
  const { x: anchorX, anchor } = anchorOf(node, sink);
  // `letter-spacing` follows every glyph, the last one too, and `text-anchor` measures the
  // line with it, so a tracked line would sit half its spacing left of centre, or its whole
  // spacing short of the edge (TYTO-491). Moving the anchor by that space aligns the ink,
  // which is what export-html aligns. A line drawn from the start needs nothing.
  const trailing = node.letterSpacing;
  const x =
    anchor === 'middle' ? anchorX + trailing / 2 : anchor === 'end' ? anchorX + trailing : anchorX;
  let top = verticalOffset(node, lines, sink);
  const drawn: string[] = [];

  for (const line of lines) {
    // A paragraph's space first, then what a formula adds above the line, then half-leading
    // above the glyphs and half below, then the ascent: the same place a browser puts the
    // first baseline, which is what keeps the two exports aligned.
    top += line.space;
    const leading = (line.size * node.lineHeight - line.size) / 2;
    const baseline = top + line.above + leading + line.size * ASCENT;
    top += lineHeightOf(line, node);

    if (line.runs.length === 0) continue;

    // A line holding a formula starts where core says the line starts, and is drawn from
    // there: the formula sits at an offset from that start, and the text after it skips the
    // formula's width with `dx`. SVG measures nothing, so the IR's numbers decide (ADR 0206).
    const formula = line.runs.find(
      (run): run is FormulaRun => run.kind === 'formula' && run.layout !== undefined,
    );
    const start =
      formula?.layout === undefined
        ? x
        : lineStart(formula.layout.lineWidth, anchorX, anchor, trailing);
    let skip = 0;
    const formulas: string[] = [];
    const runs = line.runs
      .map((run) => {
        if (run.kind === 'formula') {
          if (run.layout !== undefined) {
            formulas.push(...formulaElements(run, start + run.layout.offset, baseline, node, sink));
            skip += run.layout.width;
          }
          return '';
        }
        remember(run, sink);
        const shift = skip === 0 ? '' : attribute('dx', svgNumber(skip));
        skip = 0;
        return element('tspan', [shift, runAttributes(run, node, sink)], escapeXml(run.text));
      })
      .join('');
    if (runs === '') {
      drawn.push(...formulas);
      continue;
    }

    drawn.push(
      element(
        'text',
        [
          attribute('x', svgNumber(formula === undefined ? x : start)),
          attribute('y', svgNumber(baseline)),
          attribute('text-anchor', formula === undefined ? anchor : undefined),
          node.letterSpacing === 0
            ? ''
            : attribute('letter-spacing', svgNumber(node.letterSpacing)),
          // The runs carry their own spaces and the IR says where the lines end, so neither
          // collapsing whitespace nor breaking on it is this exporter's decision.
          attribute('xml:space', 'preserve'),
        ],
        runs,
      ),
    );
    // After the line's text, so a formula is drawn over nothing it shares the line with.
    drawn.push(...formulas);
  }

  return drawn.join('');
}

/** Where a line of `width` starts, for the anchor `anchorOf` chose. */
function lineStart(
  width: number,
  anchorX: number,
  anchor: string | undefined,
  trailing: number,
): number {
  if (anchor === 'middle') return anchorX + trailing / 2 - width / 2;
  if (anchor === 'end') return anchorX + trailing - width;
  return anchorX;
}

/** A laid-out formula: a `<text>` per piece and a `<rect>` per rule, at the IR's coordinates. */
function formulaElements(
  run: FormulaRun,
  x: number,
  baseline: number,
  node: TextNode,
  sink: Sink,
): string[] {
  const layout = run.layout;
  if (layout === undefined) return [];
  const glyphs = layout.glyphs.map((glyph) => {
    remember(glyph, sink);
    return element(
      'text',
      [
        attribute('x', svgNumber(x + glyph.x)),
        attribute('y', svgNumber(baseline + glyph.y)),
        runAttributes({ ...glyph, color: run.color }, node, sink),
        attribute('xml:space', 'preserve'),
      ],
      escapeXml(glyph.text),
    );
  });
  const rules = layout.rules.map((rule) =>
    element('rect', [
      attribute('x', svgNumber(x + rule.x)),
      attribute('y', svgNumber(baseline + rule.y)),
      attribute('width', svgNumber(rule.width)),
      attribute('height', svgNumber(rule.thickness)),
      paintAttributes('fill', run.color, { w: rule.width, h: rule.thickness }, node.id, sink),
    ]),
  );
  return [...glyphs, ...rules];
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
    top += line.space;
    const leading = (line.size * node.lineHeight - line.size) / 2;
    const baseline = top + line.above + leading + line.size * ASCENT;
    top += lineHeightOf(line, node);

    // A formula's pieces are outlined where its layout puts them, from the pen at the
    // formula's start (`x`, `y` against the pen and the baseline); its width moves the pen on.
    const drawn = line.runs.flatMap((run) => {
      const pieces =
        run.kind === 'text'
          ? [{ ...run, x: 0, y: 0, spacing: node.letterSpacing }]
          : (run.layout?.glyphs ?? []).map((glyph) => ({ ...glyph, color: run.color, spacing: 0 }));
      return pieces.map((piece, index) => ({
        run: piece,
        formula: run.kind === 'formula' ? run : undefined,
        last: index === pieces.length - 1,
        shape: outline({
          text: piece.text,
          family: piece.font.family,
          size: piece.size,
          weight: piece.weight,
          style: piece.style,
          letterSpacing: piece.spacing,
        }),
      }));
    });

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

    const advanceOf = (item: (typeof drawn)[number]): number =>
      item.formula === undefined
        ? (item.shape?.advance ?? 0)
        : item.last
          ? (item.formula.layout?.width ?? 0)
          : 0;
    const width = drawn.reduce((sum, item) => sum + advanceOf(item), 0);
    // `text-anchor` has no meaning for a path, so the line is shifted by hand instead.
    let pen =
      anchor === 'middle' ? anchorX - width / 2 : anchor === 'end' ? anchorX - width : anchorX;

    for (const item of drawn) {
      if (item.shape === undefined) continue;
      const paint = paintValue(item.run.color, { w: width, h: item.run.size }, node.id, sink);
      if (item.formula !== undefined && item.last) {
        for (const rule of item.formula.layout?.rules ?? []) {
          parts.push(
            element('rect', [
              attribute('x', svgNumber(pen + rule.x)),
              attribute('y', svgNumber(baseline + rule.y)),
              attribute('width', svgNumber(rule.width)),
              attribute('height', svgNumber(rule.thickness)),
              paintAttributes(
                'fill',
                item.formula.color,
                { w: rule.width, h: rule.thickness },
                node.id,
                sink,
              ),
            ]),
          );
        }
      }
      parts.push(
        element('path', [
          attribute('d', item.shape.d),
          attribute(
            'transform',
            `translate(${svgNumber(pen + item.run.x)} ${svgNumber(baseline + item.run.y)})`,
          ),
          attribute('fill', paint?.value ?? 'none'),
          paint === undefined || paint.opacity === 1
            ? ''
            : attribute('fill-opacity', svgNumber(paint.opacity)),
        ]),
      );
      pen += advanceOf(item);
    }
  }

  return parts.join('');
}

export interface TextOptions {
  readonly textAsPaths: boolean;
}

/**
 * What a `<text>` node draws, as `<text>` or as paths.
 *
 * **Outlines that cannot be had fall back to `<text>` rather than to nothing** (ADR 0035).
 * `?? ''` was the old answer and it dropped the words out of the picture, which is exactly
 * the hole that kept `E_EXPORT_UNSUPPORTED` fatal. The error is still reported — an export
 * asked for a document that depends on no font and did not get one — and the reader gets
 * the text, drawn through the same embedded faces every other SVG this exporter writes
 * uses. Something wrong on the page beats a page that is quietly missing a headline.
 */
export function textMarkup(node: TextNode, sink: Sink, options: TextOptions): string {
  const lines = linesOf(node);
  if (options.textAsPaths) return pathElement(node, lines, sink) ?? textElement(node, lines, sink);
  return textElement(node, lines, sink);
}
