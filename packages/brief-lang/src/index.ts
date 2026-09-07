/**
 * @tyto/brief-lang — Lezer grammar and parser for the brief language.
 *
 * One grammar, two consumers: `parseBrief` turns the tree into a typed `BriefAst`, and
 * the editor (E8.1) hangs highlighting off the same nodes. That is the point of shipping
 * the grammar rather than a hand-written parser — the compiler and the editor cannot
 * disagree about what a brief means, because they read the same tree.
 *
 * Pure: no Node, no DOM (ADR 0010).
 */

/**
 * The AST types live in `@tyto/core` — `resolve` consumes them and `core` may not import
 * this package back (`packages/core/src/brief/ast.ts`). They are re-exported here so a
 * caller that only talks to the parser has one import.
 */
export type {
  BriefAdjustment,
  Bold,
  Break,
  BriefAst,
  Directive,
  Frontmatter,
  Inline,
  Italic,
  Mark,
  RichText,
  Text,
} from '@tyto/core';

export { parser } from './brief.parser.js';

export { briefHighlighting } from './highlight.js';

export { parseBrief } from './parse-brief.js';
