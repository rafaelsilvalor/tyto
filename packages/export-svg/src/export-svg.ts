import type { Artwork, Diagnostic, Diagnostics, Frame, Result, Scene } from '@tyto/core';
import { fromDiagnostics } from '@tyto/core';

import { type SvgExportOptions, type SvgFrame, renderFrame } from './svg.js';

/**
 * `Scene` → one SVG document per frame (`docs/architecture.md`).
 *
 * The second of the two exporters, and the one a designer opens. It takes a `Scene` and
 * nothing else — no AST, no brief — and follows ADR 0013 on diagnostics: a warning rides
 * along with the documents, an error replaces them.
 *
 * Unlike `export-html`, each document is built on its own: an SVG's ids have to be unique
 * inside it and mean nothing outside it, so there is nothing for a scene-wide index to
 * carry. The cost is that a mask may only name a node drawn in the same frame, which is
 * also the only thing the template language can express (`docs/template-authoring.md`).
 */
export function exportSvg(
  scene: Scene,
  options: SvgExportOptions = {},
): Result<readonly SvgFrame[], Diagnostics> {
  const problems: Diagnostic[] = [];
  const frames: SvgFrame[] = [];

  for (const artwork of scene.artworks) {
    for (const frame of artwork.frames) {
      const rendered = renderFrame(scene, artwork, frame, options);
      problems.push(...rendered.problems);
      frames.push({ artwork, frame, svg: rendered.svg });
    }
  }

  return fromDiagnostics(frames, problems);
}

/** One frame, for a caller that already picked one. */
export function exportFrameSvg(
  scene: Scene,
  artwork: Artwork,
  frame: Frame,
  options: SvgExportOptions = {},
): Result<string, Diagnostics> {
  const rendered = renderFrame(scene, artwork, frame, options);
  return fromDiagnostics(rendered.svg, [...rendered.problems]);
}
