import { type Diagnostic, type Result, diagnostic, err, ok, sourceRange } from '@tyto/core';

/**
 * `tyto-pattern/1`, the one pattern dialect every recipe verb that matches text compiles
 * through (ADR 0136): `where … matches`, and later `rules`, `extract`, `rewrite` and `urls`.
 *
 * The syntax is JavaScript's, always with the flags `iu`. Two things make it a dialect rather
 * than a bare `RegExp`:
 *
 * - **`\b`, `\w` and `\d` mean what they mean in Python 3**, which knows every letter and
 *   digit. JavaScript's know ASCII alone, even under `u`, so `\bpágina` would find a boundary
 *   inside a word. `\B`, `\W` and `\D` are rewritten to match.
 * - **A guard refuses what can make matching time grow without bound** before anything runs:
 *   a backreference, a lookaround the author wrote (the Unicode `\b` is the only lookaround,
 *   and Tyto writes it), and a quantifier over something already quantified (star height above
 *   one). A pattern holds at most 512 characters and is tested against at most the first 4,096
 *   characters of a cell, so even an accepted pattern meets bounded input.
 *
 * The guard is a scan of the pattern's text, not a full parser: what it does not recognise it
 * leaves to `RegExp`, whose refusal becomes `E_RECIPE_PATTERN` over the whole pattern.
 */
export const PATTERN_DIALECT = 'tyto-pattern/1';

export const PATTERN_LIMITS = {
  /** Characters in the pattern as written. */
  patternLength: 512,
  /** Characters of a cell a pattern is tested against; the rest is never read. */
  inputLength: 4096,
} as const;

export interface CompiledPattern {
  /** The pattern as the author wrote it. */
  readonly source: string;
  /** The compiled expression, flags `iu`. Test it only against `boundedInput(text)`. */
  readonly expression: RegExp;
  /** Whether the pattern is found in the first `PATTERN_LIMITS.inputLength` characters. */
  readonly test: (text: string) => boolean;
}

/** The part of a text a pattern may read. Cut at a code point, never inside a surrogate pair. */
export function boundedInput(text: string): string {
  if (text.length <= PATTERN_LIMITS.inputLength) return text;
  const cut = text.slice(0, PATTERN_LIMITS.inputLength);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

const WORD = String.raw`[\p{L}\p{N}_]`;
const NOT_WORD = String.raw`[^\p{L}\p{N}_]`;
const WORD_BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const NOT_WORD_BOUNDARY = `(?:(?<=${WORD})(?=${WORD})|(?<!${WORD})(?!${WORD}))`;

/**
 * Compiles a pattern, or answers every construct the guard refuses, each at its range.
 * `offset` is where the pattern's first character sits in the recipe.
 */
export function compilePattern(
  pattern: string,
  offset = 0,
): Result<CompiledPattern, readonly Diagnostic[]> {
  const whole = sourceRange(offset, offset + pattern.length);
  if (pattern.length > PATTERN_LIMITS.patternLength) {
    return err([
      diagnostic(
        'E_RECIPE_PATTERN',
        {
          problem:
            `it is ${pattern.length} characters long, and ${PATTERN_DIALECT} accepts at most ` +
            `${PATTERN_LIMITS.patternLength}`,
        },
        { range: whole },
      ),
    ]);
  }
  if (pattern === '') {
    return err([
      diagnostic(
        'E_RECIPE_PATTERN',
        { problem: 'it is empty, and would match every cell' },
        {
          range: whole,
        },
      ),
    ]);
  }

  const scanned = scan(pattern);
  if (scanned.refusals.length > 0) {
    return err(
      scanned.refusals.map(({ construct, problem, start, end }) =>
        diagnostic(
          'E_RECIPE_PATTERN_UNSAFE',
          { construct, problem },
          { range: sourceRange(offset + start, offset + end) },
        ),
      ),
    );
  }

  let expression: RegExp;
  try {
    expression = new RegExp(scanned.rewritten, 'iu');
  } catch (error) {
    // `RegExp` names no position, so the diagnostic covers the pattern. Its message quotes the
    // rewritten form, which the author never wrote; only the reason after the last colon stays.
    const reason = error instanceof Error ? (error.message.split(': ').pop() ?? '') : '';
    return err([
      diagnostic(
        'E_RECIPE_PATTERN',
        { problem: `it is not a valid regular expression (${reason.toLowerCase()})` },
        { range: whole },
      ),
    ]);
  }
  return ok({
    source: pattern,
    expression,
    test: (text: string) => expression.test(boundedInput(text)),
  });
}

interface Refusal {
  readonly construct: string;
  readonly problem: string;
  readonly start: number;
  readonly end: number;
}

interface Scanned {
  readonly rewritten: string;
  readonly refusals: readonly Refusal[];
}

/** What a quantifier may apply to: an atom with the star height inside it, or an assertion. */
interface Quantifiable {
  readonly start: number;
  readonly height: number;
  readonly assertion: boolean;
}

interface Group {
  readonly start: number;
  height: number;
}

const QUANTIFIER = /^(?:[*+?]|\{(\d+)(?:(,)(\d*))?\})/u;

/**
 * Walks the pattern once: rewrites the three Unicode classes, and measures star height with a
 * stack of open groups. A quantifier "repeats" when it can match its atom more than one way
 * in length (`*`, `+`, `{2,5}`, `{2,}`); `?` and `{3}` do not, so `(ab{3})+` has height one.
 */
function scan(pattern: string): Scanned {
  const refusals: Refusal[] = [];
  const groups: Group[] = [{ start: 0, height: 0 }];
  let rewritten = '';
  let last: Quantifiable | undefined;
  let index = 0;

  const current = (): Group => groups[groups.length - 1] ?? { start: 0, height: 0 };
  const refuse = (construct: string, problem: string, start: number, end: number) => {
    refusals.push({ construct, problem, start, end });
  };

  while (index < pattern.length) {
    const start = index;
    const char = pattern[index] ?? '';

    if (char === '\\') {
      const escape = readEscape(pattern, index, false);
      if (escape.refusal !== undefined) refuse(...escape.refusal);
      rewritten += escape.rewritten;
      index = escape.end;
      last = { start, height: 0, assertion: escape.assertion };
      continue;
    }

    if (char === '[') {
      const characterClass = readClass(pattern, index);
      for (const refusal of characterClass.refusals) refuse(...refusal);
      rewritten += characterClass.rewritten;
      index = characterClass.end;
      last = { start, height: 0, assertion: false };
      continue;
    }

    if (char === '(') {
      const head = pattern.slice(index, index + 4);
      const lookaround = /^\(\?(?:=|!|<=|<!)/u.exec(head);
      if (lookaround !== null) {
        refuse(
          'a lookaround',
          'only the Unicode \\b Tyto writes may look around, because a lookaround the author ' +
            'writes can rescan the text from every position',
          start,
          start + lookaround[0].length,
        );
      }
      groups.push({ start, height: 0 });
      rewritten += char;
      index += 1;
      last = undefined;
      continue;
    }

    if (char === ')') {
      const closed = groups.length > 1 ? groups.pop() : undefined;
      rewritten += char;
      index += 1;
      if (closed !== undefined) {
        current().height = Math.max(current().height, closed.height);
        last = { start: closed.start, height: closed.height, assertion: false };
      } else {
        last = undefined;
      }
      continue;
    }

    if (char === '|') {
      rewritten += char;
      index += 1;
      last = undefined;
      continue;
    }

    const quantifier = QUANTIFIER.exec(pattern.slice(index));
    if (quantifier !== null) {
      let end = index + quantifier[0].length;
      if (pattern[end] === '?') end += 1;
      rewritten += pattern.slice(index, end);
      index = end;
      if (last === undefined) continue; // nothing to repeat: `RegExp` says so
      if (last.assertion) {
        refuse(
          'a quantified assertion',
          'an anchor or a word boundary matches no character, so there is nothing to repeat',
          last.start,
          end,
        );
      } else {
        const height = last.height + (repeats(quantifier) ? 1 : 0);
        if (height > 1) {
          refuse(
            'a nested quantifier',
            'a quantifier over something already quantified can try exponentially many ' +
              "ways to match; write the inner part once, as '(ab)+' instead of '(a+b)+'",
            last.start,
            end,
          );
        }
        current().height = Math.max(current().height, height);
      }
      last = undefined;
      continue;
    }

    rewritten += char;
    index += 1;
    last = { start, height: 0, assertion: char === '^' || char === '$' };
  }

  return { rewritten, refusals };
}

function repeats(quantifier: RegExpExecArray): boolean {
  const written = quantifier[0];
  if (written === '*' || written === '+') return true;
  if (written === '?') return false;
  const minimum = Number(quantifier[1]);
  if (quantifier[2] === undefined) return false; // `{n}`: exactly n, one way only
  if (quantifier[3] === '') return true; // `{n,}`
  return Number(quantifier[3]) > Math.max(minimum, 1);
}

type RefusalArguments = [construct: string, problem: string, start: number, end: number];

interface Escape {
  readonly rewritten: string;
  readonly end: number;
  readonly assertion: boolean;
  readonly refusal?: RefusalArguments;
}

const BACKREFERENCE_PROBLEM =
  'a backreference makes matching depend on what was matched before, which no bound on the ' +
  'pattern can keep fast';

/**
 * One escape starting at `index`. Inside a class `\b` is a backspace, as in both languages, and
 * `\W` cannot be written there without the `v` flag, so it is refused rather than left ASCII.
 */
function readEscape(pattern: string, index: number, inClass: boolean): Escape {
  const next = pattern[index + 1] ?? '';
  const end = index + 2;
  const braced = /^[pPu]\{[^}]*\}/u.exec(pattern.slice(index + 1));
  if (braced !== null) {
    return { rewritten: `\\${braced[0]}`, end: index + 1 + braced[0].length, assertion: false };
  }
  if (/^[1-9]$/u.test(next)) {
    const digits = /^[1-9]\d*/u.exec(pattern.slice(index + 1))?.[0] ?? next;
    const stop = index + 1 + digits.length;
    return {
      rewritten: pattern.slice(index, stop),
      end: stop,
      assertion: false,
      refusal: ['a backreference', BACKREFERENCE_PROBLEM, index, stop],
    };
  }
  if (next === 'k' && !inClass) {
    const named = /^k<[^>]*>/u.exec(pattern.slice(index + 1));
    const stop = named === null ? end : index + 1 + named[0].length;
    return {
      rewritten: pattern.slice(index, stop),
      end: stop,
      assertion: false,
      refusal: ['a backreference', BACKREFERENCE_PROBLEM, index, stop],
    };
  }
  if (next === 'w')
    return { rewritten: inClass ? String.raw`\p{L}\p{N}_` : WORD, end, assertion: false };
  if (next === 'd') return { rewritten: String.raw`\p{Nd}`, end, assertion: false };
  if (next === 'D') return { rewritten: String.raw`\P{Nd}`, end, assertion: false };
  if (next === 'W') {
    if (!inClass) return { rewritten: NOT_WORD, end, assertion: false };
    return {
      rewritten: '\\W',
      end,
      assertion: false,
      refusal: [
        "'\\W' inside a class",
        "a class cannot hold Unicode's non-word characters; write a negated class, as " +
          "'[^\\w-]' for neither a word character nor a hyphen",
        index,
        end,
      ],
    };
  }
  if (next === 'b' && !inClass) return { rewritten: WORD_BOUNDARY, end, assertion: true };
  if (next === 'B' && !inClass) return { rewritten: NOT_WORD_BOUNDARY, end, assertion: true };
  return { rewritten: pattern.slice(index, end), end, assertion: false };
}

interface ClassRead {
  readonly rewritten: string;
  readonly end: number;
  readonly refusals: readonly RefusalArguments[];
}

/** A class runs to its first unescaped `]`: under the `u` flag classes do not nest. */
function readClass(pattern: string, index: number): ClassRead {
  const refusals: RefusalArguments[] = [];
  let rewritten = '[';
  let position = index + 1;
  while (position < pattern.length) {
    const char = pattern[position] ?? '';
    if (char === ']') return { rewritten: `${rewritten}]`, end: position + 1, refusals };
    if (char === '\\') {
      const escape = readEscape(pattern, position, true);
      if (escape.refusal !== undefined) refusals.push(escape.refusal);
      rewritten += escape.rewritten;
      position = escape.end;
      continue;
    }
    rewritten += char;
    position += 1;
  }
  // Unterminated: `RegExp` refuses it with its own words.
  return { rewritten, end: position, refusals };
}
