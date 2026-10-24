import { type Result, type SourceRange, diagnostic, err, ok } from '@tyto/core';

import type { Argument } from './ast.js';
import type { VerbContext } from './registry.js';
import { type Problems, locate } from './support.js';

/**
 * What a contributed verb accepts, as data (ADR 0135): a closed schema small enough to cross
 * to a plugin's process and to be checked here, before the plugin is called, so a misspelt
 * argument is a diagnostic at its range and never a request the plugin has to make sense of.
 */
export type ArgumentType = 'text' | 'number' | 'date' | 'boolean';

export interface ArgumentSpec {
  readonly name: string;
  readonly type: ArgumentType;
  /** Written as a bare word, in declaration order; otherwise as `name=value`. */
  readonly positional?: boolean;
  readonly required?: boolean;
  /** The only values accepted, as written. */
  readonly values?: readonly string[];
}

/** A date stays the text it was (`2026-10-24`); a number and a boolean are converted. */
export type ArgumentValue = string | number | boolean;

export type ArgumentValues = Readonly<Record<string, ArgumentValue>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The step's arguments, checked against what the verb declared and converted to their types. */
export function readArguments(
  context: VerbContext,
  specs: readonly ArgumentSpec[],
): Result<ArgumentValues, Problems> {
  const at = locate(context);
  const positional = specs.filter((spec) => spec.positional === true);
  const named = specs.filter((spec) => spec.positional !== true);
  const written = new Map<string, Argument>();

  const extra = context.step.positional[positional.length];
  if (extra !== undefined) {
    const allowed =
      positional.length === 0 ? 'no bare word' : `${String(positional.length)} bare word(s)`;
    return refuse(context, `takes ${allowed}, and '${extra.value}' is one more`, at(extra.range));
  }
  for (const [index, argument] of context.step.positional.entries()) {
    const spec = positional[index];
    if (spec !== undefined) written.set(spec.name, argument);
  }
  for (const argument of context.step.named) {
    const spec = named.find((candidate) => candidate.name === argument.name);
    if (spec === undefined) {
      const accepted = named.map((candidate) => candidate.name).join(', ') || 'none';
      return refuse(
        context,
        `does not take '${argument.name}='; it accepts ${accepted}`,
        at(argument.range),
      );
    }
    if (written.has(spec.name)) {
      return refuse(context, `was given '${spec.name}=' twice`, at(argument.range));
    }
    written.set(spec.name, argument);
  }

  const values: Record<string, ArgumentValue> = {};
  for (const spec of specs) {
    const argument = written.get(spec.name);
    if (argument === undefined) {
      if (spec.required === true) {
        const form = spec.positional === true ? `a ${spec.type}` : `${spec.name}=<${spec.type}>`;
        return refuse(context, `needs ${spec.name} (${form})`);
      }
      continue;
    }
    const value = converted(spec, argument.value);
    if (typeof value === 'object') {
      return refuse(context, `${spec.name} ${value.problem}`, at(argument.range));
    }
    values[spec.name] = value;
  }
  return ok(values);
}

function refuse(
  context: VerbContext,
  problem: string,
  range?: SourceRange,
): Result<ArgumentValues, Problems> {
  return err([
    diagnostic(
      'E_RECIPE_ARGUMENTS',
      { verb: context.step.verb, problem },
      { range: range ?? context.written.textRange },
    ),
  ]);
}

function converted(spec: ArgumentSpec, text: string): ArgumentValue | { problem: string } {
  if (spec.values !== undefined && !spec.values.includes(text)) {
    return { problem: `is '${text}', and may be ${spec.values.join(', ')}` };
  }
  switch (spec.type) {
    case 'text':
      return text;
    case 'number': {
      const number = Number(text);
      return text.trim() !== '' && Number.isFinite(number)
        ? number
        : { problem: `is '${text}', which is not a number` };
    }
    case 'date':
      return DATE.test(text) ? text : { problem: `is '${text}', and a date is written 2026-10-24` };
    case 'boolean':
      return text === 'true' || text === 'false'
        ? text === 'true'
        : { problem: `is '${text}', and may be true or false` };
  }
}
