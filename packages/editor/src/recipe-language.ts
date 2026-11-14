import { LanguageSupport, StreamLanguage, type StringStream } from '@codemirror/language';
import { chainSegments } from '@tyto/recipe';

/**
 * A `.recipe` file, coloured (TYTO-377, ADR 0128).
 *
 * A stream tokenizer and not a Lezer grammar, for the reason `@tyto/recipe` gives for its own
 * reader: a recipe is a line format and not a grammar on purpose, one line one cell. Meaning
 * stays with `parseRecipe`, which the host runs and whose diagnostics it pushes in; this only
 * tells the constructs apart, with tags the theme already colours:
 *
 * - `#` at the start of a line is a comment (`lineComment`); a `#` inside a data reference is not.
 * - `recipe`, `param`, `apply` and `every` are `definitionKeyword`; the recipe's name is a
 *   `labelName`, a parameter's name a `propertyName`, and the word after `apply` (`auto`,
 *   TYTO-378, ADR 0170) or `every` (`5m`, TYTO-385, ADR 0175) an `attributeValue`.
 * - A `|` line under the header is the recipe's description, coloured as `meta`.
 * - The first word of any other line is the verb — `where`, or a plugin's namespaced
 *   `jira.pull` — coloured as a function name, the dot included: one verb, one name.
 * - A step line may chain steps with a `|` that stands alone (TYTO-706); that `|` is a
 *   `separator` and the first word after it a verb again (TYTO-712). Which `|` stands alone is
 *   `@tyto/recipe`'s `chainSegments`, asked for the whole line when the tokenizer meets a `|`,
 *   so the colours and the parser split at the same places: never inside a quoted string or
 *   `{ }`, never on a header line, never in `pattern=a|b`.
 * - `name=` is an `attributeName` and its `=` a `separator`; an unquoted value after it is an
 *   `attributeValue`, a quoted one a `string`.
 * - `{param}` is a placeholder (`special(variableName)`), inside a quoted value too.
 * - `@./file.json#/pointer` is a data reference, coloured as a `url`.
 *
 * No error marking: an unclosed quote ends at the end of its line, as it does for the parser,
 * and the parser is the one that says so.
 */

/** `setting` is a header word followed by one value: `apply auto`, `every 5m`. */
type LineKind = 'fresh' | 'header' | 'param' | 'setting' | 'step';

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
  /** Right after a `|` that chains steps: the next word is a verb. */
  verbNext: boolean;
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

/**
 * A line that is no step, read by its first word with the indentation left out: a comment, a
 * description, or a header word. The completion asks it too, so the two cannot disagree.
 */
export const NOT_A_STEP = /^(?:#|\||(?:recipe|param|apply|every)(?=\s|$))/u;

/** Whether the `|` at the stream's position chains two steps, by the parser's own rule. */
function atChainBar(stream: StringStream): boolean {
  if (stream.peek() !== '|') return false;
  return chainSegments(stream.string).some((segment) => segment.bar === stream.pos);
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
  // Header words like `param`, reserved by the parser: no verb is named `apply` or `every`.
  if (stream.match(/^(?:apply|every)(?=\s|$)/u)) {
    state.line = 'setting';
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
  if (state.verbNext) {
    state.verbNext = false;
    if (stream.match(VERB)) return 'variableName.function';
  }
  if (stream.match(PLACEHOLDER)) return 'variableName.special';
  if (state.quoted) {
    readQuoted(stream, state);
    return 'string';
  }
  if (atChainBar(stream)) {
    stream.next();
    state.afterEquals = false;
    state.named = false;
    state.verbNext = true;
    return 'separator';
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
    state.verbNext = false;
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
    case 'setting':
      readWord(stream);
      return 'attributeValue';
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
    verbNext: false,
  }),
  token,
  copyState: (state) => ({ ...state }),
  languageData: { commentTokens: { line: '#' } },
});

export const recipe = (): LanguageSupport => new LanguageSupport(recipeLanguage);
