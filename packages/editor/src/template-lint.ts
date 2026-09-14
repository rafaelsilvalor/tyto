import { type Diagnostic as LintDiagnostic, linter } from '@codemirror/lint';
import { type Extension } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { type Diagnostic, type DiagnosticCode, didYouMean } from '@tyto/core';
import { PROPERTIES, STRUCTURAL_TAGS, TAGS } from '@tyto/template-lang';

import { isMounted, livenessPlugin, spanOf, toMarker } from './diagnostic-markers.js';
import { BRIEF_LINT_DELAY } from './lint.js';
import { type TemplateAnalyzer } from './template-analysis.js';

/**
 * `compileTemplate` diagnostics as CodeMirror lint markers.
 *
 * Where the marker goes and what it says is `diagnostic-markers.ts`, shared with the brief
 * linter. What is here is the one thing a template answers differently: which vocabulary a
 * misspelled name could have come from.
 */

/** A name the template language could accept — a tag, an attribute or a CSS property. */
const NAME = /^-{0,2}[a-zA-Z_][a-zA-Z0-9_-]*$/u;

/**
 * The accepted names a refused one might be a typo of.
 *
 * `E_UNSUPPORTED_ATTRIBUTE` is deliberately absent: which attributes are legal depends on
 * the tag the attribute sits on, and the diagnostic does not carry the tag in a form this
 * can read. The message already names the suggestion, so the cost is a missing button and
 * not a missing answer.
 */
const candidatesFor = (code: DiagnosticCode): readonly string[] => {
  switch (code) {
    case 'E_UNSUPPORTED_CSS':
      return PROPERTIES;
    case 'E_UNSUPPORTED_TAG':
      return [...TAGS, ...STRUCTURAL_TAGS];
    default:
      return [];
  }
};

/**
 * The one-word fix, when there is one.
 *
 * `vocabulary.ts` has a second source of suggestions this cannot reach — the alias table
 * that maps `width` to `w` and `background` to `fill`, which no edit distance would ever
 * find. Those still reach the author through the diagnostic's message; they just do not get
 * a button. Exporting the table to fix that is a change to `@tyto/template-lang`'s surface
 * and belongs to whoever needs it, not to this card.
 */
export function templateSuggestionFor(item: Diagnostic, written: string): string | undefined {
  if (!NAME.test(written)) return undefined;
  const suggestion = didYouMean(written, candidatesFor(item.code));
  return suggestion === written ? undefined : suggestion;
}

export interface TemplateLintOptions {
  /** Debounce in milliseconds. Defaults to the same budget the brief linter uses. */
  readonly delay?: number;
}

export function templateLint(
  analyzer: TemplateAnalyzer,
  options: TemplateLintOptions = {},
): Extension {
  const source = async (view: EditorView): Promise<readonly LintDiagnostic[]> => {
    const analysis = await analyzer.analyze(view.state.doc.toString());
    if (!isMounted(view)) return [];
    return analysis.diagnostics.map((item) => {
      const { from, to } = spanOf(item, view);
      return toMarker(
        item,
        view,
        templateSuggestionFor(item, view.state.doc.sliceString(from, to)),
      );
    });
  };

  return [livenessPlugin, linter(source, { delay: options.delay ?? BRIEF_LINT_DELAY })];
}
