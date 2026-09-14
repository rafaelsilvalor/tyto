import { type Extension } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { type Diagnostic as LintDiagnostic, linter } from '@codemirror/lint';
import { type Diagnostic, type DiagnosticCode, didYouMean } from '@tyto/core';

import {
  type BriefAnalysis,
  type BriefAnalyzer,
  briefAnalysisField,
  setBriefAnalysis,
} from './analysis.js';
import {
  isMounted,
  livenessPlugin,
  type MarkerFix,
  spanOf,
  toMarker,
} from './diagnostic-markers.js';

/**
 * `parse` + `resolve` diagnostics as CodeMirror lint markers.
 *
 * The diagnostics are the compiler's own — same codes, same messages, same ranges as the
 * CLI prints — because `SourceRange` is already a pair of UTF-16 offsets, which is what
 * CodeMirror consumes (`packages/core/src/source/range.ts`). Nothing is converted on the
 * way in, so a squiggle cannot land on different characters than a `tyto render` error.
 */

/**
 * The debounce, in milliseconds.
 *
 * TYTO-37 asks for a red underline "within 200 ms", and the marker appears a debounce plus
 * one analysis after the last keystroke. 150 leaves the analysis the rest of the budget,
 * which is generous: `parse` + `resolve` over the example briefs is a fraction of a
 * millisecond, and a worker round trip is the only part that could approach it.
 * CodeMirror's own default is 750, which would miss the criterion on the debounce alone.
 */
export const BRIEF_LINT_DELAY = 150;

/**
 * A name a brief can write — the manifest's `IDENTIFIER`, which is the grammar's.
 *
 * This is the guard that decides whether a diagnostic may carry a quick fix, and it is
 * doing real work, because ranges differ by code *and* by shape. `E_UNKNOWN_SLOT` lands on
 * a directive's `nameRange`; `E_BAD_ADJUSTMENT` lands on the adjustment's own range, which
 * is a bare name for a flag (`{destaque}`) and `name: value` for an enum; `E_BAD_SLOT_VALUE`
 * covers the whole directive, body and all. Replacing that last one with a slot name would
 * delete what the author wrote. Rather than keep a list of which codes are name-ranged and
 * watch it drift from `resolve`, the fix asks the range itself. `nameIn` below takes the
 * name out of an adjustment that carries a value, so `{tom: claro}` is fixable too; what
 * stays unfixable is a range that is not a name at all, which is the safe direction to be
 * wrong in.
 */
const NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;

/**
 * Which declared names a miswritten one could have meant.
 *
 * Empty for every other code, which is what turns the quick fix off: a diagnostic with no
 * candidate list cannot suggest, and `didYouMean` over an empty array answers `undefined`.
 */
const candidatesFor = (code: DiagnosticCode, analysis: BriefAnalysis): readonly string[] => {
  const manifest = analysis.manifest;
  switch (code) {
    case 'E_UNKNOWN_SLOT':
      return manifest === undefined ? [] : Object.keys(manifest.slots);
    // `E_UNKNOWN_DIRECTIVE` is deliberately absent: `resolve` raises it only for a
    // namespaced `::ai/caption`, whose name is a plugin's to provide and not a slot's to
    // be confused with. The `NAME` guard would refuse the slash anyway; leaving the case
    // out says why rather than letting the guard say it silently.
    case 'E_BAD_ADJUSTMENT':
      return manifest === undefined ? [] : Object.keys(manifest.adjustments);
    case 'E_UNKNOWN_FORMAT':
      return manifest === undefined ? [] : manifest.formats;
    case 'E_UNKNOWN_TEMPLATE':
      return analysis.templates;
    default:
      return [];
  }
};

/**
 * The name this one should have been, if the same budget `resolve` used says so.
 *
 * `didYouMean` is imported from `core` rather than re-derived, so the fix offers exactly
 * what the diagnostic's own `hint` names — one third of the word, one implementation. A
 * fix that suggested a different slot than the message did would be worse than no fix.
 */
/**
 * The name inside a diagnostic's range, and where it sits in it.
 *
 * `E_BAD_ADJUSTMENT` is ranged over the adjustment the author wrote, which is a bare name
 * for a flag (`{destaque}`) and `name: value` for an enum (`{tom: claro}`). The name is the
 * half a suggestion can replace; the value is the author's and stays where it is. Cutting
 * at the first colon is exact rather than approximate, because the grammar forbids a space
 * in front of one (`docs/brief-language.md`).
 */
const nameIn = (written: string): { text: string; from: number; to: number } => {
  const colon = written.indexOf(':');
  const head = colon === -1 ? written : written.slice(0, colon);
  const from = head.length - head.trimStart().length;
  const text = head.slice(from).trimEnd();
  return { text, from, to: from + text.length };
};

export function suggestionFor(
  item: Diagnostic,
  analysis: BriefAnalysis,
  written: string,
): MarkerFix | undefined {
  const name = nameIn(written);
  if (!NAME.test(name.text)) return undefined;
  const suggestion = didYouMean(name.text, candidatesFor(item.code, analysis));
  if (suggestion === undefined || suggestion === name.text) return undefined;
  return name.from === 0 && name.to === written.length
    ? { text: suggestion }
    : { text: suggestion, within: { from: name.from, to: name.to } };
}

/**
 * The mapping, with this language's quick fix attached.
 *
 * Everything about *where* the marker goes and *what* it says is shared with the template
 * linter (`diagnostic-markers.ts`); the only brief-specific part is which declared names a
 * miswritten one could have meant.
 */
const toLintDiagnostic = (
  item: Diagnostic,
  analysis: BriefAnalysis,
  view: EditorView,
): LintDiagnostic => {
  const { from, to } = spanOf(item, view);
  return toMarker(item, view, suggestionFor(item, analysis, view.state.doc.sliceString(from, to)));
};

export interface BriefLintOptions {
  /** Debounce in milliseconds. Defaults to `BRIEF_LINT_DELAY`. */
  readonly delay?: number;
}

/**
 * The lint extension, and the only writer of the analysis field.
 *
 * Completion reads what this publishes rather than analysing the document again: one pass
 * of `parse` + `resolve` per debounce feeds both, and the squiggle and the completion list
 * are therefore always talking about the same template.
 */
export function briefLint(analyzer: BriefAnalyzer, options: BriefLintOptions = {}): Extension {
  /**
   * Answers can arrive out of order once an analyzer is a worker, and the field must not
   * go backwards: a slow answer about older text would put a stale manifest in front of
   * completion. The counter is per `briefLint()` call, which is per editor.
   */
  let issued = 0;
  let newest = 0;

  const source = async (view: EditorView): Promise<readonly LintDiagnostic[]> => {
    issued += 1;
    const request = issued;
    const analysis = await analyzer.analyze(view.state.doc.toString());

    if (request > newest && isMounted(view)) {
      newest = request;
      view.dispatch({ effects: setBriefAnalysis.of(analysis) });
    }

    return analysis.diagnostics.map((item) => toLintDiagnostic(item, analysis, view));
  };

  return [
    briefAnalysisField,
    livenessPlugin,
    linter(source, { delay: options.delay ?? BRIEF_LINT_DELAY }),
  ];
}
