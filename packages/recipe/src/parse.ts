import {
  type Diagnostic,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sourceRange,
} from '@tyto/core';

import type {
  Argument,
  NamedArgument,
  RecipeAst,
  RecipeInterval,
  RecipeParam,
  Step,
} from './ast.js';
import { chainSegments } from './chain.js';

/**
 * The shortest interval `every` accepts. A scheduled run reads its sources again, so a
 * shorter cadence mostly spends the source's rate limit (ADR 0175).
 */
export const MINIMUM_INTERVAL_MINUTES = 5;

/**
 * Parses a `*.recipe` file (ADR 0128).
 *
 * ```
 * recipe open-tasks
 *   | The open tasks of one project, newest first.
 * param project = DEMO
 *
 * where project = {project} AND status != done
 * select key, title, status
 * show table
 * ```
 *
 * A header names the recipe and `|` lines describe it; `apply auto` in the header lets an
 * explicit Run in a trusted folder apply its plans without a click (ADR 0170); `every 30m`
 * or `every 2h` in the header asks the host to run it on that interval while the app is open
 * (ADR 0175); `param` lines declare what varies;
 * every other line is one verb and its arguments, and so one cell, or several steps chained
 * with a `|` that stands alone (TYTO-706, `chain.ts`), each read as if on its own line.
 * `#` starts a comment line.
 * It is a line format and not a grammar on purpose: a one-step change is a one-line diff,
 * and the chain of verbs is what the person reads.
 */
export function parseRecipe(text: string): Result<RecipeAst, readonly Diagnostic[]> {
  const problems: Diagnostic[] = [];
  const params: RecipeParam[] = [];
  const steps: Step[] = [];
  const description: string[] = [];
  let name: string | undefined;
  let apply: 'auto' | undefined;
  let every: RecipeInterval | undefined;

  for (const line of linesOf(text)) {
    const content = line.text.trim();
    if (content === '' || content.startsWith('#')) continue;
    const start = line.start + line.text.indexOf(content);
    const range = sourceRange(start, start + content.length);
    const syntax = (problem: string, at: SourceRange = range): void => {
      problems.push(diagnostic('E_RECIPE_SYNTAX', { problem }, { range: at }));
    };

    if (name === undefined) {
      const header = /^recipe\s+(\S+)$/u.exec(content);
      if (header?.[1] === undefined) {
        syntax("a recipe starts with a 'recipe <name>' line");
        return err(problems);
      }
      name = header[1];
      continue;
    }

    if (content.startsWith('|')) {
      if (steps.length > 0 || params.length > 0 || apply !== undefined || every !== undefined) {
        syntax("a '|' description line belongs right under the 'recipe' line");
      } else {
        description.push(content.slice(1).trim());
      }
      continue;
    }

    const verb = /^\S+/u.exec(content)?.[0] ?? '';
    if (verb === 'recipe') {
      syntax("a file holds one recipe, so 'recipe' appears once, on its first line");
      continue;
    }
    if (verb === 'apply') {
      if (!/^apply\s+auto$/u.test(content)) {
        syntax("the header line 'apply' takes one word, auto, as in 'apply auto'");
      } else if (steps.length > 0) {
        syntax("'apply auto' belongs in the header, before the first step");
      } else if (apply !== undefined) {
        syntax("'apply auto' is written once");
      } else {
        apply = 'auto';
      }
      continue;
    }
    if (verb === 'every') {
      const interval = parseInterval(content);
      if (typeof interval === 'string') {
        syntax(interval);
      } else if (steps.length > 0) {
        syntax("'every' belongs in the header, before the first step");
      } else if (every !== undefined) {
        syntax("'every' is written once");
      } else {
        every = interval;
      }
      continue;
    }
    if (verb === 'param') {
      const param = parseParam(content.slice(verb.length), range);
      if (!param.ok) {
        problems.push(...param.error);
      } else if (params.some((known) => known.name === param.value.name)) {
        syntax(`parameter '${param.value.name}' is declared twice`);
      } else {
        params.push(param.value);
      }
      continue;
    }

    // TYTO-706: a `|` standing alone splits the line into steps, each read as if on its own line.
    for (const segment of chainSegments(content)) {
      const at = start + segment.from;
      const written = content.slice(segment.from, segment.to);
      const word = /^\S+/u.exec(written)?.[0] ?? '';
      if (segment.bar !== undefined && written === '') {
        const bar = start + segment.bar;
        syntax("a '|' joins two steps, and no step follows this one", sourceRange(bar, bar + 1));
        continue;
      }
      if (segment.bar !== undefined && (CHAIN_REFUSED.has(word) || word.startsWith('#'))) {
        const what = word.startsWith('#') ? "a '#' note" : `'${word}', a header line,`;
        syntax(
          `${what} is written on a line of its own, not after '|'`,
          sourceRange(at, at + word.length),
        );
        continue;
      }
      const step = readStep(written, word, at);
      if (!step.ok) {
        problems.push(...step.error);
        continue;
      }
      steps.push(step.value);
    }
  }

  if (name === undefined) {
    problems.push(
      diagnostic(
        'E_RECIPE_SYNTAX',
        { problem: "the file is empty; a recipe starts with a 'recipe <name>' line" },
        { range: sourceRange(0, 0) },
      ),
    );
  }
  problems.push(...undeclaredPlaceholders(steps, params));
  if (problems.length > 0 || name === undefined) return err(problems);
  return ok({
    name,
    description: description.join('\n'),
    params,
    ...(apply === undefined ? {} : { apply }),
    ...(every === undefined ? {} : { every }),
    steps,
  });
}

/** The first words that may not follow a `|`: they are header lines (TYTO-706). */
const CHAIN_REFUSED = new Set(['recipe', 'apply', 'every', 'param']);

/** One step, `written` its trimmed text starting at offset `start` in the recipe. */
function readStep(
  written: string,
  verb: string,
  start: number,
): Result<Step, readonly Diagnostic[]> {
  const textStart = start + verb.length;
  const rest = written.slice(verb.length);
  const leading = rest.length - rest.trimStart().length;
  const argumentsResult = tokenizeArguments(rest, textStart);
  if (!argumentsResult.ok) return argumentsResult;
  return ok({
    verb,
    verbRange: sourceRange(start, textStart),
    positional: argumentsResult.value.positional,
    named: argumentsResult.value.named,
    text: rest.trim(),
    textRange: sourceRange(textStart + leading, start + written.length),
    range: sourceRange(start, start + written.length),
  });
}

/** Reads `every <n>m` or `every <n>h`; a string is the problem to report. */
function parseInterval(content: string): RecipeInterval | string {
  const match = /^every\s+(\d+)(m|h)$/u.exec(content);
  if (match?.[1] === undefined) {
    return "the header line 'every' takes minutes or hours, as in 'every 30m' or 'every 2h'";
  }
  const minutes = Number(match[1]) * (match[2] === 'h' ? 60 : 1);
  if (minutes < MINIMUM_INTERVAL_MINUTES) {
    return `'every' runs at most every ${MINIMUM_INTERVAL_MINUTES} minutes; write 'every ${MINIMUM_INTERVAL_MINUTES}m' or more`;
  }
  return { minutes };
}

interface Line {
  readonly text: string;
  readonly start: number;
}

/** Lines with the offset each starts at. A `\r` before the break is not part of the line. */
function linesOf(text: string): readonly Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start });
    start += raw.length + 1;
  }
  return lines;
}

const IDENTIFIER = /^[A-Za-z_][\w-]*$/u;

function parseParam(
  rest: string,
  lineRange: SourceRange,
): Result<RecipeParam, readonly Diagnostic[]> {
  const match = /^\s+([^\s=]+)\s*(?:=\s*(.*))?$/u.exec(rest);
  const paramName = match?.[1];
  if (paramName === undefined || !IDENTIFIER.test(paramName)) {
    return err([
      diagnostic(
        'E_RECIPE_SYNTAX',
        { problem: "a parameter is declared as 'param <name>' or 'param <name> = <default>'" },
        { range: lineRange },
      ),
    ]);
  }
  const raw = match?.[2]?.trim();
  if (raw === undefined || raw === '') return ok({ name: paramName, range: lineRange });
  const quoted = /^"([^"]*)"$/u.exec(raw);
  return ok({ name: paramName, defaultValue: quoted?.[1] ?? raw, range: lineRange });
}

interface Arguments {
  readonly positional: readonly Argument[];
  readonly named: readonly NamedArgument[];
}

const NAME_BEFORE_EQUALS = /^([A-Za-z_][\w-]*)=/u;
/** `"Última Sync"=`: a quoted name before `=`, how `compose` names a column with blanks. */
const QUOTED_NAME_BEFORE_EQUALS = /^"([^"]*)"=/u;

interface Token {
  readonly value: string;
  readonly end: number;
  readonly quoted: boolean;
}

/**
 * Words and quoted strings, and `name=value` pairs. A quote has no escape: a value that
 * needs a double quote is not something a recipe has met yet.
 *
 * A word that is a list may hold quoted members, `key,"Última Sync"`: a quote that opens a
 * word or follows a comma runs to its closing quote, so the list stays one word and keeps its
 * quotes for `columnNames` to read. A word that is one quoted string loses its quotes and is
 * marked quoted.
 */
function tokenizeArguments(rest: string, offset: number): Result<Arguments, readonly Diagnostic[]> {
  const positional: Argument[] = [];
  const named: NamedArgument[] = [];
  let index = 0;

  const unclosed = (from: number): Result<never, Diagnostic[]> =>
    err([
      diagnostic(
        'E_RECIPE_SYNTAX',
        { problem: 'a quoted value is not closed' },
        { range: sourceRange(offset + from, offset + rest.length) },
      ),
    ]);

  const readValue = (from: number): Result<Token, Diagnostic[]> => {
    let end = from;
    if (rest[from] === '"') {
      const close = rest.indexOf('"', from + 1);
      if (close === -1) return unclosed(from);
      if (rest[close + 1] !== ',') {
        return ok({ value: rest.slice(from + 1, close), end: close + 1, quoted: true });
      }
      end = close + 1;
    }
    while (end < rest.length && !/\s/u.test(rest[end] ?? '')) {
      if (rest[end] === '"' && rest[end - 1] === ',') {
        const close = rest.indexOf('"', end + 1);
        if (close === -1) return unclosed(end);
        end = close + 1;
      } else {
        end += 1;
      }
    }
    return ok({ value: rest.slice(from, end), end, quoted: false });
  };

  while (index < rest.length) {
    if (/\s/u.test(rest[index] ?? '')) {
      index += 1;
      continue;
    }
    const tail = rest.slice(index);
    const pair = NAME_BEFORE_EQUALS.exec(tail) ?? QUOTED_NAME_BEFORE_EQUALS.exec(tail);
    const valueStart = pair?.[1] !== undefined ? index + pair[0].length : index;
    const read = readValue(valueStart);
    if (!read.ok) return read;
    const range = sourceRange(offset + index, offset + read.value.end);
    const quoted = read.value.quoted ? { quoted: true as const } : {};
    if (pair?.[1] !== undefined) {
      const nameQuoted = pair[0].startsWith('"') ? { nameQuoted: true as const } : {};
      named.push({ name: pair[1], value: read.value.value, range, ...quoted, ...nameQuoted });
    } else {
      positional.push({ value: read.value.value, range, ...quoted });
    }
    index = read.value.end;
  }
  return ok({ positional, named });
}

// A pattern's `\p{Lu}`, `\P{Nd}` and `\u{FF}` are the pattern's own braces (ADR 0136).
const PLACEHOLDER = /(?<!\\[pPu])\{([A-Za-z_][\w-]*)\}/gu;

/** `{name}` in a step that no `param` line declares. */
function undeclaredPlaceholders(
  steps: readonly Step[],
  params: readonly RecipeParam[],
): readonly Diagnostic[] {
  const declared = new Set(params.map((param) => param.name));
  const problems: Diagnostic[] = [];
  for (const step of steps) {
    for (const match of step.text.matchAll(PLACEHOLDER)) {
      const used = match[1] ?? '';
      if (declared.has(used)) continue;
      const start = step.textRange.start + match.index;
      problems.push(
        diagnostic(
          'E_RECIPE_PARAM',
          { param: used, problem: "is used here, and no 'param' line declares it" },
          { range: sourceRange(start, start + match[0].length) },
        ),
      );
    }
  }
  return problems;
}

/** Replaces every `{name}` with its value. Undeclared names were refused by the parser. */
export function fillPlaceholders(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, used: string) => values.get(used) ?? whole);
}
