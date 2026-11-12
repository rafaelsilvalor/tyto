import {
  type Diagnostic,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sourceRange,
} from '@tyto/core';

import type { Argument, Step } from './ast.js';
import { isWritableColumnName } from './columns.js';
import { isDataReference } from './data.js';
import { GENERIC_VERB_FORMS, type VerbField, type VerbForm } from './forms.js';
import { parseRecipe } from './parse.js';

/**
 * A form's values by field name, as the person typed them. An absent or empty value is a field
 * left blank; a flag is `'true'` when its word is written.
 */
export type StepValues = Readonly<Record<string, string>>;

// A pattern's `\p{Lu}` and `\u{FF}` are the pattern's own braces, as `parse.ts` reads them.
const PLACEHOLDER = /(?<!\\[pPu])\{([A-Za-z_][\w-]*)\}/gu;
const NAME_BEFORE_EQUALS = /^[A-Za-z_][\w-]*=/u;
/** A column written bare reads back as itself; any other is written in quotes (TYTO-674). */
const BARE_COLUMN = /^[\w{}-]+$/u;

/**
 * Writes the one recipe line a form describes (ADR 0176): the text stays the source of truth,
 * and a form is a way of typing that line. Every line answered parses, and reads back through
 * {@link valuesOfStep} as the values given; a value one line cannot carry, a double quote in a
 * value that needs quoting, a line break, inline JSON with an escaped quote, is refused with
 * `E_RECIPE_FORM` rather than written half-quoted. A `{param}` placeholder is written as typed:
 * whether the recipe declares it is the recipe's question, not the line's.
 */
export function formatStep(
  verb: string | VerbForm,
  values: StepValues,
): Result<string, readonly Diagnostic[]> {
  const form = formOf(verb);
  if (form === undefined) return refuse(`'${String(verb)}' has no form`);
  const wanted = canonicalValues(form, values);
  if (!wanted.ok) return wanted;

  const words: string[] = [form.verb];
  let tail: string | undefined;
  const assignmentName = form.fields.find((field) => field.placement === 'assignment-name');
  for (const field of form.fields) {
    const value = wanted.value[field.name];
    if (value === undefined) continue;
    switch (field.placement) {
      case 'flag':
        words.push(field.name);
        break;
      case 'positional': {
        const written = positionalWords(field, value);
        if (!written.ok) return written;
        words.push(written.value);
        break;
      }
      case 'named':
        if (field.inline === true && !isDataReference(value)) {
          tail = `${field.name}=${value}`;
        } else if (field.kind === 'columns') {
          words.push(`${field.name}=${value}`);
        } else {
          const quoted = quotedValue(field, value, false);
          if (!quoted.ok) return quoted;
          words.push(`${field.name}=${quoted.value}`);
        }
        break;
      case 'assignment-value': {
        const column = assignmentName === undefined ? undefined : wanted.value[assignmentName.name];
        const quoted = quotedValue(field, value, false);
        if (!quoted.ok) return quoted;
        if (column !== undefined) words.push(`${columnWord(column)}=${quoted.value}`);
        break;
      }
      case 'pairs':
        words.push(value);
        break;
      case 'rest':
        tail = value;
        break;
      case 'assignment-name':
        break;
    }
  }
  if (tail !== undefined) words.push(tail);
  const line = words.join(' ');

  const probe = probeStep(line);
  if (!probe.ok) return probe;
  const back = valuesOfStep(form, probe.value.step);
  if (!back.ok) return err(back.error.map((problem) => shifted(problem, probe.value.offset)));
  const differs = form.fields.find((field) => back.value[field.name] !== wanted.value[field.name]);
  if (differs !== undefined) {
    return refuse(
      `${differs.name} would read back as '${back.value[differs.name] ?? ''}', not ` +
        `'${wanted.value[differs.name] ?? ''}'`,
      sourceRange(0, line.length),
    );
  }
  return ok(line);
}

/**
 * The values a step's line holds, by the fields of its verb's form: the inverse of
 * {@link formatStep}, which a form reads to edit a line in place. Quotes are taken off, a flag
 * written is `'true'`, and `name=value` pairs come back in the form `formatStep` writes.
 */
export function valuesOfStep(
  verb: string | VerbForm,
  step: Step,
): Result<Record<string, string>, readonly Diagnostic[]> {
  const form = formOf(verb);
  if (form === undefined) return refuse(`'${String(verb)}' has no form`, step.verbRange);
  if (form.verb !== step.verb) {
    return refuse(`the line is a '${step.verb}', not a '${form.verb}'`, step.verbRange);
  }
  const values: Record<string, string> = {};

  const rest = form.fields.find((field) => field.placement === 'rest');
  if (rest !== undefined) {
    if (step.text !== '') values[rest.name] = step.text;
    return ok(values);
  }

  // Inline JSON runs to the end of the line: its words are its own, never arguments.
  let cut = Number.POSITIVE_INFINITY;
  for (const field of form.fields) {
    if (field.inline !== true) continue;
    const written = step.named.find(
      (argument) => argument.name === field.name && !isDataReference(argument.value),
    );
    if (written === undefined || written.range.start >= cut) continue;
    const valueStart = written.range.start + field.name.length + 1;
    values[field.name] = step.text.slice(valueStart - step.textRange.start);
    cut = written.range.start;
  }

  const flags = form.fields.filter((field) => field.placement === 'flag');
  const positionalFields = form.fields.filter((field) => field.placement === 'positional');
  // A flag is written after the required bare words, so `map reverse` reads a column.
  const requiredCount = positionalFields.filter((field) => field.required).length;
  const bare: string[] = [];
  for (const argument of step.positional) {
    if (argument.range.start >= cut) continue;
    const flag = flags.find((candidate) => candidate.name === argument.value);
    if (flag !== undefined && bare.length >= requiredCount) {
      if (values[flag.name] !== undefined) {
        return refuse(`${flag.name} is written twice`, argument.range);
      }
      values[flag.name] = 'true';
      continue;
    }
    const field = positionalFields[bare.length] ?? lastCollecting(positionalFields);
    if (field === undefined) {
      return refuse(`'${form.verb}' takes no bare word '${argument.value}'`, argument.range);
    }
    const existing = values[field.name];
    const word = collects(field) ? asWritten(argument) : argument.value;
    values[field.name] = existing === undefined ? word : `${existing} ${word}`;
    if (positionalFields[bare.length] !== undefined) bare.push(field.name);
  }

  const assignmentName = form.fields.find((field) => field.placement === 'assignment-name');
  const assignmentValue = form.fields.find((field) => field.placement === 'assignment-value');
  const pairs = form.fields.find((field) => field.placement === 'pairs');
  const pairWords: string[] = [];
  for (const argument of step.named) {
    if (argument.range.start >= cut) continue;
    const field = form.fields.find(
      (candidate) => candidate.placement === 'named' && candidate.name === argument.name,
    );
    if (field !== undefined) {
      if (values[field.name] !== undefined) {
        return refuse(`${field.name}= is written twice`, argument.range);
      }
      values[field.name] = field.kind === 'columns' ? asWritten(argument) : argument.value;
    } else if (
      assignmentName !== undefined &&
      assignmentValue !== undefined &&
      values[assignmentName.name] === undefined
    ) {
      values[assignmentName.name] = argument.name;
      values[assignmentValue.name] = argument.value;
    } else if (pairs !== undefined) {
      const quoted = quotedValue(pairs, argument.value, false);
      if (!quoted.ok)
        return err(quoted.error.map((problem) => ({ ...problem, range: argument.range })));
      pairWords.push(`${argument.name}=${quoted.value}`);
    } else {
      return refuse(`'${form.verb}' takes no '${argument.name}='`, argument.range);
    }
  }
  if (pairs !== undefined && pairWords.length > 0) values[pairs.name] = pairWords.join(' ');
  return ok(values);
}

/** A word as the line wrote it: a quoted column keeps its quotes, so a list reads back whole. */
function asWritten(argument: Argument): string {
  return argument.quoted === true ? `"${argument.value}"` : argument.value;
}

/** A column name as one word: bare when it reads back as itself, otherwise in quotes. */
function columnWord(name: string): string {
  return BARE_COLUMN.test(name) ? name : `"${name}"`;
}

function formOf(verb: string | VerbForm): VerbForm | undefined {
  return typeof verb === 'string' ? GENERIC_VERB_FORMS[verb] : verb;
}

/** A field that takes the rest of the bare words: `select`'s columns, `derive`'s names. */
function collects(field: VerbField): boolean {
  return field.kind === 'words' || field.kind === 'columns';
}

function lastCollecting(fields: readonly VerbField[]): VerbField | undefined {
  const last = fields.at(-1);
  return last !== undefined && collects(last) ? last : undefined;
}

/**
 * The values as `formatStep` writes them and `valuesOfStep` reads them back: blanks dropped, a
 * flag kept only when `'true'`, collecting words single-spaced and pairs requoted.
 */
function canonicalValues(
  form: VerbForm,
  values: StepValues,
): Result<Record<string, string>, readonly Diagnostic[]> {
  const known = new Set(form.fields.map((field) => field.name));
  const stray = Object.keys(values).find((name) => !known.has(name));
  if (stray !== undefined) return refuse(`'${form.verb}' has no field '${stray}'`);

  const canonical: Record<string, string> = {};
  for (const field of form.fields) {
    const raw = values[field.name];
    const value = raw === undefined || field.placement === 'rest' ? raw : raw.trim();
    if (value === undefined || value.trim() === '') continue;
    if (/[\r\n]/u.test(value)) {
      return refuse(`${field.name} holds a line break, and a step is one line`);
    }
    if (field.placement === 'flag') {
      if (value !== 'true' && value !== 'false') {
        return refuse(`${field.name} is a word that is written or not, so true or false`);
      }
      if (value === 'true') canonical[field.name] = value;
      continue;
    }
    if (field.values !== undefined && !field.values.includes(value)) {
      return refuse(`${field.name} is '${value}', and may be ${field.values.join(', ')}`);
    }
    if (
      field.placement === 'assignment-name' &&
      !isWritableColumnName(value) &&
      !isWritableColumnName(value, true)
    ) {
      return refuse(
        `${field.name} '${value}' is not a column name: letters, digits, - and _, or in ` +
          'quotes also blanks and punctuation but no double quote',
      );
    }
    if (field.kind === 'columns') {
      const list = columnList(field, value);
      if (!list.ok) return list;
      canonical[field.name] = list.value;
    } else if (field.placement === 'positional' && collects(field)) {
      canonical[field.name] = value.split(/\s+/u).join(' ');
    } else if (field.placement === 'pairs') {
      const pairs = canonicalPairs(field, value);
      if (!pairs.ok) return pairs;
      canonical[field.name] = pairs.value;
    } else {
      canonical[field.name] = field.placement === 'rest' ? value.trim() : value;
    }
  }
  const missing = form.fields.filter(
    (field) => field.required && canonical[field.name] === undefined,
  );
  if (missing.length > 0) {
    return refuse(`'${form.verb}' needs ${missing.map((field) => field.name).join(', ')}`);
  }
  return ok(canonical);
}

/** `team=design note="two words"` read as the tokenizer reads it, and written back alike. */
function canonicalPairs(field: VerbField, value: string): Result<string, readonly Diagnostic[]> {
  const probe = probeStep(`pairs ${value}`);
  if (!probe.ok) return refuse(`${field.name} is not written as name=value pairs`);
  const { step } = probe.value;
  if (step.positional.length > 0) {
    return refuse(
      `${field.name} is written as name=value pairs, and '${step.positional[0]?.value ?? ''}' is not one`,
    );
  }
  const words: string[] = [];
  for (const argument of step.named) {
    const quoted = quotedValue(field, argument.value, false);
    if (!quoted.ok) return quoted;
    words.push(`${argument.name}=${quoted.value}`);
  }
  return ok(words.join(' '));
}

/**
 * A list of columns as the line writes it. A named list, `without=`, has no blank, since a
 * blank ends the word: its members are split at commas outside quotes, and a member is kept in
 * the quotes it was typed in or quoted when it would not read back bare, `key,"Última Sync"`.
 * A positional list, `select`, is kept as typed with its blanks single, because a blank
 * separates its bare names (`select key, title status`) and a name with one is typed in quotes.
 */
function columnList(field: VerbField, value: string): Result<string, readonly Diagnostic[]> {
  if ((value.match(/"/gu) ?? []).length % 2 !== 0) {
    return refuse(`${field.name} opens a quote it does not close`);
  }
  const pieces = value.split(/("[^"]*")/u);
  if (field.placement === 'positional') {
    return ok(
      pieces
        .map((piece, index) => (index % 2 === 1 ? piece : piece.replace(/\s+/gu, ' ')))
        .join(''),
    );
  }
  const members: string[] = [];
  let current = '';
  const flush = (): Result<undefined, readonly Diagnostic[]> => {
    const member = current.trim();
    current = '';
    if (member === '') return ok(undefined);
    if (/^"[^"]*"$/u.test(member)) members.push(member);
    else if (member.includes('"')) {
      return refuse(`${field.name} holds '${member}', which mixes a quote into a name`);
    } else members.push(columnWord(member));
    return ok(undefined);
  };
  for (const [index, piece] of pieces.entries()) {
    if (index % 2 === 1) {
      current += piece;
      continue;
    }
    const parts = piece.split(',');
    for (const [at, part] of parts.entries()) {
      current += part;
      if (at < parts.length - 1) {
        const flushed = flush();
        if (!flushed.ok) return flushed;
      }
    }
  }
  const flushed = flush();
  if (!flushed.ok) return flushed;
  return ok(members.join(','));
}

function positionalWords(field: VerbField, value: string): Result<string, readonly Diagnostic[]> {
  if (!collects(field)) return quotedValue(field, value, true);
  if (field.kind === 'columns') return ok(value);
  for (const word of value.split(' ')) {
    if (word.startsWith('"') || NAME_BEFORE_EQUALS.test(word)) {
      return refuse(`${field.name} holds '${word}', which would not read back as a name`);
    }
  }
  return ok(value);
}

/**
 * The value as one token: bare when it can be, in double quotes when it holds a blank, starts
 * with a quote, or, bare, would read as `name=value`. A quote has no escape in a recipe line,
 * so a value that needs quoting and holds a double quote is refused.
 */
function quotedValue(
  field: VerbField,
  value: string,
  positional: boolean,
): Result<string, readonly Diagnostic[]> {
  const needsQuotes =
    /\s/u.test(value) ||
    value.startsWith('"') ||
    (positional && NAME_BEFORE_EQUALS.test(value)) ||
    (field.kind === 'column' && !BARE_COLUMN.test(value));
  if (!needsQuotes) return ok(value);
  if (value.includes('"')) {
    return refuse(
      `${field.name} holds a double quote and needs quoting, which one recipe line cannot ` +
        'carry; put the value in a vocabulary file and refer to it',
    );
  }
  return ok(`"${value}"`);
}

interface Probe {
  readonly step: Step;
  /** Where the line starts in the probe text, which a problem's range is moved back by. */
  readonly offset: number;
}

/**
 * The line parsed as the only step of a recipe that declares every `{param}` it uses: whether
 * the real recipe declares them is the recipe's question, not the line's.
 */
function probeStep(line: string): Result<Probe, readonly Diagnostic[]> {
  const params = [...new Set([...line.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))];
  const header = ['recipe form', ...params.map((name) => `param ${name}`), ''].join('\n');
  const parsed = parseRecipe(`${header}${line}`);
  if (!parsed.ok) return err(parsed.error.map((problem) => shifted(problem, header.length)));
  const step = parsed.value.steps[0];
  if (step === undefined) return refuse(`the line '${line}' is not a step`);
  return ok({ step, offset: header.length });
}

/** A problem the line format found, moved from the probe text onto the line alone. */
function shifted(problem: Diagnostic, offset: number): Diagnostic {
  if (problem.range === undefined) return problem;
  const start = Math.max(0, problem.range.start - offset);
  const end = Math.max(start, problem.range.end - offset);
  return { ...problem, range: sourceRange(start, end) };
}

function refuse<Value>(
  problem: string,
  range: SourceRange = sourceRange(0, 0),
): Result<Value, readonly Diagnostic[]> {
  return err([diagnostic('E_RECIPE_FORM', { problem }, { range })]);
}
