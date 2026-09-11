import type { Diagnostic, Diagnostics, Result } from '@tyto/core';
import type { Artifact } from '@tyto/pipeline';
import { z } from 'zod';

/**
 * `result.json` — the only thing Jacurutu reads back (ADR 0011, `docs/integrations.md`).
 *
 * It lives here rather than in `core` because it describes a *file*, and files are this
 * package's subject. If the desktop jobs panel ever needs to read one it moves to `core`;
 * writing it there today would put a schema in the pure layer that nothing pure produces.
 *
 * The schema exists so that both ends can check it. `io` validates what it is about to
 * write, which is how a change to this shape fails in a test here instead of in a
 * Jacurutu run nobody is watching.
 */

export const resultArtifactSchema = z.strictObject({
  /** `<artwork>-<format>.<ext>`, relative to the folder `result.json` sits in. */
  name: z.string().min(1),
  artwork: z.string().min(1),
  format: z.string().min(1),
  kind: z.string().min(1),
  mime: z.string().min(1),
  /** Size on disk, so a reader can tell a real render from a zero-byte one. */
  bytes: z.number().int().nonnegative(),
});

export const resultDiagnosticSchema = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
  range: z
    .strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .optional(),
  hint: z.string().optional(),
});

export const renderResultSchema = z.strictObject({
  /**
   * Did anything go wrong — and nothing else.
   *
   * Two values, because ADR 0011 fixes them at two and a third would break the reader on
   * the other side of the contract. It is deliberately **not** "did everything finish":
   * a run the user cancelled is `ok` with fewer artifacts, because nothing went wrong.
   * `cancelled` and the counts answer completeness; `status` answers correctness.
   */
  status: z.enum(['ok', 'error']),
  cancelled: z.boolean(),
  /** Artifacts × formats the job set out to produce, before anything was rendered. */
  planned: z.number().int().nonnegative(),
  artifacts: z.array(resultArtifactSchema),
  diagnostics: z.array(resultDiagnosticSchema),
  tyto: z.strictObject({
    version: z.string().min(1),
    /** Which template, at which version, produced this — what makes a run reproducible. */
    templates: z.array(z.strictObject({ name: z.string().min(1), version: z.string().min(1) })),
  }),
});

export type RenderResult = z.infer<typeof renderResultSchema>;
export type ResultArtifact = z.infer<typeof resultArtifactSchema>;

export interface RenderResultInput {
  readonly cancelled: boolean;
  readonly planned: number;
  readonly artifacts: readonly Artifact[];
  readonly diagnostics: Diagnostics;
  readonly version: string;
  readonly templates: readonly { readonly name: string; readonly version: string }[];
}

function resultDiagnostic(item: Diagnostic): z.infer<typeof resultDiagnosticSchema> {
  // Spread rather than assign undefined: `exactOptionalPropertyTypes` distinguishes an
  // absent key from an undefined one, and a `strictObject` would reject `range: undefined`
  // on the way back in.
  return {
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.range === undefined
      ? {}
      : { range: { start: item.range.start, end: item.range.end } }),
    ...(item.hint === undefined ? {} : { hint: item.hint }),
  };
}

/**
 * Builds the document from what a job returned.
 *
 * `status` is derived from the diagnostics rather than taken as an argument, so nothing
 * can write `ok` over a page of errors.
 */
export function renderResult(input: RenderResultInput): RenderResult {
  return {
    status: input.diagnostics.some((item) => item.severity === 'error') ? 'error' : 'ok',
    cancelled: input.cancelled,
    planned: input.planned,
    artifacts: input.artifacts.map((artifact) => ({
      name: artifact.name,
      artwork: artifact.artwork,
      format: artifact.format,
      kind: artifact.kind,
      mime: artifact.mime,
      bytes: artifact.bytes.byteLength,
    })),
    diagnostics: input.diagnostics.map(resultDiagnostic),
    tyto: { version: input.version, templates: [...input.templates] },
  };
}

/** Parses a `result.json` that came from somewhere else — a fixture, or the other end. */
export function parseRenderResult(input: unknown): Result<RenderResult, readonly string[]> {
  const parsed = renderResultSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data, warnings: [] }
    : {
        ok: false,
        error: parsed.error.issues.map(
          (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
        ),
      };
}
