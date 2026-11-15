/**
 * A command panel line as the steps it runs (TYTO-535, ADR 0200): `&&` between steps, `!N` for an
 * entry of the history, and each word knowing whether it was quoted, which a glob needs.
 *
 * **The panel reads this, never a shell.** `cli:run` still takes words (ADR 0159 decision 8);
 * the panel splits a line into steps, runs each in turn and stops at the first that does not
 * succeed. Words follow `splitCommandLine`'s rules (`command-words.ts`): spaces separate them,
 * a pair of quotes keeps one whole, and a backslash is a character, never an escape.
 *
 * What a step's first word names is not decided here: the panel hands it to the built-in
 * registry (`command-builtins.ts`), and only what no entry claims goes to `tyto`.
 */

export interface LineWord {
  readonly text: string;
  /** Some of it was inside quotes: such a word is never a glob nor a built-in's name. */
  readonly quoted: boolean;
  /**
   * Where in `text` a `$` was typed outside single quotes (TYTO-536): the only places a session
   * variable may be read. Absent where there is none, and on every word of an alias body, which
   * is taken literally.
   */
  readonly dollars?: readonly number[];
}

export interface LineStep {
  readonly words: readonly LineWord[];
  /** The step as typed, trimmed: what its block's header says and what the history keeps. */
  readonly source: string;
  /** The alias this step was expanded from (TYTO-536), which a refusal of it names. */
  readonly origin?: { readonly alias: string; readonly definedIn: 'user' | 'workspace' };
}

export type ParsedLine =
  | { readonly ok: true; readonly steps: readonly LineStep[] }
  /** A quote opened at `at` (an offset into the line) and never closed. */
  | { readonly ok: false; readonly problem: 'unclosed-quote'; readonly at: number }
  /** An `&&` with nothing before or after it, at `at`. */
  | { readonly ok: false; readonly problem: 'empty-step'; readonly at: number };

const AND = '&&';

export function parseCommandLine(line: string): ParsedLine {
  const steps: LineStep[] = [];
  let words: LineWord[] = [];
  let word = '';
  let quoted = false;
  // A word exists once a character or a pair of quotes started it: `""` is an empty argument.
  let started = false;
  let dollars: number[] = [];
  let quote: '"' | "'" | undefined;
  let quoteAt = 0;
  let stepStart = 0;

  const endWord = (): void => {
    if (started) {
      words.push(dollars.length === 0 ? { text: word, quoted } : { text: word, quoted, dollars });
    }
    word = '';
    quoted = false;
    started = false;
    dollars = [];
  };

  for (let at = 0; at < line.length; at += 1) {
    const character = line[at] ?? '';
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else {
        // Single quotes keep a `$` as it is, as a shell's do; double quotes let it be read.
        if (character === '$' && quote === '"') dollars.push(word.length);
        word += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      quoteAt = at;
      quoted = true;
      started = true;
      continue;
    }
    if (line.startsWith(AND, at)) {
      endWord();
      if (words.length === 0) return { ok: false, problem: 'empty-step', at };
      steps.push({ words, source: line.slice(stepStart, at).trim() });
      words = [];
      at += AND.length - 1;
      stepStart = at + 1;
      continue;
    }
    if (/\s/u.test(character)) {
      endWord();
      continue;
    }
    if (character === '$') dollars.push(word.length);
    word += character;
    started = true;
  }

  if (quote !== undefined) return { ok: false, problem: 'unclosed-quote', at: quoteAt };
  endWord();
  if (words.length === 0) {
    // An empty line is no step at all; a line ending in `&&` lacks its last one.
    if (steps.length === 0) return { ok: true, steps: [] };
    return { ok: false, problem: 'empty-step', at: line.lastIndexOf(AND) };
  }
  steps.push({ words, source: line.slice(stepStart).trim() });
  return { ok: true, steps };
}

/** The entry number a step that is only `!N` names, counted from 1 as `history` prints them. */
export function historyReference(step: LineStep): number | undefined {
  const only = step.words.length === 1 ? step.words[0] : undefined;
  if (only === undefined || only.quoted) return undefined;
  const match = /^!(\d+)$/u.exec(only.text);
  return match === null ? undefined : Number(match[1]);
}

export type ExpandedLine =
  | { readonly ok: true; readonly steps: readonly LineStep[]; readonly line: string }
  | { readonly ok: false; readonly problem: 'no-entry'; readonly entry: number }
  | Extract<ParsedLine, { ok: false }>;

/**
 * The steps with each `!N` replaced by the steps of history entry N, and the line they make,
 * which is what the history keeps (as a shell keeps the expansion, not the `!`). Expanded once:
 * the history holds expanded lines, so an entry never holds a `!N` of its own to follow.
 */
export function expandHistory(
  steps: readonly LineStep[],
  history: readonly string[],
): ExpandedLine {
  const out: LineStep[] = [];
  for (const step of steps) {
    const entry = historyReference(step);
    if (entry === undefined) {
      out.push(step);
      continue;
    }
    const text = entry >= 1 ? history[entry - 1] : undefined;
    if (text === undefined) return { ok: false, problem: 'no-entry', entry };
    const parsed = parseCommandLine(text);
    if (!parsed.ok) return parsed;
    out.push(...parsed.steps);
  }
  return { ok: true, steps: out, line: out.map((step) => step.source).join(` ${AND} `) };
}
