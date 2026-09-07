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

export type {
  Adjustment,
  Bold,
  Break,
  BriefAst,
  Directive,
  Inline,
  Italic,
  Mark,
  RichText,
  Text,
} from './ast.js';

export { parser } from './brief.parser.js';

export { briefHighlighting } from './highlight.js';

export { parseBrief } from './parse-brief.js';
