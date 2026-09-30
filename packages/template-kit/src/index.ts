/**
 * `@tyto/template-kit` — what a template written in TypeScript composes with.
 *
 * ADR 0005 gave a template two routes, and this one is code: `defineTemplate` pairs a
 * manifest with a function, and `compile` calls that function once per (artwork, format).
 * `@tyto/core/template` supplies the six node builders; this package supplies the layer
 * above them, which the SDK deliberately does not — arrangement.
 *
 * ## The four layers, and where each one lives
 *
 * `docs/template-conventions.md` is the long form, ADR 0047 the decision. In short:
 *
 * 1. **Configurable components and arrangement — here.** {@link stack}, {@link row},
 *    {@link inset}, {@link at}; {@link pillTable}; {@link mark}, {@link textBlock}; the
 *    brief-row readers. Everything here is the same whatever brand draws it: a component
 *    takes every colour, face and size as configuration.
 * 2. **Brand tokens** — colours, type scale, spacing, flat geometry. **Not here**, because
 *    they belong to a brand rather than to a mechanism, and a kit that shipped one would be
 *    deciding somebody else's brand. They live in `packages/templates/templates/_<brand>/`.
 * 3. **Brand presets and parts** — a component's configuration in one brand's look (the
 *    Saúde session table), and pieces only that brand draws (its owl header). Beside the
 *    tokens, shared between that brand's templates by import.
 * 4. **The template** — composition only: which presets, in what order, where.
 *
 * ## Why this is a package and not a folder in the template pack
 *
 * `@tyto/templates` states its own job narrowly: it is a pack, and what it owns is "the
 * one string that is nobody else's business" — the name of the folder its templates sit
 * in. Arrangement is a library that any template imports, including templates that will
 * never be in that pack, so it gets its own boundary rather than a second reason for that
 * package to change.
 *
 * Pure, like everything a template can reach: no Node, no DOM (ADR 0010).
 */

export {
  type Align,
  type Block,
  type InsetOptions,
  type Padding,
  type RowOptions,
  type StackOptions,
  at,
  block,
  inset,
  row,
  sized,
  stack,
} from './blocks.js';

export { type Mark, mark } from './mark.js';

export { type BandedPageOptions, type Seal, bandedPage, reportOverflow, sealed } from './page.js';

export {
  type TitleBlockContent,
  type TitleBlockStyle,
  type TitleImagePart,
  type TitlePart,
  type TitleRulePart,
  type TitleTextPart,
  titleBlock,
} from './title-block.js';

export {
  type Measure,
  type TextBlockOptions,
  type TextStyle,
  atLeastOne,
  grownTextBlock,
  naturalWidth,
  textBlock,
} from './text.js';

export { FIELD_SEPARATOR, type RowGroup, fields, lines, plain, rowGroups } from './rows.js';

export {
  type CaptionStyle,
  type CellShape,
  type LabelColumn,
  type LinesColumn,
  type PillTableColumn,
  type PillTableContent,
  type PillTableStyle,
  type Rewrite,
  pillTable,
} from './pill-table.js';
