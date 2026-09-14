import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension } from '@codemirror/state';
import { type SyntaxNode } from '@lezer/common';
import { type TemplateManifest } from '@tyto/core';
import { ATTRIBUTES, PROPERTIES, STRUCTURAL_TAGS, TAGS, isTag } from '@tyto/template-lang';

import { templateLanguage } from './template-language.js';
import { type TemplateAnalysis, templateAnalysisField } from './template-analysis.js';

/**
 * Completion for the template language, positioned by the syntax tree.
 *
 * *What* is offered comes out of the one list each thing is enumerated in. A template's
 * vocabulary is fixed (`docs/template-authoring.md`) and `@tyto/template-lang`'s
 * `vocabulary.ts` is the only place any of the three lists is written down, so offering them
 * here is not a second copy of the spec — it is the same array the compiler refuses against.
 * `slot="…"` is the one list a manifest decides, and it arrives through the analysis field
 * that `templateLint` publishes, which is the manifest the buffer is being linted against.
 *
 * *Where* the cursor is comes out of `syntaxTree(state).resolveInner(pos, -1)` (TYTO-93).
 * It used to come out of regular expressions over the line before the cursor, which was a
 * second reader of a syntax this package already ships a parser for. The tree answers for
 * free what those had to special-case: a `>` already written puts the cursor outside the
 * open tag rather than inside it, and the two halves of the file — markup and stylesheet —
 * are two node types rather than a backwards scan for the nearer `<style`.
 *
 * The text match does not disappear, and the place it survives says why. A value being
 * typed inside quotes is an error node with no structure under it, because the grammar has
 * no unterminated string: `slot="ti` parses as an unclosed quote followed by a bogus
 * attribute called `ti`. The tree still says which attribute the quote belongs to, so that
 * is what it is asked for, and the characters since the quote are read straight out of the
 * document.
 */

/** What is being completed, and where it starts in the document. */
interface Written {
  readonly text: string;
  readonly from: number;
}

const writtenSince = (state: EditorState, from: number, pos: number): Written => ({
  text: state.sliceDoc(from, pos),
  from,
});

const nothingWritten = (pos: number): Written => ({ text: '', from: pos });

/** Every name this language accepts is this shape, custom properties included. */
const NAME = /^-{0,2}[a-zA-Z0-9_-]*$/u;

const result = (written: Written, options: readonly Completion[]): CompletionResult | null => {
  if (options.length === 0) return null;
  return { from: written.from, options: [...options], validFor: NAME };
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

/** The nearest ancestor with this name, the node itself included. */
const nearest = (node: SyntaxNode, name: string): SyntaxNode | undefined => {
  let current: SyntaxNode | null = node;
  while (current !== null) {
    if (current.name === name) return current;
    current = current.parent;
  }
  return undefined;
};

const textOf = (state: EditorState, node: SyntaxNode): string => state.sliceDoc(node.from, node.to);

/* ------------------------------------------------------------------ stylesheet -- */

/**
 * Whether the cursor is inside the stylesheet.
 *
 * A template is markup with one `<style>` in it, and the two halves want completely
 * different lists. The `StyleSheet` node covers the answer whenever the file is well formed
 * — the language allows exactly one stylesheet and no nesting — and the second clause is
 * for the one case where it does not. A `<style>` nobody has closed yet ends in an error
 * node, and Lezer's recovery reads whatever follows as markup: type `<` on the next line of
 * a stylesheet still being written and the tree hands back an `Element`. The author is
 * inside the stylesheet all the same, and a tag list there would be the two halves bleeding
 * into each other.
 */
const inStyleSheet = (state: EditorState, pos: number): boolean => {
  const sheets = syntaxTree(state)
    .topNode.getChildren('StyleSheet')
    .filter((sheet) => sheet.from < pos);
  const sheet = sheets.at(-1);
  if (sheet === undefined) return false;
  return pos <= sheet.to || sheet.lastChild?.type.isError === true;
};

/**
 * In the stylesheet: a property name at the start of a declaration, and nothing else.
 *
 * A `Block` with the cursor loose in it is a declaration about to be written; a
 * `PropertyName` is one half written. The error-node case is `--` on its own, which is not
 * yet an identifier the grammar accepts and so cannot be a `PropertyName` — it is only ever
 * offered custom properties by the author typing the rest. Everything else the tree could
 * hand back is deliberately unanswered: a selector is not a property, and a `Value` past the
 * colon is a value, which this card does not complete.
 */
const completeStyle = (context: CompletionContext, node: SyntaxNode): CompletionResult | null => {
  const isDeclarationStart =
    node.name === 'Block' ||
    node.name === 'NestedBlock' ||
    (node.type.isError && (node.parent?.name === 'Block' || node.parent?.name === 'NestedBlock'));

  if (isDeclarationStart) {
    const written = node.type.isError
      ? writtenSince(context.state, node.from, context.pos)
      : nothingWritten(context.pos);
    return result(written, propertyOptions);
  }

  return node.name === 'PropertyName'
    ? result(writtenSince(context.state, node.from, context.pos), propertyOptions)
    : null;
};

/* ---------------------------------------------------------------------- markup -- */

/**
 * The opening quote of an attribute value the author has not closed yet.
 *
 * `AttributeValue` is `"` … `"` with no line break in it, so an unterminated value never
 * becomes a node: the quote is left as a one-character error node and the parser recovers by
 * reading what follows as further attributes. That error node is the marker this looks for,
 * walking backwards from the cursor and stopping at the start of the line — which is not an
 * arbitrary budget but the grammar's own limit on how far a value can reach.
 */
const openAttributeQuote = (state: EditorState, pos: number): SyntaxNode | undefined => {
  const line = state.doc.lineAt(pos);
  const cursor = syntaxTree(state).cursorAt(pos, -1);
  do {
    if (cursor.to <= line.from) return undefined;
    if (
      cursor.type.isError &&
      cursor.to === cursor.from + 1 &&
      cursor.to <= pos &&
      state.sliceDoc(cursor.from, cursor.to) === '"'
    ) {
      return cursor.node;
    }
  } while (cursor.prev());
  return undefined;
};

/**
 * Where an element's opening tag stops, so completion can stop with it.
 *
 * An attribute may be written up to the `>` and not past it, and the `>` is a lowercase
 * token with no node of its own — so the tree is asked for the last thing that is certainly
 * inside the tag (the last attribute, or the tag name) and the `>` is found from there. A
 * quoted value cannot be mistaken for it, because the scan starts after the node that holds
 * one. An opening tag with no `>` at all has not stopped anywhere yet, which is exactly the
 * state a tag being typed is in.
 */
const openTagEnd = (state: EditorState, element: SyntaxNode): number => {
  const attributes = element.getChildren('Attribute');
  const head = attributes.at(-1) ?? element.getChild('TagName');
  const from = head === null || head === undefined ? element.from + 1 : head.to;
  const closed = state.sliceDoc(from, element.to).indexOf('>');
  return closed === -1 ? Number.POSITIVE_INFINITY : from + closed + 1;
};

const slotOption = (name: string, manifest: TemplateManifest): Completion => {
  const type = manifest.slots[name]?.type;
  return { label: name, type: 'enum', ...(type === undefined ? {} : { detail: type }) };
};

/**
 * Inside `slot="…"`: the slots the manifest the buffer is linted against declares.
 *
 * Every slot, not the ones whose type suits the tag. `<text slot="…">` draws rich text and
 * `<image slot="…">` draws an asset (`docs/template-authoring.md`), but naming the other
 * kind is not an error — the node is simply left out of the scene — and a list that hid
 * names the compiler accepts would be inventing a rule. The type is in `detail` instead,
 * where it informs without refusing.
 *
 * Nothing is offered where the attribute could not be written at all: `slot` belongs to
 * `text` and `image` and `ATTRIBUTES` is what says so, which keeps this from offering a
 * list on a `<rect>` that the linter would then underline.
 */
const completeSlotValue = (
  context: CompletionContext,
  quote: SyntaxNode,
  analysis: TemplateAnalysis | undefined,
): CompletionResult | null => {
  if (analysis === undefined) return null;

  const attribute = quote.parent;
  const name = attribute?.getChild('AttributeName');
  if (name == null || textOf(context.state, name) !== 'slot') return null;

  const element = nearest(quote, 'Element');
  const tag = element?.getChild('TagName');
  if (tag == null) return null;
  const tagName = textOf(context.state, tag);
  if (!isTag(tagName) || !ATTRIBUTES[tagName].includes('slot')) return null;

  const written = writtenSince(context.state, quote.to, context.pos);
  // A slot name is an identifier. Anything else between the quote and the cursor is not a
  // name half written — a `<` typed inside a string is the case the tree used to answer
  // with a tag list — so there is nothing to complete.
  if (!NAME.test(written.text)) return null;

  const manifest = analysis.manifest;
  return result(
    written,
    Object.keys(manifest.slots).map((slot) => slotOption(slot, manifest)),
  );
};

/**
 * In the markup: a tag name after `<`, an attribute name inside an open tag, or a slot name
 * inside `slot="…"`.
 */
const completeMarkup = (
  context: CompletionContext,
  node: SyntaxNode,
  analysis: TemplateAnalysis | undefined,
): CompletionResult | null => {
  const quote = openAttributeQuote(context.state, context.pos);
  if (quote !== undefined) return completeSlotValue(context, quote, analysis);

  const element = nearest(node, 'Element');
  if (element === undefined) return null;
  if (context.pos >= openTagEnd(context.state, element)) return null;

  const tag = element.getChild('TagName');
  if (tag === null || context.pos <= tag.to) {
    const written =
      tag === null
        ? nothingWritten(context.pos)
        : writtenSince(context.state, tag.from, context.pos);
    return result(written, tagOptions);
  }

  const name = textOf(context.state, tag);
  if (!isTag(name)) return null;

  const written =
    node.name === 'AttributeName'
      ? writtenSince(context.state, node.from, context.pos)
      : nothingWritten(context.pos);
  return result(
    written,
    ATTRIBUTES[name].map((accepted): Completion => ({ label: accepted, type: 'property' })),
  );
};

/** Exported so a test can drive it without mounting an editor. */
export function completeTemplate(context: CompletionContext): CompletionResult | null {
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);

  return inStyleSheet(context.state, context.pos)
    ? completeStyle(context, node)
    : completeMarkup(context, node, context.state.field(templateAnalysisField, false));
}

/**
 * Scoped to the template language through its own data facet, so an editor that has both
 * languages loaded does not offer CSS properties inside a brief. The facet is also what puts
 * the parser in the state, which is what `completeTemplate` now reads.
 */
export function templateCompletion(): Extension {
  return [autocompletion(), templateLanguage.data.of({ autocomplete: completeTemplate })];
}
