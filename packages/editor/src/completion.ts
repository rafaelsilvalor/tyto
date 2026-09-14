import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { type SyntaxNode } from '@lezer/common';
import { type TemplateManifest } from '@tyto/core';

import { type BriefAnalysis, briefAnalysisField } from './analysis.js';
import { briefLanguage } from './brief-language.js';

/**
 * Completion driven by the active template's manifest, positioned by the syntax tree.
 *
 * Two questions, two sources. *What* to offer comes out of the `TemplateManifest` the
 * frontmatter named — slot names and enum values are the template author's vocabulary and
 * may be in any language (`docs/brief-language.md`), so there is no list to hard-code here,
 * which is why changing `template:` swaps every list in the file. The manifest arrives
 * through the analysis field that `briefLint` publishes — the same pass that produced the
 * squiggles — so the two can never disagree about which template is active.
 *
 * *Where* the cursor is comes out of `syntaxTree(state).resolveInner(pos, -1)`: the tree
 * `@tyto/brief-lang` builds and `parseBrief` reads. It used to come out of a regular
 * expression over the text before the cursor, which was a second reader of a syntax this
 * package already ships a parser for (TYTO-93). The node the cursor resolves to *is* the
 * answer — `Name` under a `Directive` is a directive name being written, `AdjustmentValue`
 * is a value — and the two cases the regex had to special-case cost nothing here: `::` on
 * an indented body line resolves to `Text` under a `BodyLine`, and a `{` in prose resolves
 * inside a `Mark`. Neither is a node this file has a case for, so neither gets a list.
 */

/**
 * What is being completed, and where it starts in the document.
 *
 * `from` comes from the node rather than from `pos - written.length`, so a name with a
 * character CodeMirror would not have counted the same way cannot shift the replacement.
 */
interface Written {
  readonly text: string;
  readonly from: number;
}

/** A node's own text, as the thing being completed. */
const writtenAt = (context: CompletionContext, node: SyntaxNode): Written => ({
  text: context.state.sliceDoc(node.from, context.pos),
  from: node.from,
});

/** Nothing written yet: the cursor sits where the name will go. */
const nothingWritten = (context: CompletionContext): Written => ({
  text: '',
  from: context.pos,
});

const slotOption = (name: string, manifest: TemplateManifest): Completion => {
  const slot = manifest.slots[name];
  const notes = [
    slot?.type,
    slot?.required === true ? 'required' : undefined,
    slot?.repeat === true ? 'repeat' : undefined,
  ].filter((note): note is string => note !== undefined);
  return { label: name, type: 'property', detail: notes.join(' · ') };
};

const adjustmentOption = (name: string, manifest: TemplateManifest): Completion => {
  const type = manifest.adjustments[name]?.type;
  // Spread rather than assign: `exactOptionalPropertyTypes` reads an explicit `undefined`
  // as a different thing from an absent key, and `Completion.detail` is optional.
  return { label: name, type: 'property', ...(type === undefined ? {} : { detail: type }) };
};

const valueOption = (value: string): Completion => ({ label: value, type: 'enum' });

const result = (written: Written, options: readonly Completion[]): CompletionResult | null => {
  if (options.length === 0) return null;
  return {
    from: written.from,
    options: [...options],
    // Every name the brief language can write is this shape, so CodeMirror keeps filtering
    // the list as the author types instead of asking for it again on each keystroke.
    validFor: /^[a-zA-Z0-9_-]*$/u,
  };
};

/* ------------------------------------------------------------------ frontmatter -- */

/**
 * The frontmatter, which is the one place the tree has nothing to say — by design.
 *
 * "Frontmatter is taken whole and its YAML is left alone. The grammar marks the block from
 * `---` to `---`; a real YAML parser reads it in `parseBrief`. A grammar that tried would be
 * a second, worse YAML" (`docs/brief-language.md`). So the block is one opaque token and
 * matching the line is not a second reader of anything: there is no tree inside it to read.
 *
 * What the tree *does* answer — and what a hand-rolled fence scanner used to answer wrongly
 * — is where the block ends. An unterminated frontmatter produces no `Frontmatter` node at
 * all, so a brief being typed from scratch gets body completion until the fence is closed,
 * which is what the language says it is.
 *
 * The node's end needs no guard of its own. The block always ends on a line boundary — the
 * token takes the closing fence's line break with it, or runs to end of input — so a cursor
 * resolving to the very end of it has an empty line in front of it, and both branches answer
 * an empty line the same way.
 */
const inFrontmatter = (node: SyntaxNode): boolean => node.name === 'Frontmatter';

/**
 * Inside the frontmatter: `template`, `formats`, and any enum slot set as a scalar.
 *
 * The frontmatter and a `::directive` set the same slots — "they differ in where the value
 * came from and in nothing else" (`docs/brief-language.md`) — so an enum slot completes
 * here exactly as it would in an adjustment.
 */
const completeFrontmatter = (
  context: CompletionContext,
  analysis: BriefAnalysis,
): CompletionResult | null => {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const manifest = analysis.manifest;

  const at = (match: RegExpExecArray, group: number): Written => {
    const text = match[group] ?? '';
    return { text, from: context.pos - text.length };
  };

  const template = /^\s*template\s*:\s*([a-zA-Z0-9_-]*)$/u.exec(before);
  if (template) {
    return result(
      at(template, 1),
      analysis.templates.map((name) => ({ label: name, type: 'class' })),
    );
  }

  if (manifest === undefined) return null;

  // `formats: [feed, st` — a YAML flow sequence, completed item by item. The optional `[`
  // is what tells this apart from the generic `key: value` below, which would otherwise
  // match the same line.
  const formats = /^\s*formats\s*:\s*(?:\[)?(?:[^[\]]*,)?\s*([a-zA-Z0-9_-]*)$/u.exec(before);
  if (formats) return result(at(formats, 1), manifest.formats.map(valueOption));

  const scalar = /^\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*([a-zA-Z0-9_-]*)$/u.exec(before);
  if (scalar) {
    const slot = manifest.slots[scalar[1] ?? ''];
    if (slot?.type === 'enum' && slot.values !== undefined) {
      return result(at(scalar, 2), slot.values.map(valueOption));
    }
  }

  return null;
};

/* ------------------------------------------------------------------------ body -- */

/** The nearest `Directive` the node sits in, or nothing when it sits in none. */
const directiveAround = (node: SyntaxNode): SyntaxNode | undefined => {
  let current: SyntaxNode | null = node;
  while (current !== null) {
    if (current.name === 'Directive') return current;
    current = current.parent;
  }
  return undefined;
};

/**
 * The slot an adjustment list is attached to, which decides which adjustments are legal.
 *
 * `applies` names the slots each adjustment may be written on, so `{destaque}` on `::item`
 * and on `::titulo` are two different lists — and on a directive with no name yet, none.
 */
const slotOfList = (context: CompletionContext, node: SyntaxNode): string | undefined => {
  const directive = directiveAround(node);
  const name = directive?.getChild('Name');
  return name == null ? undefined : context.state.sliceDoc(name.from, name.to);
};

const slotNames = (
  written: Written,
  manifest: TemplateManifest | undefined,
): CompletionResult | null =>
  manifest === undefined
    ? null
    : result(
        written,
        Object.keys(manifest.slots).map((name) => slotOption(name, manifest)),
      );

const adjustmentNames = (
  context: CompletionContext,
  node: SyntaxNode,
  written: Written,
  manifest: TemplateManifest | undefined,
): CompletionResult | null => {
  if (manifest === undefined) return null;
  const slot = slotOfList(context, node);
  if (slot === undefined) return null;
  return result(
    written,
    Object.entries(manifest.adjustments)
      .filter(([, adjustment]) => adjustment.applies.includes(slot))
      .map(([name]) => adjustmentOption(name, manifest)),
  );
};

/**
 * The values an enum adjustment accepts, read off the `Adjustment` the cursor is in.
 *
 * A flag adjustment takes no value, so the list is empty and the source stands down —
 * which is the honest answer to a `:` written after `{destaque`.
 */
const adjustmentValues = (
  context: CompletionContext,
  adjustment: SyntaxNode,
  written: Written,
  manifest: TemplateManifest | undefined,
): CompletionResult | null => {
  const name = adjustment.getChild('AdjustmentName');
  if (manifest === undefined || name === null) return null;
  const declared = manifest.adjustments[context.state.sliceDoc(name.from, name.to)];
  if (declared?.type !== 'enum' || declared.values === undefined) return null;
  return result(written, declared.values.map(valueOption));
};

/**
 * In the body, the node the cursor resolved to says which list is wanted.
 *
 * Every case is a node the grammar names, and everything else — body text, a comment, a
 * mark, an indented line that happens to start with `::` — falls through to `null`, which
 * is CodeMirror's way of saying "not my turn".
 */
const completeBody = (
  context: CompletionContext,
  node: SyntaxNode,
  analysis: BriefAnalysis,
): CompletionResult | null => {
  const manifest = analysis.manifest;

  switch (node.name) {
    // `::|` — the mark is there and the name is not, so the name goes at the cursor.
    case 'Directive':
      return slotNames(nothingWritten(context), manifest);

    // `::ti|`. The parent guard matters: a `Name` whose parent is an error node is the
    // `template` key of a frontmatter nobody closed, not a directive.
    case 'Name':
      return node.parent?.name === 'Directive'
        ? slotNames(writtenAt(context, node), manifest)
        : null;

    // `::item {|` and `::item {destaque, |` — inside the list but not inside an item.
    case 'Adjustments':
      return adjustmentNames(context, node, nothingWritten(context), manifest);

    // `::item {desta|`
    case 'AdjustmentName':
      return adjustmentNames(context, node, writtenAt(context, node), manifest);

    // `::item {tom: |` — inside an item, past the name, with no value written yet.
    case 'Adjustment':
      return adjustmentValues(context, node, nothingWritten(context), manifest);

    // `::item {tom: cl|`
    case 'AdjustmentValue': {
      const adjustment = node.parent;
      return adjustment === null
        ? null
        : adjustmentValues(context, adjustment, writtenAt(context, node), manifest);
    }

    default:
      return null;
  }
};

/**
 * The completion source, exported so a test can drive it without mounting an editor.
 *
 * Answers `null` whenever there is no analysis yet or nothing sensible to offer, which is
 * CodeMirror's way of saying "not my turn" — a host that adds other sources keeps them.
 */
export function completeBrief(context: CompletionContext): CompletionResult | null {
  const analysis = context.state.field(briefAnalysisField, false);
  if (analysis === undefined) return null;

  const node = syntaxTree(context.state).resolveInner(context.pos, -1);

  return inFrontmatter(node)
    ? completeFrontmatter(context, analysis)
    : completeBody(context, node, analysis);
}

/**
 * Manifest-driven completion, scoped to the brief language.
 *
 * Registered through the language's own data facet rather than as a global source, so the
 * second language this package gained (E8.4, template-lang) does not inherit a completion
 * list built out of brief slots. The facet is also what puts the parser in the state, which
 * is what `completeBrief` now reads.
 */
export function briefCompletion(): Extension {
  return [autocompletion(), briefLanguage.data.of({ autocomplete: completeBrief })];
}
