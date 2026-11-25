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
 *    {@link inset}, {@link at}; {@link table}, {@link slotTable}; {@link mark}, {@link textBlock}; the
 *    brief-row readers. Everything here is the same whatever brand draws it: a component
 *    takes every colour, face and size as configuration.
 * 2. **Brand tokens** — colours, type scale, spacing, flat geometry. **Not here**, because
 *    they belong to a brand rather than to a mechanism, and a kit that shipped one would be
 *    deciding somebody else's brand. They live in `packages/templates/templates/_<brand>/`.
 * 3. **Brand presets and parts** — a component's configuration in one brand's look (the
 *    azul session table), and pieces only that brand draws (its owl header). Beside the
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

export {
  KEEP_TOGETHER_RULES,
  type KeepTogetherRule,
  NO_BREAK_SPACE,
  keepTogether,
  keepTogetherText,
} from './keep-together.js';

export {
  LABEL_EXCEPTIONS,
  LONGEST_LABEL,
  type LabelException,
  type LabelOptions,
  type Labelled,
  labelOf,
  labelOfText,
} from './label.js';

export {
  HIGHLIGHT_WEIGHT,
  type HighlightSpec,
  type HighlightStyle,
  type Highlights,
  type MarkFamily,
  highlights,
  highlightsFromValues,
  richTextOfPlain,
} from './highlight.js';

export { type Mark, mark } from './mark.js';

export {
  BODY_PARAMETERS,
  type BodyOptions,
  type BodyParameters,
  type MarkedSizes,
  bodyBlock,
  bodySize,
} from './body.js';

export {
  type Adjusted,
  BLOCK_COLUMN_PARAMETERS,
  type BlockColumnOptions,
  type BlockColumnParameters,
  type BlockOfKind,
  type BlockScales,
  type Column,
  type ColumnEntry,
  DISTANCE,
  DISTANCES,
  type OrderedBlock,
  type PlacedBlock,
  SIZE,
  SIZES,
  SPACING,
  SPACINGS,
  WEIGHT,
  WEIGHTS,
  blockColumn,
  columnOrder,
  distanceOf,
  entriesInOrder,
  scalesOf,
  sizeOf,
  spacingOf,
  weightOf,
} from './column.js';

export {
  MAIN_LINE_FIT_PARAMETERS,
  type MainLineFitOptions,
  type MainLineFitParameters,
  mainLineScale,
} from './fit.js';

export {
  type Area,
  type ChoiceParameter,
  type LengthParameter,
  type Parameter,
  type ParameterSchema,
  type RatioParameter,
  type ValueOf,
  type ValuesOf,
  parameterValues,
} from './parameters.js';

export { imageHeight } from './image.js';

export { type BandedPageOptions, type Seal, bandedPage, reportOverflow, sealed } from './page.js';

export {
  ORPHAN_LIMITS,
  type OrphanLimits,
  type Setting,
  type SettleRequest,
  type Settled,
  type Spaced,
  type WeightedSpacing,
  orphanOf,
  rebreak,
  reportOrphan,
  settle,
  spaceByWeight,
} from './rhythm.js';

export {
  type Card,
  type CardRole,
  type CardRowItem,
  type CardSegment,
  type CardSegmentKind,
  type CardStyle,
  type PlacedSegment,
  bandBottom,
  card,
  cardRow,
  cardSegments,
  naturalCardHeight,
} from './card.js';
export {
  DEEPEST_LEVEL,
  DIVIDER,
  type Level,
  type LevelGap,
  type LevelItem,
  type LevelLook,
  type LevelPart,
  type LevelPosition,
  type LevelStackStyle,
  levelStack,
  levelsOf,
} from './levels.js';
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
  type SlotTableColumn,
  type SlotTableContent,
  type SlotTableStyle,
  pillTable,
  slotTable,
} from './slot-table.js';

export {
  type Corners,
  type CellPadding,
  type TableCell,
  type TableColumn,
  type TableRow,
  type TableRowKind,
  type TableStyle,
  table,
} from './table.js';
