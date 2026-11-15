import type { PanelAlias } from '../../shared/command-aliases.js';
import { type LineStep, type LineWord, parseCommandLine } from './command-steps.js';

/**
 * Aliases and variables in the command panel (TYTO-536, ADR 0200 note of 2026-11-15), read at
 * the seam ADR 0200 left for them: after `!N`, before the built-in registry, without touching
 * the line's parser.
 *
 * **An alias expands once.** A step's unquoted first word that names an alias becomes the
 * alias's line, read by the same parser, with the step's other words after it. The words it
 * brings are taken literally: never looked up as an alias again, and no `$` in them is read, so
 * an alias means the same whatever the session has set. What it expands to still goes through
 * the registry and `cli:run`, so every refusal and offer sees the expanded words.
 *
 * **A variable is a word's part, never a line's.** `$name` is replaced inside a word after the
 * line was read, so a value never adds a word, an `&&` or a quote; a `$` typed in single quotes
 * stays as it is; and only what `set` gave this session is read, never the environment.
 */

/** What a variable may be called, as a shell names one. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const VARIABLE_AT = /^[A-Za-z_][A-Za-z0-9_]*/u;

/** What a line's aliases became, or why one cannot be read. */
export type AliasExpansion =
  | { readonly ok: true; readonly steps: readonly LineStep[] }
  | { readonly ok: false; readonly alias: string; readonly at: number };

/** Whether a name may be an alias: never one the panel or `tyto` already answers to. */
export type ReservedName = (name: string) => boolean;

/** The steps with each alias a step starts with replaced by its line, once. */
export function expandAliases(
  steps: readonly LineStep[],
  aliases: readonly PanelAlias[],
  reserved: ReservedName,
): AliasExpansion {
  const byName = new Map(aliases.map((alias) => [alias.name, alias]));
  const out: LineStep[] = [];
  for (const step of steps) {
    const first = step.words[0];
    const alias =
      first === undefined || first.quoted || reserved(first.text)
        ? undefined
        : byName.get(first.text);
    if (alias === undefined) {
      out.push(step);
      continue;
    }
    const parsed = parseCommandLine(alias.body);
    if (!parsed.ok) return { ok: false, alias: alias.name, at: parsed.at };
    const origin = { alias: alias.name, definedIn: alias.definedIn };
    const rest = step.words.slice(1);
    // The typed words after the name, as typed: the step's source past the alias's name.
    const restSource = step.source.slice(first?.text.length ?? 0).trim();
    parsed.steps.forEach((bodyStep, index) => {
      const last = index === parsed.steps.length - 1;
      const literal = bodyStep.words.map(literalWord);
      out.push({
        words: last ? [...literal, ...rest] : literal,
        source: last && restSource !== '' ? `${bodyStep.source} ${restSource}` : bodyStep.source,
        origin,
      });
    });
  }
  return { ok: true, steps: out };
}

/** A word of an alias body: its `$` are characters, not variables. */
function literalWord(word: LineWord): LineWord {
  return { text: word.text, quoted: word.quoted };
}

/** A step's words with its variables read, or the first name no `set` gave this session. */
export type VariableExpansion =
  | { readonly ok: true; readonly words: readonly LineWord[] }
  | { readonly ok: false; readonly name: string };

export function expandVariables(
  words: readonly LineWord[],
  variables: ReadonlyMap<string, string>,
): VariableExpansion {
  const out: LineWord[] = [];
  for (const word of words) {
    const dollars = word.dollars ?? [];
    if (dollars.length === 0) {
      out.push(word);
      continue;
    }
    let text = '';
    let from = 0;
    let replaced = false;
    for (const at of dollars) {
      const name = VARIABLE_AT.exec(word.text.slice(at + 1))?.[0];
      // A `$` with no name after it (`$`, `$5`, `a$`) is a character, as in a shell.
      if (name === undefined) continue;
      const value = variables.get(name);
      if (value === undefined) return { ok: false, name };
      text += word.text.slice(from, at) + value;
      from = at + 1 + name.length;
      replaced = true;
    }
    text += word.text.slice(from);
    // A word a variable made counts as quoted: its value is never a glob nor a command's name.
    out.push(replaced ? { text, quoted: true } : { text: word.text, quoted: word.quoted });
  }
  return { ok: true, words: out };
}
