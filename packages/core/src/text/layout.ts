import type { FaceCache } from './face.js';
import { inheritOrigin } from './origin.js';
import type { TextNode, TextRun, TextSpan } from '../scene/nodes.js';

/**
 * Where the lines of a text node fall, decided in the IR (ADR 0019).
 *
 * Both exporters draw text and only one of them can lay it out: a browser wraps a
 * paragraph and an SVG has no line box at all, so until something measured, the same node
 * broke in two places at once. This is that something. A `TextNode` leaves `compile` with
 * every break already a `LineBreak` run, and neither exporter decides anything.
 *
 * ## What it promises, and against what
 *
 * The target is not "typographically ideal", it is **what `export-html` will do**, because
 * that is the path a PNG comes out of and a measurement that disagrees with the raster is
 * worse than no measurement. Two consequences shape everything below:
 *
 * - A line advances by `lineHeight × the node's largest run`, uniformly, because that is
 *   the block's strut (`docs/ir-schema.md`, TYTO-65). Not by each line's own size.
 * - A break opportunity is a space, and only a space. CSS `break-word` rules, hyphens and
 *   CJK are not implemented; the limit is stated here rather than approximated, since a
 *   wrong break is visible and a missing feature is findable.
 *
 * ## What it does not do
 *
 * Bidi, shaping across a run boundary, and `align: 'justify'` — which changes where glyphs
 * sit on a line but not where the line ends, so it does not affect the break decisions.
 */

/** The smallest `overflow: 'shrink'` is allowed to go, as a fraction of the declared size. */
export const MINIMUM_SHRINK = 0.5;

export interface TextMeasurement {
  /** The node's runs with every break decided. Feed these back into the node. */
  readonly runs: readonly TextRun[];
  readonly lines: number;
  /** The widest line, in px, with trailing spaces excluded the way CSS excludes them. */
  readonly width: number;
  /** `lines × lineHeight × referenceSize`, which is what a browser's block height comes to. */
  readonly height: number;
  /** What every run's size was multiplied by. 1 unless `overflow: 'shrink'` acted. */
  readonly scale: number;
  /** How far past `box.h` it still is, in px; 0 when it fits or when there is no `box.h`. */
  readonly overflow: number;
}

/** The largest run in a node, whose size the strut — and so the leading — comes from. */
export function referenceRun(node: TextNode): TextSpan | undefined {
  let largest: TextSpan | undefined;
  for (const run of node.runs) {
    if (run.kind !== 'text') continue;
    if (largest === undefined || run.size > largest.size) largest = run;
  }
  return largest;
}

/**
 * One word and the spaces that follow it.
 *
 * Keeping the spaces attached is what makes a wrap decision local: a line breaks *after* a
 * run of spaces, and the spaces themselves do not push the line over — CSS hangs them past
 * the edge. So a token's width counts twice, once with its spaces for "where does the next
 * one start" and once without for "does this line fit".
 */
interface Token {
  readonly text: string;
  readonly trimmed: string;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // A word, then any spaces after it; or leading spaces on their own.
  const pattern = /[^ ]*[ ]*/gy;
  let match = pattern.exec(text);
  while (match !== null && match[0] !== '') {
    tokens.push({ text: match[0], trimmed: match[0].replace(/ +$/, '') });
    match = pattern.exec(text);
  }
  return tokens;
}

/** A piece of a run: the same styling, a slice of the text. */
interface Piece {
  readonly run: TextSpan;
  readonly text: string;
}

interface Line {
  readonly pieces: Piece[];
  /** Width including trailing spaces, which is where the next token would start. */
  flowing: number;
  /** Width with trailing spaces trimmed, which is what has to fit. */
  visible: number;
}

function emptyLine(): Line {
  return { pieces: [], flowing: 0, visible: 0 };
}

export interface LayoutOptions {
  /** The floor for `overflow: 'shrink'`. Defaults to {@link MINIMUM_SHRINK}. */
  readonly minimumShrink?: number;
}

/**
 * Lays a node out, or returns `undefined` when no face could be measured.
 *
 * `undefined` rather than a partial answer: a node whose font is missing keeps the lines
 * the brief wrote, which is the behaviour that existed before anything measured. Half of a
 * node measured against a fallback would move text for a reason nobody could see.
 */
export function measureText(
  node: TextNode,
  faces: FaceCache,
  options: LayoutOptions = {},
): TextMeasurement | undefined {
  const reference = referenceRun(node);
  if (reference === undefined) return undefined;

  // Every run has to be measurable. A node that mixes a bundled face with an unbundled one
  // would wrap half its text on real widths and half on nothing.
  for (const run of node.runs) {
    if (run.kind !== 'text') continue;
    if (
      faces.get({ family: run.font.family, weight: run.weight, style: run.style }) === undefined
    ) {
      return undefined;
    }
  }

  const minimum = options.minimumShrink ?? MINIMUM_SHRINK;
  const shrinking = node.overflow === 'shrink' && node.box.h !== undefined;

  let scale = 1;
  let laid = layoutAt(node, faces, reference, scale);

  if (shrinking) {
    // A step-down search rather than a binary one: the answer has to be stable across runs
    // and reproducible by hand, and a browser re-wraps at every size anyway, so the number
    // of shapings is the same. 2% a step puts the floor 34 steps away.
    const height = node.box.h ?? 0;
    while (laid.height > height && scale > minimum) {
      scale = Math.max(minimum, Math.round((scale - 0.02) * 1000) / 1000);
      laid = layoutAt(node, faces, reference, scale);
    }
  }

  const overflow = node.box.h === undefined ? 0 : Math.max(0, laid.height - node.box.h);

  return { ...laid, scale, overflow };
}

function layoutAt(
  node: TextNode,
  faces: FaceCache,
  reference: TextSpan,
  scale: number,
): Omit<TextMeasurement, 'scale' | 'overflow'> {
  const lines: Line[] = [emptyLine()];
  const limit = node.box.w;

  const widthOf = (run: TextSpan, text: string): number => {
    if (text === '') return 0;
    const face = faces.get({ family: run.font.family, weight: run.weight, style: run.style });
    const advance = face === undefined ? 0 : face.advance(text);
    // Letter spacing lands after every character, the last one included — which is what
    // CSS does and why a tracked-out line is wider than its glyphs by one full step.
    return advance * run.size * scale + node.letterSpacing * [...text].length;
  };

  for (const run of node.runs) {
    if (run.kind === 'break') {
      lines.push(emptyLine());
      continue;
    }

    for (const token of tokenize(run.text)) {
      const line = lines[lines.length - 1]!;
      const flowing = widthOf(run, token.text);
      const visible = widthOf(run, token.trimmed);

      // A token that does not fit starts a line — unless the line is empty, in which case
      // nothing would be gained by moving it and a word longer than its box would loop.
      if (limit !== undefined && line.pieces.length > 0 && line.flowing + visible > limit) {
        const next = emptyLine();
        next.pieces.push({ run, text: token.text });
        next.flowing = flowing;
        next.visible = visible;
        lines.push(next);
        continue;
      }

      line.pieces.push({ run, text: token.text });
      line.visible = line.flowing + visible;
      line.flowing += flowing;
    }
  }

  const leading = node.lineHeight * reference.size * scale;

  return {
    runs: rebuild(lines, scale),
    lines: lines.length,
    width: Math.max(0, ...lines.map((line) => line.visible)),
    height: lines.length * leading,
  };
}

/**
 * Lines back into runs, with a `LineBreak` between each pair.
 *
 * Adjacent pieces of the same run are re-joined, so a paragraph that did not wrap comes
 * out as the one run it went in as rather than as one run per word. An empty line survives
 * as two consecutive breaks, which is how a brief asks for one (ADR 0016).
 */
function rebuild(lines: readonly Line[], scale: number): TextRun[] {
  const runs: TextRun[] = [];

  lines.forEach((line, index) => {
    if (index > 0) runs.push({ kind: 'break' });

    // Adjacent pieces of the same run are re-joined first, so a paragraph that did not
    // wrap comes out as the one run it went in as rather than as one run per word.
    const groups: { run: TextSpan; text: string }[] = [];
    for (const piece of line.pieces) {
      const last = groups[groups.length - 1];
      if (last !== undefined && last.run === piece.run) last.text += piece.text;
      else groups.push({ run: piece.run, text: piece.text });
    }

    // Only the *last* group loses its trailing spaces, and only on a line that wraps: they
    // are what the line broke at, they are not drawn, and they would widen a centred line.
    // Trimming every group would glue two runs together — `bold ` + `and` is `bold and`.
    const tail = groups[groups.length - 1];
    if (tail !== undefined && index < lines.length - 1) {
      tail.text = tail.text.replace(/ +$/, '');
    }

    for (const group of groups) {
      if (group.text !== '') runs.push(scaled(group.run, group.text, scale));
    }
  });

  return runs;
}

function scaled(run: TextSpan, text: string, scale: number): TextSpan {
  // Rounded to a thousandth: the size reaches CSS as a string, and an unrounded product
  // would put `14.999999999999998px` in a document that has to be byte-identical twice.
  const replacement: TextSpan =
    scale === 1
      ? { ...run, text }
      : { ...run, text, size: Math.round(run.size * scale * 1000) / 1000 };

  // Wrapping and shrinking both build new run objects, and the diagnostic that names the
  // directive is looked up by identity.
  inheritOrigin(run, replacement);
  return replacement;
}
