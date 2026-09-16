import { type Diagnostic as LintDiagnostic, linter } from '@codemirror/lint';
import { type Extension } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { type Diagnostic, didYouMean } from '@tyto/core';
import {
  ATTRIBUTES,
  PROPERTIES,
  STRUCTURAL_TAGS,
  TAGS,
  attributeAlias,
  isTag,
  propertyAlias,
  tagAlias,
} from '@tyto/template-lang';

import {
  isMounted,
  livenessPlugin,
  type MarkerFix,
  spanOf,
  toMarker,
} from './diagnostic-markers.js';
import { BRIEF_LINT_DELAY } from './lint.js';
import { treeAt } from './syntax.js';
import {
  type TemplateAnalyzer,
  setTemplateAnalysis,
  templateAnalysisField,
} from './template-analysis.js';

/**
 * `compileTemplate` diagnostics as CodeMirror lint markers.
 *
 * Where the marker goes and what it says is `diagnostic-markers.ts`, shared with the brief
 * linter. What is here is the one thing a template answers differently: which vocabulary a
 * refused name should be measured against, and how to find it.
 */

/** A name the template language could accept — a tag, an attribute or a CSS property. */
const NAME = /^-{0,2}[a-zA-Z_][a-zA-Z0-9_-]*$/u;

/**
 * The tag an attribute was written on, read back out of the tree.
 *
 * `E_UNSUPPORTED_ATTRIBUTE` is ranged over the attribute name and says the tag in its
 * message, but not in a form a caller can use — and which attributes are legal is a
 * question only the tag answers. Rather than widen the diagnostic so that one consumer can
 * read a field, the editor asks the document it already has parsed: climb from the range to
 * the enclosing `Element` and read its `TagName`. Nothing in `core` or `template-lang`
 * changes for this (TYTO-92).
 */
const tagAround = (view: EditorView, at: number): string | undefined => {
  let node = treeAt(view.state, at).resolveInner(at, 1);
  while (node.name !== 'Element') {
    const parent = node.parent;
    if (parent === null) return undefined;
    node = parent;
  }
  const tag = node.getChild('TagName');
  return tag === null ? undefined : view.state.doc.sliceString(tag.from, tag.to);
};

/**
 * The name to write instead, from edit distance first and the alias table second.
 *
 * Two sources, because they answer different mistakes. `colour` is a typo and distance
 * finds `color`; `background` is not a typo of anything — a person arrives at this language
 * with CSS in their fingers — and only the hand-written table knows it means `fill`. The
 * table is filtered by `@tyto/template-lang` to the entries that are one accepted name, so
 * the multi-word ones ("x, y and rotation") stay in the message where they belong.
 */
const suggestionFor = (
  item: Diagnostic,
  view: EditorView,
  written: string,
  from: number,
): string | undefined => {
  switch (item.code) {
    case 'E_UNSUPPORTED_CSS':
      return didYouMean(written, PROPERTIES) ?? propertyAlias(written);
    case 'E_UNSUPPORTED_TAG':
      return didYouMean(written, [...TAGS, ...STRUCTURAL_TAGS]) ?? tagAlias(written);
    case 'E_UNSUPPORTED_ATTRIBUTE': {
      const tag = tagAround(view, from);
      if (tag === undefined || !isTag(tag)) return undefined;
      return didYouMean(written, ATTRIBUTES[tag]) ?? attributeAlias(written, tag);
    }
    default:
      return undefined;
  }
};

export function templateSuggestionFor(
  item: Diagnostic,
  view: EditorView,
  span: { readonly from: number; readonly to: number },
): MarkerFix | undefined {
  const written = view.state.doc.sliceString(span.from, span.to);
  if (!NAME.test(written)) return undefined;
  const suggestion = suggestionFor(item, view, written, span.from);
  return suggestion === undefined || suggestion === written ? undefined : { text: suggestion };
}

export interface TemplateLintOptions {
  /** Debounce in milliseconds. Defaults to the same budget the brief linter uses. */
  readonly delay?: number;
}

/**
 * The lint extension, and the only writer of the analysis field.
 *
 * `slot="…"` completion reads the manifest this publishes rather than being handed one of
 * its own, which is the same arrangement the brief side has: the squiggle and the completion
 * list cannot disagree about which template the buffer belongs to, because there is one
 * answer and the host gave it once. No sequence counter here, unlike `briefLint` — the
 * manifest is fixed for the life of the analyzer, so a late answer carries the same one an
 * early answer did and cannot put anything stale in front of completion.
 */
export function templateLint(
  analyzer: TemplateAnalyzer,
  options: TemplateLintOptions = {},
): Extension {
  const source = async (view: EditorView): Promise<readonly LintDiagnostic[]> => {
    const analysis = await analyzer.analyze(view.state.doc.toString());
    if (!isMounted(view)) return [];
    view.dispatch({ effects: setTemplateAnalysis.of(analysis) });
    return analysis.diagnostics.map((item) => {
      const span = spanOf(item, view);
      return toMarker(item, view, templateSuggestionFor(item, view, span));
    });
  };

  return [
    templateAnalysisField,
    livenessPlugin,
    linter(source, { delay: options.delay ?? BRIEF_LINT_DELAY }),
  ];
}
