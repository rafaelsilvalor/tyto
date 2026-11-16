import {
  type Diagnostic,
  type DiagnosticParams,
  type MathItem,
  type SourceRange,
  diagnostic,
  sourceRange,
} from '@tyto/core';

/**
 * The inside of a `$…$` formula → the `MathItem` list core lays out (ADR 0206, TYTO-734).
 *
 * The tokenizer has already decided where the formula starts and ends (`formulas` in
 * `tokens.ts`); this reads what is between the two `$`. The language is small on purpose:
 * `\frac{numerator}{denominator}`, `^{superscript}` and `_{subscript}` (or `^c` and `_c` for
 * one character), groups that may hold any of them again, and four escapes, `\ `, `\$`, `\{`
 * and `\}`. Every other character is text, spaces kept as written (decision 4).
 *
 * Anything else is an error with the range of the characters at fault (decision 5), never a
 * guess: `E_FORMULA_COMMAND` for a `\name` that is not `\frac`, `E_FORMULA_GROUP` for a brace
 * missing, unclosed or out of place, and `E_FORMULA_EMPTY` for `$$` or `{}`. The caller draws
 * a formula with an error as its source text, so `math` is only meaningful without one.
 *
 * Pure: no Node, no DOM (ADR 0010).
 */

export interface ParsedFormula {
  readonly math: readonly MathItem[];
  readonly diagnostics: readonly Diagnostic[];
}

type FormulaCode = 'E_FORMULA_COMMAND' | 'E_FORMULA_GROUP' | 'E_FORMULA_EMPTY';

/** The escapes a formula has; the character after the `\` is what it stands for. */
const ESCAPED = new Set([' ', '$', '{', '}']);
const LETTER = /^[A-Za-z]$/u;

/** One-character script arguments may not be one of these: each means something else. */
const NOT_A_SCRIPT = new Set(['{', '}', '\\', '^', '_', ' ', '\t']);

class Reader {
  readonly diagnostics: Diagnostic[] = [];
  private position = 0;

  constructor(
    private readonly characters: readonly string[],
    /** Source offset of each character, plus one past the last. */
    private readonly offsets: readonly number[],
  ) {}

  /** The source range from character `start` up to the current position. */
  rangeFrom(start: number, end = this.position): SourceRange {
    return sourceRange(this.offsetAt(start), this.offsetAt(end));
  }

  private offsetAt(index: number): number {
    return this.offsets[Math.min(index, this.offsets.length - 1)] ?? 0;
  }

  get at(): number {
    return this.position;
  }

  get done(): boolean {
    return this.position >= this.characters.length;
  }

  peek(ahead = 0): string | undefined {
    return this.characters[this.position + ahead];
  }

  advance(count = 1): void {
    this.position += count;
  }

  report<Code extends FormulaCode>(
    code: Code,
    params: DiagnosticParams<Code>,
    range: SourceRange,
  ): void {
    this.diagnostics.push(diagnostic(code, params, { range }));
  }
}

/** Appends text to a list, merging with text already at its end. */
function pushText(items: MathItem[], text: string): void {
  const last = items[items.length - 1];
  if (last !== undefined && last.kind === 'text') {
    items[items.length - 1] = { kind: 'text', text: last.text + text };
    return;
  }
  items.push({ kind: 'text', text });
}

/** `\name` from the current `\`: the letters after it, or the one character that is not one. */
function commandAt(reader: Reader): string {
  let length = 1;
  if (LETTER.test(reader.peek(1) ?? '')) {
    while (LETTER.test(reader.peek(length) ?? '')) length += 1;
  } else if (reader.peek(1) !== undefined) {
    length = 2;
  }
  let command = '';
  for (let index = 0; index < length; index += 1) command += reader.peek(index) ?? '';
  return command;
}

/**
 * A `{…}` group, which must be next. Returns its items, or `undefined` after reporting what
 * was wrong. `owner` is the character range of what asked for the group, for a missing one.
 */
function group(reader: Reader, owner: SourceRange): MathItem[] | undefined {
  if (reader.peek() !== '{') {
    reader.report('E_FORMULA_GROUP', { problem: 'a {…} group must follow here' }, owner);
    return undefined;
  }
  const start = reader.at;
  reader.advance();
  const items = sequence(reader, true);
  if (reader.peek() !== '}') {
    reader.report(
      'E_FORMULA_GROUP',
      { problem: 'this { is never closed' },
      reader.rangeFrom(start, start + 1),
    );
    return undefined;
  }
  reader.advance();
  if (items.length === 0) {
    reader.report('E_FORMULA_EMPTY', { part: 'group' }, reader.rangeFrom(start));
    return undefined;
  }
  return items;
}

/** What `^` or `_` raises or lowers: a group, or exactly one character that means nothing else. */
function scriptArgument(reader: Reader, owner: SourceRange): MathItem[] | undefined {
  const next = reader.peek();
  if (next === '{') return group(reader, owner);
  if (next === undefined || NOT_A_SCRIPT.has(next)) {
    reader.report(
      'E_FORMULA_GROUP',
      { problem: `${reader.peek(-1) ?? ''} needs one character or a {…} group after it` },
      owner,
    );
    return undefined;
  }
  reader.advance();
  return [{ kind: 'text', text: next }];
}

/**
 * Items up to the end of the formula, or up to the `}` that closes the group being read
 * (`inGroup`), which is left for the caller to consume.
 */
function sequence(reader: Reader, inGroup: boolean): MathItem[] {
  const items: MathItem[] = [];
  while (!reader.done) {
    const character = reader.peek() ?? '';
    const start = reader.at;

    if (character === '}') {
      if (inGroup) return items;
      reader.advance();
      reader.report(
        'E_FORMULA_GROUP',
        { problem: 'this } closes nothing; write \\} for a brace' },
        reader.rangeFrom(start),
      );
      continue;
    }

    if (character === '{') {
      // A group belongs to `\frac`, `^` or `_`. A bare one would be LaTeX's invisible
      // grouping, which draws nothing here, so it is refused rather than silently dropped.
      const bare = group(reader, reader.rangeFrom(start, start + 1));
      if (bare !== undefined) {
        reader.report(
          'E_FORMULA_GROUP',
          { problem: 'a {…} group belongs after \\frac, ^ or _; write \\{ for a brace' },
          reader.rangeFrom(start, start + 1),
        );
      }
      continue;
    }

    if (character === '^' || character === '_') {
      reader.advance();
      const argument = scriptArgument(reader, reader.rangeFrom(start));
      if (argument === undefined) continue;
      const slot = character === '^' ? 'superscript' : 'subscript';
      const last = items[items.length - 1];
      // `x^2_i` is one pair of scripts on one base, as in LaTeX.
      if (last !== undefined && last.kind === 'scripts' && last[slot] === undefined) {
        items[items.length - 1] = { ...last, [slot]: argument };
      } else {
        items.push({ kind: 'scripts', [slot]: argument });
      }
      continue;
    }

    if (character === '\\') {
      const command = commandAt(reader);
      reader.advance([...command].length);
      const escaped = command.slice(1);
      if (command.length === 2 && ESCAPED.has(escaped)) {
        pushText(items, escaped);
        continue;
      }
      if (command === '\\frac') {
        const owner = reader.rangeFrom(start);
        const numerator = group(reader, owner);
        if (numerator === undefined) continue;
        const denominator = group(reader, owner);
        if (denominator === undefined) continue;
        items.push({ kind: 'fraction', numerator, denominator });
        continue;
      }
      reader.report('E_FORMULA_COMMAND', { command }, reader.rangeFrom(start));
      continue;
    }

    reader.advance();
    pushText(items, character);
  }
  return items;
}

/**
 * Parses the formula written at `range` of `text`, both `$` included.
 *
 * Offsets are UTF-16, as every range in a brief is (`docs/brief-language.md`), while the reader
 * walks code points, so a character outside the BMP is one character and two offsets.
 */
export function parseFormula(text: string, range: SourceRange): ParsedFormula {
  const inner = text.slice(range.start + 1, range.end - 1);
  if (inner === '') {
    return {
      math: [],
      diagnostics: [diagnostic('E_FORMULA_EMPTY', { part: 'formula' }, { range })],
    };
  }

  const characters: string[] = [];
  const offsets: number[] = [];
  let offset = range.start + 1;
  for (const character of inner) {
    characters.push(character);
    offsets.push(offset);
    offset += character.length;
  }
  offsets.push(offset);

  const reader = new Reader(characters, offsets);
  const math = sequence(reader, false);
  // The first error only: after it the reader is guessing, and `\frac{}{2}` read on past an
  // empty group would also call `{2}` a group out of place. One fix at a time.
  return { math, diagnostics: reader.diagnostics.slice(0, 1) };
}
