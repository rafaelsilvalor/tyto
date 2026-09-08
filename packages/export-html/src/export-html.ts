import type { Artwork, Diagnostic, Diagnostics, Frame, Result, Scene } from '@tyto/core';
import { fromDiagnostics } from '@tyto/core';

import { type HtmlExportOptions, type HtmlFrame, indexNodes, renderFrame } from './html.js';

/**
 * `Scene` → one self-contained HTML document per frame (`docs/architecture.md`).
 *
 * The stage boundary, and the only thing most callers want. It takes a `Scene` and
 * nothing else — no AST, no brief — because what an exporter is allowed to know is the
 * IR, and anything that has to reach the output entered the IR first.
 *
 * Diagnostics follow ADR 0013: a warning rides along with the documents, an error
 * replaces them. Both are worth having as data — the rasterizer downstream turns the
 * first into a note on `result.json` and the second into a non-zero exit.
 *
 * The node index is built once for the whole scene rather than once per frame. A mask may
 * name a node in any frame of any artwork — the invariant only forbids a descendant of
 * the masked node — so a per-frame index would answer "no such node" for a reference the
 * scene actually satisfies.
 */
export function exportHtml(
  scene: Scene,
  options: HtmlExportOptions = {},
): Result<readonly HtmlFrame[], Diagnostics> {
  const nodes = indexNodes(scene);
  const problems: Diagnostic[] = [];
  const frames: HtmlFrame[] = [];

  for (const artwork of scene.artworks) {
    for (const frame of artwork.frames) {
      const rendered = renderFrame(scene, artwork, frame, options, nodes);
      problems.push(...rendered.problems);
      frames.push({ artwork, frame, html: rendered.html });
    }
  }

  return fromDiagnostics(frames, problems);
}

/**
 * One frame, for a caller that already picked one — a live preview redrawing a single
 * format, which is E9.2's whole job and should not pay for the other five.
 */
export function exportFrameHtml(
  scene: Scene,
  artwork: Artwork,
  frame: Frame,
  options: HtmlExportOptions = {},
): Result<string, Diagnostics> {
  const rendered = renderFrame(scene, artwork, frame, options, indexNodes(scene));
  return fromDiagnostics(rendered.html, [...rendered.problems]);
}
