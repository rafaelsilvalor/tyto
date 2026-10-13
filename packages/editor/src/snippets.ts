import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
  currentCompletions,
  moveCompletionSelection,
  snippet,
  snippetCompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import { briefAnalysisField } from './analysis.js';
import { briefLanguage } from './brief-language.js';
import type { SlashSource } from './slash.js';
import { treeAt } from './syntax.js';

/**
 * The person's snippets in the brief editor (TYTO-277, ADR 0082).
 *
 * A snippet is written in VS Code's body syntax, so one copied out of a VS Code snippets file
 * works here, and inserted with CodeMirror's `snippet()`, which has a syntax of its own. The
 * translation between the two is {@link snippetTemplate}; everything it cannot say faithfully is
 * refused by name rather than inserted wrong.
 *
 * The editor reads no file. A host parses `snippets.json` and hands the result over through a
 * getter, asked every time the list opens, so a saved file applies with nothing reconfigured.
 */

/** One snippet as the editor uses it: the body already in CodeMirror's syntax. */
export interface BriefSnippet {
  /** The key the person gave it in the file. */
  readonly name: string;
  /** What typing at the start of a line offers it on; never empty. */
  readonly prefixes: readonly string[];
  /** The body as a CodeMirror `snippet()` template. */
  readonly template: string;
  readonly description?: string;
  /** Offered only while the brief in front names this template. */
  readonly forTemplate?: string;
}

/** Why a body was refused, or what was lost translating it. */
export type SnippetBodyProblem =
  | { readonly kind: 'unsupported'; readonly what: string }
  | { readonly kind: 'choice-flattened'; readonly field: number; readonly first: string };

export interface SnippetTranslation {
  /** Absent when the body was refused; an `unsupported` problem then says why. */
  readonly template?: string;
  readonly problems: readonly SnippetBodyProblem[];
}

const VARIABLE = /^[_a-zA-Z][_a-zA-Z0-9]*/u;

/** A literal character, escaped for CodeMirror wherever it could open or close a field. */
const literal = (character: string): string =>
  character === '{' || character === '}' ? `\\${character}` : character;

/**
 * A VS Code snippet body as a CodeMirror `snippet()` template.
 *
 * `$1` and `${1}` become `${1}`, `${1:default}` stays, `$0` is CodeMirror's `${0}` (where the
 * cursor ends), and `\$`, `\}` and `\\` are the characters they escape. **Every literal brace
 * is escaped**, because a brief's adjustment is `{destaque}` and CodeMirror would read
 * `#{destaque}` or `${destaque}` as a field. A choice `${1|a,b|}` becomes `${1:a}` and says so.
 * Refused, with what was met: variables (`$TM_FILENAME`, `${CURRENT_YEAR}`), transforms
 * (`${1/(.*)/$1/}`), a field inside a default, and a brace or a line break inside a default,
 * none of which CodeMirror's syntax can hold.
 */
export function snippetTemplate(body: string): SnippetTranslation {
  const problems: SnippetBodyProblem[] = [];
  let out = '';
  let index = 0;
  const refuse = (what: string): SnippetTranslation => ({
    problems: [...problems, { kind: 'unsupported', what }],
  });

  while (index < body.length) {
    const character = body[index] ?? '';
    if (character === '\\') {
      const next = body[index + 1];
      if (next === '$' || next === '}' || next === '\\') {
        out += literal(next);
        index += 2;
        continue;
      }
      out += '\\';
      index += 1;
      continue;
    }
    if (character !== '$') {
      out += literal(character);
      index += 1;
      continue;
    }

    const rest = body.slice(index + 1);
    const bare = /^\d+/u.exec(rest);
    if (bare !== null) {
      out += `\${${bare[0]}}`;
      index += 1 + bare[0].length;
      continue;
    }
    const variable = VARIABLE.exec(rest);
    if (variable !== null) return refuse(`the variable $${variable[0]}`);
    if (!rest.startsWith('{')) {
      out += '$';
      index += 1;
      continue;
    }

    const inner = rest.slice(1);
    const named = VARIABLE.exec(inner);
    if (named !== null) return refuse(`the variable \${${named[0]}}`);
    const number = /^\d+/u.exec(inner);
    if (number === null) {
      // `${` followed by neither a number nor a name is a literal in VS Code too.
      out += '$\\{';
      index += 2;
      continue;
    }
    const field = number[0];
    const after = inner.slice(field.length);
    const consumed = 2 + field.length;

    if (after.startsWith('}')) {
      out += `\${${field}}`;
      index += consumed + 1;
      continue;
    }
    if (after.startsWith('/')) return refuse(`a transform in field ${field}`);
    if (after.startsWith('|')) {
      const close = after.indexOf('|}');
      if (close < 0) return refuse(`an unclosed choice in field ${field}`);
      const options = after.slice(1, close).split(',');
      const first = options[0] ?? '';
      if (/[{}$\n\\]/u.test(first)) return refuse(`an option Tyto cannot insert in field ${field}`);
      if (options.length > 1)
        problems.push({ kind: 'choice-flattened', field: Number(field), first });
      out += `\${${field}:${first}}`;
      index += consumed + close + 2;
      continue;
    }
    if (after.startsWith(':')) {
      const close = after.indexOf('}');
      if (close < 0) return refuse(`an unclosed field ${field}`);
      const placeholder = after.slice(1, close);
      if (placeholder.includes('$')) return refuse(`a field inside field ${field}`);
      if (placeholder.includes('{') || placeholder.includes('\\')) {
        return refuse(`a brace inside field ${field}`);
      }
      if (placeholder.includes('\n')) return refuse(`a line break inside field ${field}`);
      out += `\${${field}:${placeholder}}`;
      index += consumed + close + 1;
      continue;
    }
    return refuse(`an unclosed field ${field}`);
  }

  return { template: out, problems };
}

/** The snippets on offer in this state: every one, less those limited to another template. */
export function snippetsFor(
  state: EditorState,
  snippets: readonly BriefSnippet[],
): readonly BriefSnippet[] {
  const active = state.field(briefAnalysisField, false)?.manifest?.name;
  return snippets.filter(
    (entry) => entry.forTemplate === undefined || entry.forTemplate === active,
  );
}

/** What a prefix can be: letters in any script, digits, `_` and `-`. */
const WORD_BEFORE = /[\p{L}\p{N}_-]*$/u;
const WORD = /^[\p{L}\p{N}_-]*$/u;

/**
 * The completion source, exported so a test can drive it without the language's facet.
 *
 * **Only a word that starts its line, outside the frontmatter.** A snippet writes lines, and an
 * indented line or the middle of one is prose, where a list on every word that happens to start
 * like a prefix would make Enter insert a block nobody asked for. The frontmatter is YAML. A word
 * after a "/" is the "/" menu's query, which lists the same snippets under its own heading.
 */
export function completeSnippets(
  get: () => readonly BriefSnippet[],
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const word = context.matchBefore(WORD_BEFORE);
    if (word === null) return null;
    if (word.from === word.to && !context.explicit) return null;
    const line = context.state.doc.lineAt(context.pos);
    if (word.from !== line.from) return null;
    if (context.state.sliceDoc(context.pos, line.to).trim() !== '') return null;
    if (treeAt(context.state, context.pos).resolveInner(context.pos, -1).name === 'Frontmatter') {
      return null;
    }
    const options = snippetsFor(context.state, get()).flatMap((entry) =>
      entry.prefixes.map((prefix): Completion =>
        snippetCompletion(entry.template, {
          label: prefix,
          detail: entry.description ?? entry.name,
          type: 'text',
        }),
      ),
    );
    if (options.length === 0) return null;
    return { from: word.from, options, validFor: WORD };
  };
}

/** The person's snippets in the brief's completion, scoped to the brief language. */
export function briefSnippets(get: () => readonly BriefSnippet[]): Extension {
  return [autocompletion(), briefLanguage.data.of({ autocomplete: completeSnippets(get) })];
}

/**
 * The same snippets as a section of the "/" menu. A row inserts the snippet in place of the "/"
 * and its query, fields and all.
 */
export function snippetsSlashSource(
  section: () => string,
  get: () => readonly BriefSnippet[],
): SlashSource {
  return {
    get section() {
      return section();
    },
    items: (state) =>
      snippetsFor(state, get()).map((entry) => ({
        label: entry.prefixes[0] ?? entry.name,
        detail: entry.description ?? entry.name,
        apply: (view, from, to) => {
          snippet(entry.template)(view, null, from, to);
        },
      })),
  };
}

/**
 * Tab and Shift+Tab step through an open completion list; Enter still accepts (TYTO-277).
 *
 * With no list open both keys fall through, to a snippet's next field or to indenting. Above
 * vim's keymap and the snippet's, which is what `Prec.highest` and being registered first buy:
 * a list open while a field is being typed takes Tab, as it does in VS Code. Inside CodeMirror's
 * 75 ms before a new list accepts input the key is still the list's, so it never indents a line
 * the person meant to pick a row on.
 */
export function tabThroughCompletions(): Extension {
  const step =
    (forward: boolean) =>
    (view: Parameters<ReturnType<typeof moveCompletionSelection>>[0]): boolean => {
      if (currentCompletions(view.state).length === 0) return false;
      moveCompletionSelection(forward)(view);
      return true;
    };
  return Prec.highest(
    keymap.of([
      { key: 'Tab', run: step(true) },
      { key: 'Shift-Tab', run: step(false) },
    ]),
  );
}
