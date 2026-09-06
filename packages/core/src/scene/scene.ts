import { z } from 'zod';

import { sceneNodeSchema } from './nodes.js';
import { assetRefSchema, fontRefSchema, paintSchema, sizeSchema } from './primitives.js';
import { sceneInvariants } from './invariants.js';
import { diagnostic, type Diagnostic } from '../diagnostics/diagnostic.js';
import { type Diagnostics, type Result, err, fromDiagnostics } from '../result/result.js';

/**
 * The Scene IR: what a template produces and what every exporter consumes (ADR 0003).
 *
 * `docs/ir-schema.md` calls the root `Document`; the rest of the codebase — and the port
 * signatures in `docs/architecture.md` — call it `Scene`, so `Scene` is the name that
 * ships and the doc has been aligned to it.
 */

export const frameSchema = z.strictObject({
  /** Manifest format name, such as `feed` or `story`. */
  format: z.string().min(1),
  size: sizeSchema,
  /** No background means transparent: the rasterizer omits it rather than painting white. */
  background: paintSchema.optional(),
  children: z.array(sceneNodeSchema),
});
export type Frame = z.infer<typeof frameSchema>;

/** One artwork per carousel slide; its frames are the same artwork in each format. */
export const artworkSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().optional(),
  frames: z.array(frameSchema),
});
export type Artwork = z.infer<typeof artworkSchema>;

export const sceneSchema = z.strictObject({
  version: z.literal(1),
  artworks: z.array(artworkSchema),
  fonts: z.array(fontRefSchema).default([]),
  assets: z.array(assetRefSchema).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;

/** `artworks.0.frames.1.children.2.runs` — the same path Zod reports, joined for reading. */
function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}

function shapeDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  return diagnostic('E_SCENE_SHAPE', {
    path: issuePath(issue.path),
    problem: issue.message,
  });
}

/**
 * Parses and validates a scene in one call.
 *
 * Shape and invariants are separate passes on purpose. An invariant asks questions the
 * shape cannot — whether a mask points at a real node, whether a font was declared — and
 * asking them of a value that is not yet a `Scene` would mean writing every check against
 * `unknown`. So the shape has to hold first; only then do the cross-references run, and
 * they run all of them, because an author wants every problem in one pass.
 */
export function parseScene(input: unknown): Result<Scene, Diagnostics> {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues.map(shapeDiagnostic));
  }
  return fromDiagnostics(parsed.data, sceneInvariants(parsed.data));
}

/** True when the value is a scene, for callers that only need the question answered. */
export function isScene(input: unknown): input is Scene {
  return sceneSchema.safeParse(input).success;
}
