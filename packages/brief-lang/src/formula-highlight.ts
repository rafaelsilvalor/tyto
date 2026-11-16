import {
  type Input,
  NodeSet,
  NodeType,
  Parser,
  type PartialParse,
  Tree,
  type TreeFragment,
  parseMixed,
} from '@lezer/common';

import { formulaHighlighting } from './highlight.js';

/**
 * The parts of a `$…$` formula as nodes, for the editor to colour (TYTO-743).
 *
 * The brief grammar reads a formula as one token (ADR 0206, `formulas` in `tokens.ts`), so
 * nothing inside it is a node and no style rule can reach its `\frac` or its braces. This is
 * a second, tiny parser mounted on each `Formula` node with `parseMixed`: it splits the
 * formula into flat nodes, one per piece of markup, and leaves its text uncovered so the
 * formula's own tag paints it.
 *
 * **Only the editor mounts it.** `parseBrief` runs the unwrapped `parser` and reads the formula
 * with `parseFormula`, which is the one that decides what a formula means and reports its
 * errors. This one decides only what a piece looks like: it never fails, and a `\name` that is
 * not a command `parseFormula` knows is still coloured as one — the error underline, from the
 * diagnostic, is what tells the author it is wrong.
 *
 * No nesting: a group is its two braces, not a node around its content, because a colour
 * needs nothing more and a flat list cannot be unbalanced.
 *
 * Pure: `@lezer/common` only (ADR 0010).
 */

/** The node ids, in the order `types` defines them. */
const CONTENT = 0;
const MARK = 1;
const COMMAND = 2;
const BRACE = 3;
const SCRIPT = 4;
const ESCAPE = 5;

const nodeSet = new NodeSet([
  // Named `Formula` on purpose. A mount that is not an overlay *replaces* the node it sits on
  // when the tree is walked: the editor's tree shows this node where the brief's `Formula` was,
  // and code asking either tree for a `Formula` (the blocks' first text) finds one.
  NodeType.define({ id: CONTENT, name: 'Formula', top: true }),
  NodeType.define({ id: MARK, name: 'FormulaMark' }),
  NodeType.define({ id: COMMAND, name: 'FormulaCommand' }),
  NodeType.define({ id: BRACE, name: 'FormulaBrace' }),
  NodeType.define({ id: SCRIPT, name: 'FormulaScript' }),
  NodeType.define({ id: ESCAPE, name: 'FormulaEscape' }),
]).extend(formulaHighlighting);

/** The escapes `parseFormula` accepts; any other `\` starts a command. */
const ESCAPED = new Set([' ', '$', '{', '}']);
const LETTER = /^[A-Za-z]$/u;

interface Piece {
  readonly id: number;
  readonly from: number;
  readonly to: number;
}

/** The markup of a formula's source, `$` to `$`, as offsets into it. */
export function formulaPieces(source: string): Piece[] {
  const pieces: Piece[] = [];
  if (source.length < 2) return pieces;
  pieces.push({ id: MARK, from: 0, to: 1 });
  const end = source.endsWith('$') ? source.length - 1 : source.length;
  let at = 1;
  while (at < end) {
    const character = source[at];
    if (character === '\\') {
      let length = 1;
      while (at + length < end && LETTER.test(source[at + length] ?? '')) length += 1;
      if (length === 1 && at + 1 < end) length = 2;
      const isEscape = length === 2 && ESCAPED.has(source[at + 1] ?? '');
      pieces.push({ id: isEscape ? ESCAPE : COMMAND, from: at, to: at + length });
      at += length;
      continue;
    }
    if (character === '{' || character === '}') pieces.push({ id: BRACE, from: at, to: at + 1 });
    else if (character === '^' || character === '_') {
      pieces.push({ id: SCRIPT, from: at, to: at + 1 });
    }
    at += 1;
  }
  if (end < source.length) pieces.push({ id: MARK, from: end, to: source.length });
  return pieces;
}

/** One pass over the whole formula: it is a line at most, and there is nothing to reuse. */
class FormulaParse implements PartialParse {
  parsedPos: number;
  stoppedAt: number | null = null;

  constructor(
    private readonly input: Input,
    private readonly from: number,
    private readonly to: number,
  ) {
    this.parsedPos = from;
  }

  advance(): Tree {
    const source = this.input.read(this.from, this.to);
    const pieces = formulaPieces(source);
    const leaf = (piece: Piece): Tree =>
      new Tree(nodeSet.types[piece.id] as NodeType, [], [], piece.to - piece.from);
    this.parsedPos = this.to;
    return new Tree(
      nodeSet.types[CONTENT] as NodeType,
      pieces.map(leaf),
      pieces.map((piece) => piece.from),
      source.length,
    );
  }

  stopAt(position: number): void {
    this.stoppedAt = position;
  }
}

class FormulaParser extends Parser {
  createParse(
    input: Input,
    _fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const from = ranges[0]?.from ?? 0;
    const to = ranges[ranges.length - 1]?.to ?? input.length;
    return new FormulaParse(input, from, to);
  }
}

const formulaParser = new FormulaParser();

/**
 * The `wrap` that mounts the formula parser on every `Formula` node. The editor configures the
 * brief parser with it; `parseBrief` does not.
 */
export const formulaMounts = parseMixed((node) =>
  node.type.name === 'Formula' ? { parser: formulaParser } : null,
);
