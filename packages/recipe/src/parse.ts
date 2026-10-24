import {
  type Diagnostic,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sourceRange,
} from '@tyto/core';

import type { Argument, NamedArgument, RecipeAst, RecipeParam, Step } from './ast.js';

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
 * A header names the recipe and `|` lines describe it; `param` lines declare what varies;
 * every other line is one verb and its arguments, and so one cell. `#` starts a comment line.
 * It is a line format and not a grammar on purpose: a one-step change is a one-line diff,
 * and the chain of verbs is what the person reads.
 */
export function parseRecipe(text: string): Result<RecipeAst, readonly Diagnostic[]> {
  const problems: Diagnostic[] = [];
  const params: RecipeParam[] = [];
  const steps: Step[] = [];
  const description: string[] = [];
  let name: string | undefined;

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
      if (steps.length > 0 || params.length > 0) {
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

    const textStart = start + verb.length;
    const rest = content.slice(verb.length);
    const leading = rest.length - rest.trimStart().length;
    const argumentsResult = tokenizeArguments(rest, textStart);
    if (!argumentsResult.ok) {
      problems.push(...argumentsResult.error);
      continue;
    }
    steps.push({
      verb,
      verbRange: sourceRange(start, textStart),
      positional: argumentsResult.value.positional,
      named: argumentsResult.value.named,
      text: rest.trim(),
      textRange: sourceRange(textStart + leading, start + content.length),
      range,
    });
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
  return ok({ name, description: description.join('\n'), params, steps });
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

/**
 * Words and quoted strings, and `name=value` pairs. A quote has no escape: a value that
 * needs a double quote is not something a recipe has met yet.
 */
function tokenizeArguments(rest: string, offset: number): Result<Arguments, readonly Diagnostic[]> {
  const positional: Argument[] = [];
  const named: NamedArgument[] = [];
  let index = 0;

  const readValue = (from: number): Result<{ value: string; end: number }, Diagnostic[]> => {
    if (rest[from] === '"') {
      const close = rest.indexOf('"', from + 1);
      if (close === -1) {
        return err([
          diagnostic(
            'E_RECIPE_SYNTAX',
            { problem: 'a quoted value is not closed' },
            { range: sourceRange(offset + from, offset + rest.length) },
          ),
        ]);
      }
      return ok({ value: rest.slice(from + 1, close), end: close + 1 });
    }
    let end = from;
    while (end < rest.length && !/\s/u.test(rest[end] ?? '')) end += 1;
    return ok({ value: rest.slice(from, end), end });
  };

  while (index < rest.length) {
    if (/\s/u.test(rest[index] ?? '')) {
      index += 1;
      continue;
    }
    const pair = NAME_BEFORE_EQUALS.exec(rest.slice(index));
    const valueStart = pair?.[1] !== undefined ? index + pair[0].length : index;
    const read = readValue(valueStart);
    if (!read.ok) return read;
    const range = sourceRange(offset + index, offset + read.value.end);
    if (pair?.[1] !== undefined) {
      named.push({ name: pair[1], value: read.value.value, range });
    } else {
      positional.push({ value: read.value.value, range });
    }
    index = read.value.end;
  }
  return ok({ positional, named });
}

const PLACEHOLDER = /\{([A-Za-z_][\w-]*)\}/gu;

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
