/**
 * A command line typed in the command panel, as the words `cli:run` takes (TYTO-496, ADR 0159).
 *
 * `cli:run` takes an array of words and never a command line, so that nothing reads `|`, `>`,
 * `&&`, `$VAR` or a glob (decision 8). Something still has to turn what a person typed into
 * words, and this is all of it: spaces separate words, and a pair of quotes keeps a word with
 * spaces in it whole, which a path under `Meus documentos` needs.
 *
 * **A backslash is a character, never an escape.** A Windows path is full of them, and a
 * splitter that ate them would turn `C:\briefs\a.brief` into `C:briefsa.brief`. A quote inside a
 * word is written inside the other kind of quotes: `'say "hi"'`.
 *
 * A leading `tyto` is dropped, so a line copied from the manual or a terminal runs as typed.
 */

export type SplitLine =
  | { readonly ok: true; readonly words: readonly string[] }
  /** A quote opened at `at` (an offset into the line) and never closed: nothing is run. */
  | { readonly ok: false; readonly problem: 'unclosed-quote'; readonly at: number };

const PROGRAM = 'tyto';

export function splitCommandLine(line: string): SplitLine {
  const words: string[] = [];
  let word = '';
  // A word exists once a character or a pair of quotes started it: `""` is an empty argument.
  let started = false;
  let quote: '"' | "'" | undefined;
  let quoteAt = 0;

  for (let at = 0; at < line.length; at += 1) {
    const character = line[at] ?? '';
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else word += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      quoteAt = at;
      started = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (started) words.push(word);
      word = '';
      started = false;
      continue;
    }
    word += character;
    started = true;
  }

  if (quote !== undefined) return { ok: false, problem: 'unclosed-quote', at: quoteAt };
  if (started) words.push(word);
  return { ok: true, words: words[0] === PROGRAM ? words.slice(1) : words };
}

/**
 * The line that splits back into `words`: a word with a space, a quote or nothing in it is
 * quoted, with the kind of quote it does not contain. What a quick action writes on the input
 * line, and what a tab's title shows.
 */
export function joinCommandLine(words: readonly string[]): string {
  return words
    .map((word) => {
      if (word !== '' && !/[\s"']/u.test(word)) return word;
      return word.includes('"') ? `'${word}'` : `"${word}"`;
    })
    .join(' ');
}
