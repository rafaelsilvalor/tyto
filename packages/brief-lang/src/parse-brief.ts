import type { SyntaxNode, Tree } from '@lezer/common';
import {
  type BriefAdjustment,
  type BriefAst,
  type Diagnostic,
  type Diagnostics,
  type Directive,
  type Frontmatter,
  type Inline,
  type Result,
  type RichText,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sortDiagnostics,
  sourceRange,
} from '@tyto/core';

import { parser } from './brief.parser.js';
import { parseFrontmatter } from './frontmatter.js';

/**
 * Lezer tree → typed `BriefAst`.
 *
 * The tree is a syntax tree and the AST is a meaning tree, so this is not a rename pass.
 * Three things the grammar had to do for the tokenizer are undone here, each because the
 * shape exists for the parser rather than for the author (`docs/brief-language.md`): the
 * slash the `Namespace` token has to carry, the space between a directive name and its
 * inline body, and the `Space` nodes that split one run of text into several because a
 * `Text` token may not begin with a space.
 *
 * Errors are data, never exceptions (ADR 0013): a brief that does not parse comes back as
 * `Err` with one `E_SYNTAX` per place the author has to fix. Pure: no Node, no DOM.
 */

/** Children in document order, error nodes included. */
function* children(node: SyntaxNode): Generator<SyntaxNode> {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) yield child;
}

function rangeOf(node: { readonly from: number; readonly to: number }): SourceRange {
  return sourceRange(node.from, node.to);
}

function sliceOf(text: string, node: SyntaxNode): string {
  return text.slice(node.from, node.to);
}

/**
 * What an empty error node means, read from the construct it sits in.
 *
 * Lezer recovers from a missing closing token by inserting it, which leaves a zero-length
 * error node and no record of what was expected. The enclosing node is that record: an
 * empty error inside `Bold` is a closing `**` that never arrived.
 */
const INCOMPLETE: Readonly<Record<string, string>> = {
  Bold: 'a bold run is missing its closing **',
  Italic: 'an italic run is missing its closing *',
  Mark: 'a mark is missing its closing {/}',
  Adjustments: 'an adjustment list is missing its closing }',
  Adjustment: 'an adjustment is incomplete',
  Directive: 'this directive is incomplete',
  BodyLine: 'this body line is incomplete',
  // At the top level the only blank the grammar cannot place is an indent with no
  // directive above it: nothing else in the language may start a line with a space.
  Brief: 'an indented line must follow a directive',
};

const SNIPPET_LIMIT = 24;

/** One line, one space between words, short enough to sit in a gutter. */
function snippet(source: string): string {
  const collapsed = source.replaceAll(/\s+/gu, ' ').trim();
  return collapsed.length > SNIPPET_LIMIT ? `${collapsed.slice(0, SNIPPET_LIMIT)}…` : collapsed;
}

/**
 * Every error node the parser left, one diagnostic per position.
 *
 * A run of adjacent closers leaves several error nodes at the same offset — four for
 * `**bold *italic***`, one per open run recovery had to close. They are one mistake, and
 * four squiggles on one character is noise the author has to read past, so the first at
 * each position wins.
 */
function syntaxDiagnostics(tree: Tree, text: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  const enclosing: string[] = [];

  tree.iterate({
    enter: (node) => {
      if (node.type.isError && !seen.has(`${node.from}:${node.to}`)) {
        seen.add(`${node.from}:${node.to}`);
        const shown = snippet(text.slice(node.from, node.to));
        const parent = enclosing[enclosing.length - 1] ?? 'Brief';
        const problem =
          shown === ''
            ? (INCOMPLETE[parent] ?? 'something is missing here')
            : `unexpected '${shown}'`;
        found.push(diagnostic('E_SYNTAX', { problem }, { range: rangeOf(node) }));
      }
      enclosing.push(node.name);
      return true;
    },
    leave: () => {
      enclosing.pop();
    },
  });

  return found;
}

/** `Text`, `Space` and `EscapedDirective` all contribute characters; the rest is markup. */
function literalOf(text: string, node: SyntaxNode): string | undefined {
  switch (node.name) {
    case 'Text':
    case 'Space':
      return sliceOf(text, node);
    // `\::` is how a body line starts with a literal `::`; the AST carries what it meant.
    case 'EscapedDirective':
      return '::';
    default:
      return undefined;
  }
}

/**
 * Appends text, merging with whatever text is already at the end.
 *
 * The grammar splits `Turma nova` into `Text` and `Space` nodes because a `Text` token may
 * not begin with a space; nothing downstream should have to know that. The merged range
 * still covers exactly the characters the merged value came from — with the one exception
 * an escape forces, where three source characters produce two.
 */
function pushText(target: Inline[], value: string, from: number, to: number): void {
  const last = target[target.length - 1];
  if (last !== undefined && last.kind === 'text') {
    target[target.length - 1] = {
      kind: 'text',
      value: last.value + value,
      range: sourceRange(last.range.start, to),
    };
    return;
  }
  target.push({ kind: 'text', value, range: sourceRange(from, to) });
}

function appendInlines(target: Inline[], nodes: Iterable<SyntaxNode>, text: string): void {
  for (const node of nodes) {
    const literal = literalOf(text, node);
    if (literal !== undefined) {
      pushText(target, literal, node.from, node.to);
      continue;
    }

    switch (node.name) {
      case 'Bold':
      case 'Italic':
        target.push({
          kind: node.name === 'Bold' ? 'bold' : 'italic',
          children: inlinesOf(children(node), text),
          range: rangeOf(node),
        });
        break;
      case 'Break':
        target.push({ kind: 'break', range: rangeOf(node) });
        break;
      case 'Mark': {
        const key = node.getChild('MarkName');
        const value = node.getChild('MarkValue');
        target.push({
          kind: 'mark',
          key: key === null ? '' : sliceOf(text, key),
          value: value === null ? '' : sliceOf(text, value),
          children: inlinesOf(
            [...children(node)].filter((child) => child !== key && child !== value),
            text,
          ),
          range: rangeOf(node),
        });
        break;
      }
      // Error nodes are reported by `syntaxDiagnostics`, and a brief that has one never
      // reaches a caller. Skipping them keeps half-built nodes out of the AST.
      default:
        break;
    }
  }
}

function inlinesOf(nodes: Iterable<SyntaxNode>, text: string): RichText {
  const inlines: Inline[] = [];
  appendInlines(inlines, nodes, text);
  return inlines;
}

/**
 * The directive's body, inline part and indented block joined into one `RichText`.
 *
 * The boundary between two block lines becomes a `Break`, the same node a trailing `\`
 * produces. The author wrote three lines and means three lines; the language has no other
 * way to say so, and concatenating them would silently glue two words together. No break
 * is emitted before the first line, where the boundary separates the body from the
 * directive name rather than one line of text from the next.
 */
function bodyOf(node: SyntaxNode, text: string): RichText {
  const body: Inline[] = [];

  for (const child of children(node)) {
    if (child.name === 'InlineBody') {
      const parts = [...children(child)];
      // The space after the directive name lives inside the body, because after the name
      // both readings start with the same token and only a `{` tells them apart.
      if (parts[0]?.name === 'Space') parts.shift();
      appendInlines(body, parts, text);
    } else if (child.name === 'BodyLine') {
      if (body.length > 0) {
        body.push({ kind: 'break', range: sourceRange(child.from, child.from + 1) });
      }
      const blockText = child.getChild('BlockText');
      if (blockText !== null) appendInlines(body, children(blockText), text);
    }
  }

  return body;
}

function adjustmentsOf(node: SyntaxNode, text: string): readonly BriefAdjustment[] {
  const list = node.getChild('Adjustments');
  if (list === null) return [];

  return list.getChildren('Adjustment').map((entry) => {
    const name = entry.getChild('AdjustmentName');
    const value = entry.getChild('AdjustmentValue');
    return {
      name: name === null ? '' : sliceOf(text, name),
      // Spread rather than assign undefined: exactOptionalPropertyTypes tells an absent
      // key from an undefined one, and `{destaque}` has no value at all.
      ...(value === null ? {} : { value: sliceOf(text, value) }),
      range: rangeOf(entry),
    };
  });
}

/** The line break that ends a directive is punctuation, not part of what it says. */
function withoutTrailingBreak(text: string, from: number, to: number): SourceRange {
  let end = to;
  if (text[end - 1] === '\n') end -= 1;
  if (text[end - 1] === '\r') end -= 1;
  return sourceRange(from, Math.max(from, end));
}

/** `::` — the two characters a directive opens with, which `nameRange` starts after. */
const DIRECTIVE_MARK = 2;

function directiveOf(node: SyntaxNode, text: string): Directive {
  const name = node.getChild('Name');
  const namespace = node.getChild('Namespace');

  // `Namespace` carries its own slash, so starting there spans `ai/caption` whole. With no
  // name node there is no name to point at, and an empty span where one would have started
  // is the honest answer — a directive that far gone is an `E_SYNTAX` anyway.
  const nameStart = (namespace ?? name)?.from ?? node.from + DIRECTIVE_MARK;
  const nameEnd = name?.to ?? nameStart;

  return {
    name: name === null ? '' : sliceOf(text, name),
    // The token has to end at the slash for longest match to tell `ai/` from `ai`; the
    // name of the namespace does not include it.
    ...(namespace === null ? {} : { namespace: sliceOf(text, namespace).slice(0, -1) }),
    adjustments: adjustmentsOf(node, text),
    body: bodyOf(node, text),
    range: withoutTrailingBreak(text, node.from, node.to),
    nameRange: sourceRange(nameStart, nameEnd),
  };
}

/**
 * Parses a brief into its AST, or into the diagnostics that say why it cannot be one.
 *
 * Comments and blank lines are dropped: they are how a brief is written, not what it
 * says, and nothing downstream renders them.
 */
export function parseBrief(text: string): Result<BriefAst, Diagnostics> {
  const tree = parser.parse(text);
  const top = tree.topNode;
  const diagnostics: Diagnostic[] = syntaxDiagnostics(tree, text);

  let frontmatter: Frontmatter = { data: {}, ranges: {} };
  const directives: Directive[] = [];

  for (const child of children(top)) {
    if (child.name === 'Frontmatter') {
      const parsed = parseFrontmatter(text, child.from, child.to);
      frontmatter = { data: parsed.data, ranges: parsed.ranges, range: rangeOf(child) };
      diagnostics.push(...parsed.diagnostics);
    } else if (child.name === 'Directive') {
      directives.push(directiveOf(child, text));
    }
  }

  if (diagnostics.length > 0) return err(sortDiagnostics(diagnostics));

  return ok({ frontmatter, directives, range: rangeOf(top) });
}
