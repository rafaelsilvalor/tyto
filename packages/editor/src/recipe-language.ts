import { LanguageSupport, StreamLanguage, type StringStream } from '@codemirror/language';

/**
 * A `.recipe` file, coloured (TYTO-377, ADR 0128).
 *
 * A stream tokenizer and not a Lezer grammar, for the reason `@tyto/recipe` gives for its own
 * reader: a recipe is a line format and not a grammar on purpose, one line one cell. Meaning
 * stays with `parseRecipe`, which the host runs and whose diagnostics it pushes in; this only
 * tells the constructs apart, with tags the theme already colours:
 *
 * - `#` at the start of a line is a comment (`lineComment`); a `#` inside a data reference is not.
 * - `recipe` and `param` are `definitionKeyword`; the recipe's name is a `labelName`, and a
 *   parameter's name a `propertyName`.
 * - A `|` line under the header is the recipe's description, coloured as `meta`.
 * - The first word of any other line is the verb — `where`, or a plugin's namespaced
 *   `jira.pull` — coloured as a function name, the dot included: one verb, one name.
 * - `name=` is an `attributeName` and its `=` a `separator`; an unquoted value after it is an
 *   `attributeValue`, a quoted one a `string`.
 * - `{param}` is a placeholder (`special(variableName)`), inside a quoted value too.
 * - `@./file.json#/pointer` is a data reference, coloured as a `url`.
 *
 * No error marking: an unclosed quote ends at the end of its line, as it does for the parser,
 * and the parser is the one that says so.
 */

type LineKind = 'fresh' | 'header' | 'param' | 'step';

interface RecipeState {
  /** What the current line turned out to be, decided by its first word. */
  line: LineKind;
  /** Inside a quoted value that has not closed yet. */
  quoted: boolean;
  /** Right after a `name=`: the next value is that argument's. */
  afterEquals: boolean;
  /** On a `param` line, past the parameter's name. */
  paramNamed: boolean;
  /** Right after an argument's name, before its `=`. */
  named: boolean;
}

const VERB = /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*/u;
const IDENTIFIER = /^[A-Za-z_][\w-]*/u;
const PLACEHOLDER = /^\{[A-Za-z_][\w-]*\}/u;
const NAMED = /^[A-Za-z_][\w-]*(?==)/u;

/** Reads to the closing quote, stopping short of a placeholder so it gets its own colour. */
function readQuoted(stream: StringStream, state: RecipeState): void {
  while (!stream.eol()) {
    if (stream.match(PLACEHOLDER, false)) return;
    if (stream.next() === '"') {
      state.quoted = false;
      return;
    }
  }
  // The end of the line ends an unclosed quote: the parser reports it, line by line.
  state.quoted = false;
}

/** Reads a bare word up to whitespace, stopping short of a placeholder. */
function readWord(stream: StringStream): void {
  while (!stream.eol()) {
    const next = stream.peek() ?? '';
    if (/\s/u.test(next) || stream.match(PLACEHOLDER, false)) return;
    stream.next();
  }
}

function lineStart(stream: StringStream, state: RecipeState): string | null {
  if (stream.match('#')) {
    stream.skipToEnd();
    return 'lineComment';
  }
  if (stream.match('|')) {
    stream.skipToEnd();
    return 'meta';
  }
  if (stream.match(/^recipe(?=\s|$)/u)) {
    state.line = 'header';
    return 'definitionKeyword';
  }
  if (stream.match(/^param(?=\s|$)/u)) {
    state.line = 'param';
    return 'definitionKeyword';
  }
  state.line = 'step';
  if (stream.match(VERB)) return 'variableName.function';
  readWord(stream);
  return null;
}

function headerRest(stream: StringStream): string | null {
  stream.skipToEnd();
  return 'labelName';
}

function paramRest(stream: StringStream, state: RecipeState): string | null {
  if (!state.paramNamed && stream.match(IDENTIFIER)) {
    state.paramNamed = true;
    return 'propertyName';
  }
  if (stream.eat('=')) return 'separator';
  if (stream.eat('"')) {
    state.quoted = true;
    readQuoted(stream, state);
    return 'string';
  }
  readWord(stream);
  return 'attributeValue';
}

function stepRest(stream: StringStream, state: RecipeState): string | null {
  if (stream.match(PLACEHOLDER)) return 'variableName.special';
  if (state.quoted) {
    readQuoted(stream, state);
    return 'string';
  }
  const value = state.afterEquals;
  state.afterEquals = false;
  if (stream.eat('"')) {
    state.quoted = true;
    readQuoted(stream, state);
    return 'string';
  }
  if (stream.match(/^@\S+/u)) return 'url';
  if (state.named) {
    state.named = false;
    stream.next();
    state.afterEquals = true;
    return 'separator';
  }
  if (!value && stream.match(NAMED)) {
    state.named = true;
    return 'attributeName';
  }
  readWord(stream);
  return value ? 'attributeValue' : null;
}

function token(stream: StringStream, state: RecipeState): string | null {
  if (stream.sol()) {
    state.line = 'fresh';
    state.quoted = false;
    state.afterEquals = false;
    state.paramNamed = false;
    state.named = false;
  }
  if (!state.quoted && stream.eatSpace()) {
    state.afterEquals = false;
    return null;
  }
  switch (state.line) {
    case 'fresh':
      return lineStart(stream, state);
    case 'header':
      return headerRest(stream);
    case 'param':
      return paramRest(stream, state);
    case 'step':
      return stepRest(stream, state);
  }
}

export const recipeLanguage = StreamLanguage.define<RecipeState>({
  name: 'recipe',
  startState: () => ({
    line: 'fresh',
    quoted: false,
    afterEquals: false,
    paramNamed: false,
    named: false,
  }),
  token,
  copyState: (state) => ({ ...state }),
  languageData: { commentTokens: { line: '#' } },
});

export const recipe = (): LanguageSupport => new LanguageSupport(recipeLanguage);
