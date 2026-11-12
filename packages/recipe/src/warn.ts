import { type Diagnostic, diagnostic, err, ok } from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { templateText } from './compose.js';
import { localTime } from './local.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  argumentsProblem,
  locate,
  namedValueOffset,
  refuseNamed,
  requireTable,
  rowFilter,
} from './support.js';
import { bindTemplate, parseTemplate, templateProblem } from './template.js';

const NAMES = ['when', 'message'] as const;

/**
 * The most rows one `warn` step lists. A condition that keeps a whole sheet would otherwise bury
 * every other problem of the run under thousands of lines; one more warning counts the rest.
 */
export const WARN_ROW_LIMIT = 100;

/**
 * `warn when="<where>" message="<template>"` reports each row `when` keeps as a warning of the
 * run, in table order, its message filled from the row by `compose`'s `{column|filter}`
 * templates and read from a data file as `compose` reads one: `warn when="last_status = done AND
 * status != done" message="{parent|} does not move back on its own"`. The table passes through
 * unchanged, so a report survives a later `where` that drops the row, which a column written for
 * a person does not (TYTO-437). Each warning names the row's key and points at the step's line;
 * past `WARN_ROW_LIMIT` rows, one more counts the rows it did not list.
 */
export async function warn(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes when= the rows it reports and message= what it says of each, as in ' +
    'warn when="status = blocked" message="{key|} is blocked"';

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const [extra] = context.step.positional;
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));
  const whenArgument = written.get('when');
  const messageArgument = written.get('message');
  if (whenArgument === undefined || messageArgument === undefined) {
    return argumentsProblem(context, usage);
  }

  const source = table.value;
  const kept = rowFilter(context, source, whenArgument.value, namedValueOffset(whenArgument));
  if (!kept.ok) return kept;
  const messageRange = at(messageArgument.range);
  const text = await templateText(context, messageArgument);
  if (!text.ok) return text;
  const template = parseTemplate(text.value);
  if (!template.ok) return err(templateProblem(text.value, template.error, messageRange));
  const time = localTime(context.clock);
  const bound = bindTemplate(template.value, source, context.aliases, messageRange, {}, time);
  if (!bound.ok) return bound;

  const range = context.written.range;
  const matching = source.rows.filter(kept.value);
  const warnings: Diagnostic[] = matching
    .slice(0, WARN_ROW_LIMIT)
    .map((row) =>
      diagnostic(
        'W_RECIPE_WARN',
        { subject: `Row '${row.key}'`, message: bound.value.fill(row) ?? '' },
        { range },
      ),
    );
  const unlisted = matching.length - WARN_ROW_LIMIT;
  if (unlisted > 0) {
    warnings.push(
      diagnostic(
        'W_RECIPE_WARN',
        {
          subject: `${unlisted} more row(s)`,
          message: `matched when="${whenArgument.value}" and are not listed; one warn step lists ${WARN_ROW_LIMIT}`,
        },
        { range },
      ),
    );
  }
  return ok({ table: source }, [...warnings, ...time.warnings(messageRange)]);
}
