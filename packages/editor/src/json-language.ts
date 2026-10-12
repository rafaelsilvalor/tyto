import { LanguageSupport, StreamLanguage, type StringStream } from '@codemirror/language';

/**
 * JSON with comments, coloured — the language of the desktop's `settings.json` and
 * `keybindings.json` tabs (TYTO-256, ADR 0073).
 *
 * A stream tokenizer and not `@codemirror/lang-json`: that is a new dependency and a Lezer
 * grammar for a file whose meaning is decided elsewhere — `jsonc-parser` reads it in main, and
 * the keybindings resolver in the window — and it refuses the comments these two files carry.
 * Colour is all this adds, so it only has to tell five things apart, with the tags the brief and
 * template languages already colour: a key (`propertyName`), a string value, a number, `true` /
 * `false` / `null` (`atom`), and a comment. No folding and no error marking: a syntax error is
 * the reader's to report, as a diagnostic with a range.
 */

interface JsonState {
  /** Inside a `/* … *\/` comment that has not closed on an earlier line. */
  comment: boolean;
}

/** A string runs to its closing quote; a backslash escapes the next character. */
function skipString(stream: StringStream): void {
  let escaped = false;
  // `next()` answers nothing at the end of the line: an unclosed string ends there.
  for (let next = stream.next(); typeof next === 'string'; next = stream.next()) {
    if (next === '"' && !escaped) return;
    escaped = !escaped && next === '\\';
  }
}

function token(stream: StringStream, state: JsonState): string | null {
  if (state.comment) {
    if (stream.skipTo('*/')) {
      stream.match('*/');
      state.comment = false;
    } else {
      stream.skipToEnd();
    }
    return 'blockComment';
  }
  if (stream.eatSpace()) return null;
  if (stream.match('//')) {
    stream.skipToEnd();
    return 'lineComment';
  }
  if (stream.match('/*')) {
    state.comment = true;
    return token(stream, state) ?? 'blockComment';
  }
  if (stream.eat('"')) {
    skipString(stream);
    // A string followed by a colon is a key, whatever is between them on that line.
    return stream.match(/^\s*:/u, false) ? 'propertyName' : 'string';
  }
  if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u)) return 'number';
  if (stream.match(/^(?:true|false|null)\b/u)) return 'atom';
  const next = stream.next();
  if (next === '{' || next === '}') return 'brace';
  if (next === '[' || next === ']') return 'squareBracket';
  if (next === ',' || next === ':') return 'separator';
  return null;
}

export const jsonLanguage = StreamLanguage.define<JsonState>({
  name: 'json',
  startState: () => ({ comment: false }),
  token,
  copyState: (state) => ({ comment: state.comment }),
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
});

export const json = (): LanguageSupport => new LanguageSupport(jsonLanguage);
