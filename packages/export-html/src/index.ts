/**
 * @tyto/export-html — `Scene` to a self-contained HTML document per frame.
 *
 * A `SceneVisitor` (`docs/architecture.md`) that receives only the IR, never an AST or a
 * brief. The documents it produces make no network requests: fonts and images arrive as
 * bytes through `HtmlResources` and are embedded, because the rasterizer downstream opens
 * them offline and the same brief must produce the same pixels every time.
 *
 * Pure: no Node, no DOM (ADR 0010). It builds strings.
 */

export { exportFrameHtml, exportHtml } from './export-html.js';

export {
  HTML_EXPORTER_KINDS,
  type HtmlExporterPluginOptions,
  htmlExporterPlugin,
} from './plugin.js';

export type { HtmlExportOptions, HtmlFontFace, HtmlFrame, HtmlResources } from './html.js';
