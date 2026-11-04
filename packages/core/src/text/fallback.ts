import type { FaceCache } from './face.js';
import { inheritOrigin } from './origin.js';
import type { FontFace } from '../ports/font-source.js';
import type { TextRun, TextSpan } from '../scene/nodes.js';

/**
 * The faces a glyph falls back to when its run's face lacks it (TYTO-484, ADR 0168).
 *
 * A brand face such as CircularXX draws Latin text and little else; a question about
 * physics writes `Δv = a·Δt` and `∇·E = ρ/ε₀`. A browser draws a glyph its face lacks in
 * whichever face it finds next on the machine, and measurement, which only knew the run's
 * face, had measured `.notdef` instead: the widths that decided the line breaks were not the
 * widths drawn, and a line ran over its neighbour. So the choice is made here, glyph by
 * glyph, and **it enters the IR**: the run is split into spans, each naming the face that
 * draws it. Both exporters draw spans as they already do and decide nothing.
 *
 * The chain, in order:
 *
 * 1. **Noto Sans Math 400**, the bundled symbol face: Greek, operators, arrows, sets,
 *    integrals, `ℏ`, `∇`, `√`. Upright and one weight, because that is the face upstream
 *    ships.
 * 2. **Source Sans 3**, at the run's weight and style rounded to a weight it ships: the
 *    superscript and subscript digits (`²`, `₀`), `·`, `°` and `‰`, which Noto Sans Math
 *    leaves to text faces.
 *
 * A face is in the chain only if the {@link FaceCache} answers it. On the host it always
 * does — both are bundled. In a code template's plugin process only the faces the manifest
 * lists under `faces:` cross (ADR 0048), so a template that wants its measure to agree with
 * the host's lists both.
 */
export const SYMBOL_FACE: FontFace = { family: 'Noto Sans Math', weight: 400, style: 'normal' };

/** The family the chain's second face is drawn in; bundled, at 400 and 700 in both styles. */
export const SYMBOL_TEXT_FAMILY = 'Source Sans 3';

/** The faces tried, in order, for a glyph a run of this weight and style lacks. */
export function fallbackChain(run: Pick<TextSpan, 'weight' | 'style'>): readonly FontFace[] {
  // Nearest shipped weight, with a tie going to the heavier face, as CSS does above 500.
  const weight = Math.abs(run.weight - 400) < Math.abs(run.weight - 700) ? 400 : 700;
  return [SYMBOL_FACE, { family: SYMBOL_TEXT_FAMILY, weight, style: run.style }];
}

export interface CoveredRuns {
  /** The runs with every glyph in a face that draws it. Unchanged runs are the same objects. */
  readonly runs: readonly TextRun[];
  /** Characters no face in the run's own face or the chain draws, once each, in order. */
  readonly missing: readonly string[];
}

/** What draws one character: the run's own face, or a face of the chain. */
type Drawer = 'own' | FontFace;

function sameDrawer(left: Drawer, right: Drawer): boolean {
  if (left === 'own' || right === 'own') return left === right;
  return left.family === right.family && left.weight === right.weight && left.style === right.style;
}

/** A combining mark sits on the glyph before it and is drawn in the same face. */
const MARK = /^\p{M}$/u;

/**
 * Each run split where its face stops drawing, with the pieces in the chain's faces.
 *
 * A run whose face cannot be measured at all is left alone: `measureText` already refuses
 * a node like that, and the fallback has nothing to compare against. A character no face
 * draws stays in the run's own face, where the browser will find something for it, and is
 * reported in `missing` so `compile` can say so.
 */
export function coverRuns(runs: readonly TextRun[], faces: FaceCache): CoveredRuns {
  const covered: TextRun[] = [];
  const missing = new Set<string>();

  for (const run of runs) {
    if (run.kind !== 'text') {
      covered.push(run);
      continue;
    }
    const own = faces.get({ family: run.font.family, weight: run.weight, style: run.style });
    if (own?.has === undefined) {
      covered.push(run);
      continue;
    }

    const chain = fallbackChain(run).filter((face) => faces.get(face)?.has !== undefined);
    const pieces: { drawer: Drawer; text: string }[] = [];

    for (const character of run.text) {
      const last = pieces[pieces.length - 1];
      const codePoint = character.codePointAt(0) ?? 0;
      let drawer: Drawer;
      if (last !== undefined && MARK.test(character)) {
        drawer = last.drawer;
      } else if (own.has(codePoint)) {
        drawer = 'own';
      } else {
        drawer = chain.find((face) => faces.get(face)?.has?.(codePoint) === true) ?? 'own';
        if (drawer === 'own') missing.add(character);
      }

      if (last !== undefined && sameDrawer(last.drawer, drawer)) last.text += character;
      else pieces.push({ drawer, text: character });
    }

    // Nothing to split: the same object, so its origin and every identity check survive.
    if (pieces.length <= 1 && (pieces[0]?.drawer ?? 'own') === 'own') {
      covered.push(run);
      continue;
    }

    for (const piece of pieces) {
      const span: TextSpan =
        piece.drawer === 'own'
          ? { ...run, text: piece.text }
          : {
              ...run,
              text: piece.text,
              font: { family: piece.drawer.family, source: 'bundled' },
              weight: piece.drawer.weight,
              style: piece.drawer.style,
            };
      inheritOrigin(run, span);
      covered.push(span);
    }
  }

  return { runs: covered, missing: [...missing] };
}
