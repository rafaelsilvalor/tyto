import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';
import type { ZodType } from 'zod';

import type { Argument } from './ast.js';
import type { VerbContext } from './registry.js';
import { type Problems, locate } from './support.js';

/**
 * Configuration a recipe reads from the workspace (ADR 0136, ADR 0137).
 *
 * A verb argument written `@./vocab.json#/kinds` names a JSON file beside the recipe and a
 * JSON Pointer (RFC 6901) into it; `@./vocab.json` alone names the whole document. The host
 * reads and parses the file through the {@link DataResolver} port, so this package stays pure:
 * it never sees a path on a disk, only the value the host parsed. What the host refuses, and
 * what the pointer or the verb's schema refuses here, is a diagnostic at the argument.
 */

/**
 * Reads the file a reference names and answers with its parsed value. The path is the one the
 * recipe wrote, relative to the recipe's folder; the host decides what it resolves to, confines
 * it to the workspace and refuses it in a restricted one (ADR 0111, ADR 0112). Its diagnostics
 * carry no range: the file's own offsets mean nothing in the recipe, so this package moves
 * them to the argument that named the file.
 */
export type DataResolver = (path: string) => Promise<Result<unknown, readonly Diagnostic[]>>;

/** `@<path>#<pointer>` taken apart. The pointer is `''` when the whole document is meant. */
export interface DataReference {
  readonly path: string;
  readonly pointer: string;
  /** The tokens of the pointer, unescaped: `/a~1b/0` is `['a/b', '0']`. */
  readonly tokens: readonly string[];
}

/** Whether an argument is written as a data reference rather than as a value. */
export function isDataReference(text: string): boolean {
  return text.startsWith('@');
}

/**
 * The reference an argument writes, or why it is not one.
 *
 * The pointer is the JSON-string form of RFC 6901 (`~0` is `~`, `~1` is `/`); the URI
 * fragment form's percent-encoding is not decoded, so `%20` is three characters of a key.
 * The path must be relative: an absolute path or a URL names something outside the
 * workspace by construction, and is refused before any host is asked.
 */
export function parseDataReference(text: string): Result<DataReference, string> {
  if (!isDataReference(text)) {
    return err("is not a data reference, which is written '@<file>' or '@<file>#/<pointer>'");
  }
  const body = text.slice(1);
  const hash = body.indexOf('#');
  const path = hash === -1 ? body : body.slice(0, hash);
  const pointer = hash === -1 ? '' : body.slice(hash + 1);
  if (path === '') return err("names no file; it is written '@./file.json#/pointer'");
  if (/^(?:[A-Za-z]:|[\\/])/u.test(path) || /^[A-Za-z][\w+.-]*:/u.test(path)) {
    return err(`names '${path}', and a data file is named relative to the recipe's folder`);
  }
  if (pointer !== '' && !pointer.startsWith('/')) {
    return err(`has the pointer '${pointer}', and a JSON Pointer is empty or starts with '/'`);
  }
  const tokens: string[] = [];
  if (pointer !== '') {
    for (const raw of pointer.slice(1).split('/')) {
      if (/~(?![01])/u.test(raw)) {
        return err(`has the pointer '${pointer}', where '~' is written '~0' and '/' is '~1'`);
      }
      tokens.push(raw.replace(/~1/gu, '/').replace(/~0/gu, '~'));
    }
  }
  return ok({ path, pointer, tokens });
}

/** What the pointer reaches in `document`, or where it stopped. */
export function resolvePointer(
  document: unknown,
  tokens: readonly string[],
): Result<unknown, string> {
  let current = document;
  let walked = '';
  for (const token of tokens) {
    const here = walked === '' ? 'the document' : `'${walked}'`;
    walked = `${walked}/${token.replace(/~/gu, '~0').replace(/\//gu, '~1')}`;
    if (Array.isArray(current)) {
      // RFC 6901: an index is decimal without leading zeros; '-' names the element after the
      // last, which never exists in a document being read.
      if (!/^(?:0|[1-9]\d*)$/u.test(token)) {
        return err(`reaches a list at ${here}, and '${token}' is not an index into it`);
      }
      const index = Number(token);
      if (index >= current.length) {
        return err(`reaches a list of ${String(current.length)} at ${here}, with no item ${token}`);
      }
      current = current[index] as unknown;
      continue;
    }
    if (typeof current === 'object' && current !== null) {
      // Own keys only: a pointer to `/__proto__` or `/constructor` names a key the file wrote,
      // never something every object inherits.
      if (!Object.hasOwn(current, token)) {
        return err(`finds no key '${token}' at ${here}`);
      }
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return err(
      `reaches a ${current === null ? 'null' : typeof current} at ${here}, not a list or an object`,
    );
  }
  return ok(current);
}

/**
 * The slice of a data file an argument names, checked against the shape the verb expects.
 *
 * Every refusal lands at the argument: a reference that is not one, a host without data
 * files, the host's own refusal (a missing file, a file outside the workspace, a restricted
 * workspace, text that is not JSON), a pointer that reaches nothing, and a slice the verb's
 * schema refuses. The verb owns the schema, because the verb knows what a `kinds` list means.
 */
export async function readDataArgument<Shape>(
  context: VerbContext,
  argument: Argument,
  schema: ZodType<Shape>,
): Promise<Result<Shape, Problems>> {
  const range = locate(context)(argument.range);
  const refuse = (problem: string): Result<Shape, Problems> =>
    err([diagnostic('E_RECIPE_DATA', { reference: argument.value, problem }, { range })]);

  const reference = parseDataReference(argument.value);
  if (!reference.ok) return refuse(reference.error);
  if (context.resolveData === undefined) {
    return refuse('cannot be read, because whatever runs this recipe gives it no data files');
  }

  const read = await context.resolveData(reference.value.path);
  if (!read.ok) {
    if (read.error.length === 0) return refuse('names a file that was not found');
    return err(read.error.map((problem) => ({ ...problem, range })));
  }

  const misshapen = (problem: string): Result<Shape, Problems> =>
    err([diagnostic('E_RECIPE_DATA_SHAPE', { reference: argument.value, problem }, { range })]);
  const slice = resolvePointer(read.value, reference.value.tokens);
  if (!slice.ok) return misshapen(`its pointer ${slice.error}`);

  const checked = schema.safeParse(slice.value);
  if (checked.success) return ok(checked.data);
  return misshapen(describeIssues(checked.error.issues));
}

/** The first issues Zod found, each with where in the slice it is, for one sentence. */
function describeIssues(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  const shown = issues.slice(0, 3).map((issue) => {
    const where = issue.path.map((key) => String(key)).join('/');
    return where === '' ? issue.message : `at '/${where}': ${issue.message}`;
  });
  const more =
    issues.length > shown.length ? `, and ${String(issues.length - shown.length)} more` : '';
  return `${shown.join('; ')}${more}`;
}
