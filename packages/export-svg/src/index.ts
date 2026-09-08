/**
 * @tyto/export-svg — `Scene` to one SVG document per frame.
 *
 * A `SceneVisitor` (`docs/architecture.md`) that receives only the IR, never an AST or a
 * brief. The documents make no network requests: fonts are embedded as `@font-face` in an
 * inline `<style>` and images as data URIs, both supplied by the caller through
 * `SvgResources` (ADR 0018).
 *
 * `textAsPaths` draws every run as glyph outlines instead, for a document that must not
 * depend on a font at all — a print shop, or a design tool that will not load the face.
 *
 * Pure: no Node, no DOM (ADR 0010). It builds strings.
 */

export { exportFrameSvg, exportSvg } from './export-svg.js';

export type { Outline, OutlineRequest, SvgFontFace, SvgResources } from './defs.js';

export type { SvgExportOptions, SvgFrame } from './svg.js';
