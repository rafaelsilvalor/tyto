import { type Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { type Diagnostic as LintDiagnostic, linter } from '@codemirror/lint';
import { type Diagnostic, type DiagnosticCode, didYouMean } from '@tyto/core';

import {
  type BriefAnalysis,
  type BriefAnalyzer,
  briefAnalysisField,
  setBriefAnalysis,
} from './analysis.js';

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
 * watch it drift from `resolve`, the fix asks the range itself — and the cost is that a
 * misspelled `{tom: claro}` goes unfixed while `{destaqe}` does not, which is the safe
 * direction to be wrong in.
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
export function suggestionFor(
  item: Diagnostic,
  analysis: BriefAnalysis,
  written: string,
): string | undefined {
  if (!NAME.test(written)) return undefined;
  const suggestion = didYouMean(written, candidatesFor(item.code, analysis));
  return suggestion === written ? undefined : suggestion;
}

/**
 * Where the marker goes.
 *
 * A diagnostic with no range is one nothing in the file caused — `E_NO_TEMPLATE` is the
 * case: the brief's mistake is a line it never wrote. It lands on the first line rather
 * than at offset zero, because a zero-width marker on an empty document is a squiggle
 * nobody can see or hover.
 */
const spanOf = (item: Diagnostic, view: EditorView): { from: number; to: number } => {
  const length = view.state.doc.length;
  if (item.range === undefined) {
    const first = view.state.doc.line(1);
    return { from: first.from, to: first.to };
  }
  // Clamped because a worker answers about the text it was given, and the author may have
  // deleted past the end of it while the answer was in flight.
  const from = Math.min(item.range.start, length);
  return { from, to: Math.max(from, Math.min(item.range.end, length)) };
};

const toLintDiagnostic = (
  item: Diagnostic,
  analysis: BriefAnalysis,
  view: EditorView,
): LintDiagnostic => {
  const { from, to } = spanOf(item, view);
  const written = view.state.doc.sliceString(from, to);
  const suggestion = suggestionFor(item, analysis, written);

  return {
    from,
    to,
    severity: item.severity,
    // The code, not "tyto": it is what `docs/diagnostic-codes.md` is indexed by, so a
    // reader who hovers a marker has the string that finds the rule behind it.
    source: item.code,
    message: item.hint === undefined ? item.message : `${item.message} ${item.hint}`,
    ...(suggestion === undefined
      ? {}
      : {
          actions: [
            {
              name: `Replace with '${suggestion}'`,
              // The positions are the ones CodeMirror has mapped forward, not the ones the
              // diagnostic was built with — which is why the action takes them as
              // arguments and this closure does not capture `from`/`to`.
              apply: (target: EditorView, start: number, end: number) => {
                target.dispatch({ changes: { from: start, to: end, insert: suggestion } });
              },
            },
          ],
        }),
  };
};

/**
 * Views currently mounted, so an answer that arrives after `destroy()` is dropped.
 *
 * `EditorView.destroyed` is private, and the window is real: the lint source reads the
 * document, awaits an analyzer that may be a worker, and only then dispatches. A host that
 * swaps files by destroying the editor and building another — which is what the demo's
 * read-only toggle does — closes that window on every swap.
 */
const mounted = new WeakSet<EditorView>();

const liveness = ViewPlugin.define((view: EditorView) => {
  mounted.add(view);
  return {
    destroy: () => {
      mounted.delete(view);
    },
  };
});

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

    if (request > newest && mounted.has(view)) {
      newest = request;
      view.dispatch({ effects: setBriefAnalysis.of(analysis) });
    }

    return analysis.diagnostics.map((item) => toLintDiagnostic(item, analysis, view));
  };

  return [
    briefAnalysisField,
    liveness,
    linter(source, { delay: options.delay ?? BRIEF_LINT_DELAY }),
  ];
}
