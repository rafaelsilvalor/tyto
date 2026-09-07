import { type Document, parseDocument } from 'yaml';
import type { z } from 'zod';

import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { type SourceRange, sourceRange } from '../source/range.js';

/**
 * Reading a Zod failure back onto the YAML that caused it.
 *
 * Every configuration file Tyto reads is YAML validated by a Zod schema, and every one of
 * them owes its author the same thing: the path of the offending key *and* a range over
 * the value, because a path with no position is a message an editor cannot draw. Doing
 * that twice would be two chances to do it differently, so `manifest.yaml` and
 * `formats.yaml` do it here.
 *
 * `yaml` stays inside the pure boundary through its export conditions rather than by
 * having one build (ADR 0010); the note in `packages/brief-lang/src/frontmatter.ts` has
 * the detail.
 */

export type YamlDocument = Document.Parsed;

/** `slots.titulo.max` — the same path Zod reports, joined the way a YAML reader scans. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}

/** `yaml` reports a message with a code frame under it; a gutter wants the first line. */
export function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}

/**
 * The span of the value a Zod path points at.
 *
 * A path may name a key the document does not have — that is what a missing required field
 * is — so it climbs towards the root until something resolves. Blaming the enclosing
 * mapping is the closest true answer to "where should I add this", and it beats blaming
 * the first character of the file.
 */
export function rangeAt(
  document: YamlDocument,
  path: readonly PropertyKey[],
): SourceRange | undefined {
  for (let depth = path.length; depth >= 0; depth -= 1) {
    const node: unknown =
      depth === 0 ? document.contents : document.getIn(path.slice(0, depth), true);
    const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
    if (range) return sourceRange(range[0], range[1]);
  }
  return undefined;
}

/** exactOptionalPropertyTypes tells an absent key from an undefined one. */
export function withRange(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}

export interface YamlRead {
  readonly document: YamlDocument;
  /** Parse failures. Non-empty means `data` is not worth looking at. */
  readonly errors: readonly { readonly problem: string; readonly range: SourceRange }[];
  readonly data: unknown;
}

/**
 * Parses YAML without throwing, collecting every error rather than stopping at the first —
 * the same promise the rest of the pipeline makes: one pass, every problem.
 */
export function readYaml(source: string): YamlRead {
  const document = parseDocument(source);
  return {
    document,
    errors: document.errors.map((error) => ({
      problem: firstLine(error.message),
      range: sourceRange(error.pos[0], Math.min(error.pos[1], source.length)),
    })),
    data: document.toJS(),
  };
}

/**
 * One diagnostic per Zod issue, each positioned.
 *
 * A `strictObject` reports every unknown key of one object in a single issue whose path
 * stops at the object. They are split, so each stray key gets its own squiggle on itself
 * rather than one shared complaint on the mapping above them.
 */
export function shapeDiagnostics(
  document: YamlDocument,
  issues: readonly z.core.$ZodIssue[],
  build: (path: string, problem: string, range: SourceRange | undefined) => Diagnostic,
): Diagnostic[] {
  return issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => {
        const path = [...issue.path, key];
        return build(issuePath(path), 'unknown key', rangeAt(document, path));
      });
    }
    return [build(issuePath(issue.path), issue.message, rangeAt(document, issue.path))];
  });
}

/** The shape every config parser has: read, validate, and say where it went wrong. */
export function parseYamlConfig<Schema extends z.ZodType>(
  source: string,
  schema: Schema,
  codes: {
    readonly syntax: (problem: string, range: SourceRange) => Diagnostic;
    readonly shape: (path: string, problem: string, range: SourceRange | undefined) => Diagnostic;
  },
): { readonly value: z.infer<Schema> } | { readonly diagnostics: readonly Diagnostic[] } {
  const read = readYaml(source);

  if (read.errors.length > 0) {
    return { diagnostics: read.errors.map((error) => codes.syntax(error.problem, error.range)) };
  }

  const parsed = schema.safeParse(read.data);
  if (!parsed.success) {
    return { diagnostics: shapeDiagnostics(read.document, parsed.error.issues, codes.shape) };
  }

  return { value: parsed.data as z.infer<Schema> };
}

/** Re-exported so a caller building its own diagnostics does not import `yaml` twice. */
export { diagnostic };
