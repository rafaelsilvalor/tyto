import type { HtmlResources } from '@tyto/export-html';
import type { SvgResources } from '@tyto/export-svg';

/**
 * The bytes the two built-in exporters need, read off a disk.
 *
 * It used to be `JobResources` in `@tyto/pipeline`, handed to `runJob` as a port. It moved
 * here when the exporters became plugins (TYTO-34): a job no longer knows that HTML and SVG
 * exist, so a type naming both had no business in the stage in the middle. What produces
 * these is a filesystem, and this package is the filesystem's side.
 *
 * The two halves are separate because they are separate: `HtmlResources.font` takes an
 * `HtmlFontFace` where `SvgResources.font` takes an `SvgFontFace`. Reconciling them is
 * TYTO-62's subject, and until then a caller binds each exporter the half it understands.
 */
export interface ExportResources {
  readonly html?: HtmlResources;
  readonly svg?: SvgResources;
}
