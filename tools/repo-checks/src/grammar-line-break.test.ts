import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `isLineEnd` and `afterLineEnd` in `packages/brief-lang/src/tokens.ts` are the grammar's
 * `lineBreak` token written a second time, by hand. They have to be: an external tokenizer
 * scans the input itself to find the `---` fences, so it cannot reach a rule the grammar
 * compiles away. A comment at each end says the two must move together and nothing breaks
 * when only one does — the drift TYTO-64 spent a card fixing, waiting to happen again.
 *
 * Same shape as `grammar-identifier.test.ts`, one level up: that file compares a token to a
 * regex, this one compares a token to a hand-written scanner. A fence recognised here but
 * not there, or the other way round, is a brief that half-parses and blames the wrong line.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readRepoFile = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const GRAMMAR = 'packages/brief-lang/src/brief.grammar';
const TOKENS = 'packages/brief-lang/src/tokens.ts';

/**
 * The body of a named token in the `@tokens` block, as written.
 *
 * Deliberately a line match and not a parse of the grammar, for the reason
 * `grammar-identifier.test.ts` gives: Lezer's own parser is not a dependency here, and a
 * rule that fails when it cannot find the token is worth more than one that half-understands
 * every shape the file could take.
 */
function tokenBody(grammar: string, name: string): string {
  const match = new RegExp(`^\\s*${name}\\s*\\{(.+)\\}\\s*$`, 'mu').exec(grammar);
  expect(match, `${GRAMMAR} declares no token '${name}'`).not.toBeNull();
  return match![1]!.trim();
}

/** The escapes a Lezer string literal may carry here, as code points. */
const ESCAPES: ReadonlyMap<string, number> = new Map([
  ['n', 10],
  ['r', 13],
  ['t', 9],
  ['\\', 92],
  ['"', 34],
]);

/** One `"…"` literal as code points, refusing an escape this file has no rule for. */
function literalCodePoints(literal: string): number[] {
  const points: number[] = [];

  for (let index = 0; index < literal.length; index += 1) {
    const character = literal[index]!;
    if (character !== '\\') {
      points.push(character.codePointAt(0)!);
      continue;
    }
    const escaped = literal[index + 1];
    const point = escaped === undefined ? undefined : ESCAPES.get(escaped);
    if (point === undefined) throw new Error(`cannot translate the escape '\\${escaped ?? ''}'`);
    points.push(point);
    index += 1;
  }

  return points;
}

/**
 * A Lezer token body of alternated string literals — `"\n" | "\r" "\n"?` — as the set of
 * character sequences it accepts, each sequence written as code points joined by a comma.
 *
 * Only the shape `lineBreak` actually uses is understood, and anything else throws rather
 * than being approximated. A translation that quietly accepted a wider grammar would let
 * exactly the drift this file exists to catch through.
 */
function lineEndingsOf(body: string): ReadonlySet<string> {
  const term = /"((?:[^"\\]|\\.)*)"([?]?)/gu;
  const endings = new Set<string>();

  for (const alternative of body.split('|')) {
    let consumed = 0;
    let sequences: number[][] = [[]];

    for (const match of alternative.matchAll(term)) {
      const skipped = alternative.slice(consumed, match.index);
      if (skipped.trim() !== '') {
        throw new Error(`cannot translate '${skipped.trim()}' in the token body '${body}'`);
      }

      const points = literalCodePoints(match[1]!);
      const required = sequences.map((sequence) => [...sequence, ...points]);
      // `"\n"?` means the alternative accepts the sequence with and without it, so both
      // stay in play until the end rather than one being chosen here.
      sequences = match[2] === '?' ? [...required, ...sequences] : required;
      consumed = match.index + match[0].length;
    }

    const trailing = alternative.slice(consumed).trim();
    if (trailing !== '') {
      throw new Error(`cannot translate '${trailing}' in the token body '${body}'`);
    }

    for (const sequence of sequences) {
      if (sequence.length === 0) throw new Error(`no string literal in '${alternative.trim()}'`);
      if (sequence.length > 2) {
        throw new Error(`cannot translate a line ending of ${sequence.length} characters`);
      }
      endings.add(sequence.join(','));
    }
  }

  if (endings.size === 0) throw new Error(`no alternative in the token body '${body}'`);
  return endings;
}

/** The code point a line ending starts with — what a scanner tests one character at a time. */
const startersOf = (endings: ReadonlySet<string>): ReadonlySet<number> =>
  new Set([...endings].map((ending) => Number(ending.split(',')[0])));

/** The two-character endings — what a scanner has to step over as one break. */
const pairsOf = (endings: ReadonlySet<string>): ReadonlySet<string> =>
  new Set([...endings].filter((ending) => ending.includes(',')));

/** `const NEWLINE = 10;` — the names `tokens.ts` gives the code points it compares against. */
function codePointConstants(module: string): ReadonlyMap<string, number> {
  const constants = new Map<string, number>();
  for (const match of module.matchAll(/^const ([A-Z_][A-Z0-9_]*) = (\d+);$/gmu)) {
    constants.set(match[1]!, Number(match[2]!));
  }
  return constants;
}

/** The body of a top-level `function name(…): … { … }`, up to the first line that closes it. */
function functionBody(module: string, name: string): string {
  const match = new RegExp(`^function ${name}\\([^)]*\\)[^{]*\\{\\n([\\s\\S]*?)\\n\\}$`, 'mu').exec(
    module,
  );
  expect(match, `${TOKENS} declares no function '${name}'`).not.toBeNull();
  return match![1]!;
}

/** Every `code === NAME` in a body, as the code points those names stand for. */
function comparedCodePoints(body: string, constants: ReadonlyMap<string, number>): Set<number> {
  const points = new Set<number>();
  for (const match of body.matchAll(/===\s*([A-Z_][A-Z0-9_]*)/gu)) {
    const point = constants.get(match[1]!);
    if (point === undefined) throw new Error(`${TOKENS} compares against unknown '${match[1]!}'`);
    points.add(point);
  }
  return points;
}

const grammar = readRepoFile(GRAMMAR);
const tokens = readRepoFile(TOKENS);
const constants = codePointConstants(tokens);

describe("the tokenizer's copy of the grammar line break", () => {
  it('ends a line on the same characters brief.grammar does', () => {
    const fromGrammar = startersOf(lineEndingsOf(tokenBody(grammar, 'lineBreak')));
    const fromTokens = comparedCodePoints(functionBody(tokens, 'isLineEnd'), constants);

    expect(
      [...fromTokens].sort(),
      `isLineEnd in ${TOKENS} no longer ends a line where 'lineBreak' in ${GRAMMAR} does. Change both or neither.`,
    ).toEqual([...fromGrammar].sort());
  });

  it('steps over the same multi-character endings brief.grammar joins', () => {
    const fromGrammar = pairsOf(lineEndingsOf(tokenBody(grammar, 'lineBreak')));
    const body = functionBody(tokens, 'afterLineEnd');
    const fromTokens = new Set(
      [...body.matchAll(/===\s*([A-Z_][A-Z0-9_]*)\s*&&[^=]*===\s*([A-Z_][A-Z0-9_]*)/gu)].map(
        (match) => `${constants.get(match[1]!)!},${constants.get(match[2]!)!}`,
      ),
    );

    expect(
      [...fromTokens].sort(),
      `afterLineEnd in ${TOKENS} no longer steps over what 'lineBreak' in ${GRAMMAR} joins. Change both or neither.`,
    ).toEqual([...fromGrammar].sort());
  });

  it('names the grammar in the comment above it, so the next reader finds this check', () => {
    const comment = tokens.slice(0, tokens.indexOf('function isLineEnd'));
    expect(comment).toContain('lineBreak');
  });
});

describe('the check itself', () => {
  it('disagrees when the grammar gains an ending the tokenizer does not know', () => {
    const widened = startersOf(lineEndingsOf('"\\n" | "\\r" "\\n"? | "\\t"'));
    const fromTokens = comparedCodePoints(functionBody(tokens, 'isLineEnd'), constants);

    expect([...widened].sort()).not.toEqual([...fromTokens].sort());
  });

  it('disagrees when the grammar loses one the tokenizer still knows', () => {
    const narrowed = startersOf(lineEndingsOf('"\\n"'));
    const fromTokens = comparedCodePoints(functionBody(tokens, 'isLineEnd'), constants);

    expect([...narrowed].sort()).not.toEqual([...fromTokens].sort());
  });

  it('reads an optional literal as both sequences rather than choosing one', () => {
    expect(lineEndingsOf('"\\n" | "\\r" "\\n"?')).toEqual(new Set(['10', '13,10', '13']));
  });

  it('refuses a token body it cannot translate rather than approximating one', () => {
    expect(() => lineEndingsOf('$[\\n\\r]')).toThrow(/cannot translate/u);
    expect(() => lineEndingsOf('"\\n" lineBreak')).toThrow(/cannot translate/u);
    expect(() => lineEndingsOf('"\\u{2028}"')).toThrow(/cannot translate the escape/u);
    expect(() => lineEndingsOf('"\\r" "\\n" "\\n"')).toThrow(/3 characters/u);
    expect(() => lineEndingsOf('   ')).toThrow(/no string literal/u);
  });
});
