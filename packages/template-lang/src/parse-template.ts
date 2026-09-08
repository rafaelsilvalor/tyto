import type { SyntaxNode, Tree } from '@lezer/common';
import {
  type Diagnostic,
  type Diagnostics,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sortDiagnostics,
  sourceRange,
} from '@tyto/core';

import type {
  AtRule,
  Selector,
  SelectorPart,
  StyleDeclaration,
  StyleItem,
  StyleRule,
  TemplateAttribute,
  TemplateDocument,
  TemplateElement,
  ValueToken,
} from './ast.js';
import { parser } from './template.parser.js';

/**
 * Lezer tree → `TemplateDocument`.
 *
 * A syntax tree and a meaning tree are not the same thing, and three of the differences
 * are the grammar paying the tokenizer: `FunctionName` carries the paren that made it
 * longer than a bare name, `AttributeValue` carries the quotes that delimited it, and a
 * close tag is a node of its own with no link to the opener it should match. All three
 * are undone here.
 *
 * Errors are data, never exceptions (ADR 0013): markup that does not parse comes back as
 * `Err` with one `E_SYNTAX` per place the author has to fix. Pure: no Node, no DOM.
 */

function* children(node: SyntaxNode): Generator<SyntaxNode> {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) yield child;
}

function rangeOf(node: { readonly from: number; readonly to: number }): SourceRange {
  return sourceRange(node.from, node.to);
}

function sliceOf(source: string, node: SyntaxNode): string {
  return source.slice(node.from, node.to);
}

/**
 * What an empty error node means, read from the construct it sits in.
 *
 * Lezer recovers from a missing token by inserting one, which leaves a zero-length error
 * node and no record of what was expected. The enclosing node is that record — the same
 * trick `parse-brief.ts` uses, and the reason the messages are worth writing by hand.
 */
const INCOMPLETE: Readonly<Record<string, string>> = {
  Element: 'this tag is incomplete — a tag is closed with > or />',
  CloseTag: 'this closing tag is incomplete',
  Attribute: 'an attribute value must be quoted, as in class="title"',
  StyleSheet: 'the <style> block is missing its </style>',
  Block: 'a declaration block is missing its closing }',
  NestedBlock: 'an at-rule block is missing its closing }',
  Declaration: 'a declaration needs a value, as in x: 64',
  StyleRule: 'a selector must be followed by a { … } block',
  AtRule: 'an at-rule must be followed by a { … } block',
  FunctionCall: 'a function call is missing its closing )',
  Template: 'this is not markup the template language accepts',
};

const SNIPPET_LIMIT = 24;

function snippet(text: string): string {
  const collapsed = text.replaceAll(/\s+/gu, ' ').trim();
  return collapsed.length > SNIPPET_LIMIT ? `${collapsed.slice(0, SNIPPET_LIMIT)}…` : collapsed;
}

/**
 * Words where a tag was expected.
 *
 * There is no text node in this language — a template draws slots — so `<frame>Turma
 * nova</frame>` is a mistake with a specific fix, and Lezer's recovery reports it as an
 * unfinished tag because the token it wanted was `<`. The stray run is right there in the
 * source; naming it is the difference between "this tag is incomplete" and an author
 * knowing to write `slot="titulo"`.
 */
function strayText(source: string, offset: number): string | undefined {
  let end = offset;
  while (end < source.length && !'<>/'.includes(source[end] ?? '')) end += 1;
  const run = source.slice(offset, end).trim();
  return run === '' ? undefined : run;
}

const MARKUP_PARENTS = new Set(['Element', 'Template']);

function syntaxProblems(tree: Tree, source: string): Diagnostic[] {
  const problems: Diagnostic[] = [];

  tree.iterate({
    enter: (node) => {
      if (!node.type.isError) return;
      const text = source.slice(node.from, node.to);
      const parent = node.node.parent?.name ?? '';
      const stray = MARKUP_PARENTS.has(parent) ? strayText(source, node.from) : undefined;

      const problem =
        text !== ''
          ? `unexpected '${snippet(text)}'`
          : stray !== undefined
            ? `unexpected text '${snippet(stray)}'; a template holds tags, and words come from a slot`
            : (INCOMPLETE[parent] ?? 'something is missing here');

      problems.push(
        diagnostic('E_SYNTAX', { problem }, { range: sourceRange(node.from, node.to) }),
      );
    },
  });

  return problems;
}

/** `"feed"` → `feed`, and the range of what is between the quotes. */
function unquote(source: string, node: SyntaxNode): { value: string; range: SourceRange } {
  const raw = sliceOf(source, node);
  const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  return quoted
    ? { value: raw.slice(1, -1), range: sourceRange(node.from + 1, node.to - 1) }
    : { value: raw, range: rangeOf(node) };
}

const DIMENSION = /^(-?\d+(?:\.\d+)?)(.*)$/u;

function nameOfSelectorPart(source: string, node: SyntaxNode): string {
  const name = node.getChild('SelectorName');
  return name === null ? '' : sliceOf(source, name);
}

function valueTokenOf(source: string, node: SyntaxNode): ValueToken | undefined {
  const range = rangeOf(node);
  switch (node.name) {
    case 'Dimension': {
      const text = sliceOf(source, node);
      const match = DIMENSION.exec(text);
      // The token cannot match without a leading number; the fallback is only for a
      // caller that hands this a node the grammar could not have produced.
      const number = Number(match?.[1] ?? text);
      return { kind: 'dimension', text, number, unit: match?.[2] ?? '', range };
    }
    case 'HexColor':
      return { kind: 'hex', text: sliceOf(source, node), range };
    case 'StringValue':
      return { kind: 'string', text: unquote(source, node).value, range };
    case 'Ident':
      return { kind: 'ident', text: sliceOf(source, node), range };
    case 'Slash':
      return { kind: 'slash', range };
    case 'Comma':
      return { kind: 'comma', range };
    case 'FunctionCall': {
      const args: ValueToken[] = [];
      let name = '';
      for (const child of children(node)) {
        if (child.name === 'FunctionName') {
          // The paren is inside the token so that `var(` outruns `var`; the name is not.
          name = sliceOf(source, child).replace(/\($/u, '');
          continue;
        }
        const argument = valueTokenOf(source, child);
        if (argument !== undefined) args.push(argument);
      }
      return { kind: 'call', name, args, range };
    }
    default:
      return undefined;
  }
}

function valueTokensOf(source: string, node: SyntaxNode | null): ValueToken[] {
  if (node === null) return [];
  const tokens: ValueToken[] = [];
  for (const child of children(node)) {
    const token = valueTokenOf(source, child);
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

function attributeOf(source: string, node: SyntaxNode): TemplateAttribute | undefined {
  const nameNode = node.getChild('AttributeName');
  if (nameNode === null) return undefined;
  const valueNode = node.getChild('AttributeValue');
  const value =
    valueNode === null
      ? { value: '', range: sourceRange(nameNode.to, nameNode.to) }
      : unquote(source, valueNode);

  return {
    name: sliceOf(source, nameNode),
    value: value.value,
    range: rangeOf(node),
    nameRange: rangeOf(nameNode),
    valueRange: value.range,
  };
}

function elementOf(source: string, node: SyntaxNode): TemplateElement | undefined {
  const tagNode = node.firstChild;
  if (tagNode === null || tagNode.name !== 'TagName') return undefined;

  const attributes: TemplateAttribute[] = [];
  const nested: TemplateElement[] = [];

  for (const child of children(node)) {
    if (child.name === 'Attribute') {
      const attribute = attributeOf(source, child);
      if (attribute !== undefined) attributes.push(attribute);
    } else if (child.name === 'Element') {
      const element = elementOf(source, child);
      if (element !== undefined) nested.push(element);
    }
  }

  return {
    tag: sliceOf(source, tagNode),
    attributes,
    children: nested,
    range: rangeOf(node),
    tagRange: rangeOf(tagNode),
  };
}

/**
 * A close tag that names something else than its opener.
 *
 * The grammar cannot check it — an LR parser matches shapes, not spellings — and letting
 * it through would nest the rest of the file under the wrong element. Reported here so
 * the author sees which two tags disagree rather than a pile of unexpected tokens.
 */
function closeTagProblems(source: string, tree: Tree): Diagnostic[] {
  const problems: Diagnostic[] = [];

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Element') return;
      const opener = node.node.firstChild;
      const closer = node.node.getChild('CloseTag')?.getChild('TagName') ?? null;
      if (opener === null || closer === null) return;
      const open = sliceOf(source, opener);
      const close = sliceOf(source, closer);
      if (open === close) return;
      problems.push(
        diagnostic(
          'E_SYNTAX',
          { problem: `<${open}> is closed by </${close}>` },
          { range: rangeOf(closer) },
        ),
      );
    },
  });

  return problems;
}

function selectorOf(source: string, node: SyntaxNode): Selector {
  const parts: SelectorPart[] = [];

  for (const child of children(node)) {
    const range = rangeOf(child);
    switch (child.name) {
      case 'ClassSelector':
        parts.push({ kind: 'class', name: nameOfSelectorPart(source, child), range });
        break;
      case 'IdSelector':
        parts.push({ kind: 'id', name: nameOfSelectorPart(source, child), range });
        break;
      case 'TagSelector':
        parts.push({ kind: 'tag', name: nameOfSelectorPart(source, child), range });
        break;
      case 'RootSelector':
        parts.push({ kind: 'root', range });
        break;
      default:
        break;
    }
  }

  return { parts, range: rangeOf(node) };
}

function declarationOf(source: string, node: SyntaxNode): StyleDeclaration | undefined {
  const propertyNode = node.getChild('PropertyName');
  if (propertyNode === null) return undefined;
  const valueNode = node.getChild('Value');

  return {
    property: sliceOf(source, propertyNode),
    value: valueTokensOf(source, valueNode),
    range: rangeOf(node),
    propertyRange: rangeOf(propertyNode),
    valueRange:
      valueNode === null ? sourceRange(propertyNode.to, propertyNode.to) : rangeOf(valueNode),
  };
}

function styleRuleOf(source: string, node: SyntaxNode): StyleRule {
  const selectors: Selector[] = [];
  const declarations: StyleDeclaration[] = [];

  const list = node.getChild('SelectorList');
  if (list !== null) {
    for (const child of children(list)) {
      if (child.name === 'Selector') selectors.push(selectorOf(source, child));
    }
  }

  const block = node.getChild('Block');
  if (block !== null) {
    for (const child of children(block)) {
      if (child.name !== 'Declaration') continue;
      const declaration = declarationOf(source, child);
      if (declaration !== undefined) declarations.push(declaration);
    }
  }

  return { selectors, declarations, range: rangeOf(node) };
}

function atRuleOf(source: string, node: SyntaxNode): AtRule | undefined {
  const keywordNode = node.getChild('AtKeyword');
  if (keywordNode === null) return undefined;

  const prelude: ValueToken[] = [];
  const rules: StyleRule[] = [];
  let preludeEnd = keywordNode.to;

  for (const child of children(node)) {
    if (child.name === 'NestedBlock') {
      for (const nested of children(child)) {
        if (nested.name === 'StyleRule') rules.push(styleRuleOf(source, nested));
      }
      continue;
    }
    if (child.from === keywordNode.from && child.name === 'AtKeyword') continue;
    const token = valueTokenOf(source, child);
    if (token === undefined) continue;
    prelude.push(token);
    preludeEnd = child.to;
  }

  return {
    keyword: sliceOf(source, keywordNode).slice(1),
    prelude,
    rules,
    range: rangeOf(node),
    keywordRange: rangeOf(keywordNode),
    preludeRange: sourceRange(keywordNode.to, Math.max(keywordNode.to, preludeEnd)),
  };
}

/**
 * The markup of one `template.html`.
 *
 * Every `<style>` block in the file contributes to one list, in source order, because the
 * cascade in this language is source order and nothing else — splitting the stylesheet in
 * two must not change which declaration wins.
 */
export function parseTemplate(source: string): Result<TemplateDocument, Diagnostics> {
  const tree = parser.parse(source);
  const problems = [...syntaxProblems(tree, source), ...closeTagProblems(source, tree)];
  if (problems.length > 0) return err(sortDiagnostics(problems));

  const elements: TemplateElement[] = [];
  const styles: StyleItem[] = [];

  for (const child of children(tree.topNode)) {
    if (child.name === 'Element') {
      const element = elementOf(source, child);
      if (element !== undefined) elements.push(element);
      continue;
    }
    if (child.name !== 'StyleSheet') continue;
    for (const rule of children(child)) {
      if (rule.name !== 'Rule') continue;
      const inner = rule.firstChild;
      if (inner === null) continue;
      if (inner.name === 'StyleRule') {
        styles.push({ kind: 'rule', rule: styleRuleOf(source, inner) });
      } else if (inner.name === 'AtRule') {
        const at = atRuleOf(source, inner);
        if (at !== undefined) styles.push({ kind: 'at', at });
      }
    }
  }

  return ok({ elements, styles, range: sourceRange(0, source.length) });
}

/**
 * An attribute value read as if it were a declaration's value.
 *
 * `bg="var(--bg)"` and `opacity="0.95"` are values in every sense except where they are
 * written, and the alternative to reusing the tokenizer is a second, smaller one that
 * would disagree with it about something eventually. The wrapper's prefix is a fixed
 * length, so every range shifts by the same amount and lands back inside the quotes.
 */
const VALUE_WRAPPER = '<style>v{x:';

export function parseAttributeValue(text: string, at: SourceRange): ValueToken[] | undefined {
  const tree = parser.parse(`${VALUE_WRAPPER}${text}}</style>`);
  const declaration = tree.topNode
    .getChild('StyleSheet')
    ?.getChild('Rule')
    ?.getChild('StyleRule')
    ?.getChild('Block')
    ?.getChild('Declaration');
  const value = declaration?.getChild('Value') ?? null;
  if (value === null) return undefined;

  let broken = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) broken = true;
    },
  });
  if (broken) return undefined;

  const shift = at.start - VALUE_WRAPPER.length;
  const clamp = (offset: number): number => Math.min(Math.max(offset + shift, at.start), at.end);
  const shifted = (token: ValueToken): ValueToken => {
    const range = sourceRange(clamp(token.range.start), clamp(token.range.end));
    return token.kind === 'call'
      ? { ...token, args: token.args.map(shifted), range }
      : { ...token, range };
  };

  return valueTokensOf(`${VALUE_WRAPPER}${text}}</style>`, value).map(shifted);
}
