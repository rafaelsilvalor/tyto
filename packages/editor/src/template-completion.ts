import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension } from '@codemirror/state';
import { ATTRIBUTES, PROPERTIES, STRUCTURAL_TAGS, TAGS, isTag } from '@tyto/template-lang';

import { templateLanguage } from './template-language.js';

/**
 * Completion for the template language, out of the one list each thing is enumerated in.
 *
 * Unlike the brief's, none of this comes from a manifest: a template's vocabulary is fixed
 * (`docs/template-authoring.md`), and `@tyto/template-lang`'s `vocabulary.ts` is the only
 * place any of the three lists is written down. Offering them here is therefore not a
 * second copy of the spec — it is the same array the compiler refuses against.
 */

/**
 * Whether the cursor is inside the stylesheet.
 *
 * A template is markup with one `<style>` in it, and the two halves want completely
 * different lists. Found by looking backwards for the nearer of the two tags, which is
 * cheap and cannot be wrong about a well-formed file — the language allows exactly one
 * stylesheet and no nesting.
 */
const insideStyle = (state: EditorState, pos: number): boolean => {
  const before = state.sliceDoc(0, pos);
  return before.lastIndexOf('<style') > before.lastIndexOf('</style>');
};

const result = (
  context: CompletionContext,
  written: string,
  options: readonly Completion[],
): CompletionResult | null => {
  if (options.length === 0) return null;
  return {
    from: context.pos - written.length,
    options: [...options],
    validFor: /^-{0,2}[a-zA-Z0-9_-]*$/u,
  };
};

const tagOptions: readonly Completion[] = [
  ...TAGS.map((tag): Completion => ({ label: tag, type: 'type', detail: 'node' })),
  // `<define>` and `<use>` draw nothing and are resolved away before a scene is built, but
  // they are written by hand as often as the drawable six.
  ...STRUCTURAL_TAGS.map((tag): Completion => ({
    label: tag,
    type: 'keyword',
    detail: 'structure',
  })),
];

const propertyOptions: readonly Completion[] = PROPERTIES.map((property): Completion => ({
  label: property,
  type: 'property',
}));

/**
 * In the markup: a tag name after `<`, or an attribute name inside an open tag.
 *
 * Both are matched against the text before the cursor rather than against the syntax tree,
 * which is the same trade the brief's completion makes: a half-typed `<re` is a parse error
 * and the tree at that moment has nothing useful to say, which is exactly the moment the
 * list is wanted.
 */
const completeMarkup = (context: CompletionContext, before: string): CompletionResult | null => {
  const tag = /<([a-zA-Z-]*)$/u.exec(before);
  if (tag) return result(context, tag[1] ?? '', tagOptions);

  // `<text slot="titulo" cl` — the open tag has to be unterminated, so no `>` may sit
  // between the tag name and the cursor.
  const attribute = /<([a-zA-Z-]+)(?:\s+[^<>]*?)?\s+([a-zA-Z-]*)$/u.exec(before);
  if (!attribute) return null;

  const name = attribute[1] ?? '';
  if (!isTag(name)) return null;
  return result(
    context,
    attribute[2] ?? '',
    ATTRIBUTES[name].map((accepted): Completion => ({ label: accepted, type: 'property' })),
  );
};

/** In the stylesheet: a property name at the start of a declaration. */
const completeStyle = (context: CompletionContext, before: string): CompletionResult | null => {
  const property = /(?:^|[{;])\s*(-{0,2}[a-zA-Z-]*)$/u.exec(before);
  return property ? result(context, property[1] ?? '', propertyOptions) : null;
};

/** Exported so a test can drive it without mounting an editor. */
export function completeTemplate(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);

  return insideStyle(context.state, context.pos)
    ? completeStyle(context, before)
    : completeMarkup(context, before);
}

/**
 * Scoped to the template language through its own data facet, so an editor that has both
 * languages loaded does not offer CSS properties inside a brief.
 */
export function templateCompletion(): Extension {
  return [autocompletion(), templateLanguage.data.of({ autocomplete: completeTemplate })];
}
