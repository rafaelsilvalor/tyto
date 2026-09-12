/**
 * @tyto/core — the vocabulary every other package speaks.
 *
 * Today: `Result`, `Diagnostic`, the diagnostic catalog, source ranges, the Scene IR and
 * the visitor that walks it, the `FileSystem` port, and the template manifest with the
 * registry that discovers one per folder. `resolve` and `compile` follow in E3.3 and E4.2.
 * Pure: no Node, no DOM (ADR 0010).
 */

export {
  type DiagnosticCode,
  type DiagnosticCodeDefinition,
  type DiagnosticParams,
  type DiagnosticSeverity,
  diagnosticCodeDefinition,
  diagnosticCodeList,
  diagnosticCodes,
  formatDiagnosticMessage,
  placeholderNames,
} from './diagnostics/codes.js';

export { didYouMean, editDistance } from './diagnostics/suggest.js';

export {
  type Diagnostic,
  type DiagnosticOptions,
  diagnostic,
  hasErrors,
  isError,
  isWarning,
  sortDiagnostics,
} from './diagnostics/diagnostic.js';

export {
  type Diagnostics,
  type Err,
  type Ok,
  type Result,
  all,
  andThen,
  err,
  fromDiagnostics,
  isErr,
  isOk,
  map,
  mapError,
  match,
  ok,
  unwrapOr,
  unwrapOrElse,
  withWarnings,
} from './result/result.js';

export type {
  Adjustment as BriefAdjustment,
  Bold,
  Break,
  BriefAst,
  Directive,
  Frontmatter,
  Inline,
  Italic,
  Mark,
  RichText,
  Text,
} from './brief/ast.js';

export { type CompileOptions, compile } from './brief/compile.js';

export {
  type FormatCatalogue,
  type FormatDefinition,
  type Formats,
  formatCatalogue,
  formatSchema,
  formatsSchema,
  loadFormats,
  parseFormats,
  undefinedFormats,
} from './config/formats.js';

export {
  type Template,
  type TemplateBuild,
  type TemplateContext,
  defineTemplate,
} from './template/define.js';

export { type RunStyle, type RunsOptions, runsOf } from './template/runs.js';

export {
  type ResolveOptions,
  type ResolvedAdjustment,
  type ResolvedArtwork,
  type ResolvedBrief,
  type ResolvedSlot,
  type SlotValue,
  resolve,
} from './brief/resolve.js';

export type { AssetResolver } from './ports/asset-resolver.js';

export type { FontFace, FontSource } from './ports/font-source.js';

export { type Face, type FaceCache, createFaceCache } from './text/face.js';

export {
  MINIMUM_SHRINK,
  type LayoutOptions,
  type TextMeasurement,
  measureText,
  referenceRun,
} from './text/layout.js';

export type { DirectoryEntry, FileSystem } from './ports/file-system.js';

export {
  type Adjustment,
  type AdjustmentType,
  type Slot,
  type SlotType,
  type TemplateManifest,
  adjustmentSchema,
  adjustmentTypeSchema,
  parseManifest,
  slotSchema,
  slotTypeSchema,
  templateManifestSchema,
} from './template/manifest.js';

export {
  type TemplateFailure,
  type TemplateRegistry,
  loadTemplateRegistry,
} from './template/registry.js';

export {
  type LineColumn,
  type LineColumnRange,
  type LineIndex,
  type SourceRange,
  compareRanges,
  createLineIndex,
  emptyRangeAt,
  isEmptyRange,
  lineColumnAt,
  lineColumnAtIndex,
  lineColumnRange,
  lineColumnRangeAtIndex,
  rangeContains,
  rangeContainsRange,
  rangeLength,
  rangesIntersect,
  sliceRange,
  sourceRange,
  unionRanges,
} from './source/range.js';

export {
  type GroupNode,
  type ImageNode,
  type RectNode,
  type SceneNode,
  type TextAlign,
  type TextNode,
  type TextOverflow,
  type LineBreak,
  type TextRun,
  type TextSpan,
  type TextVerticalAlign,
  type VectorGeometry,
  type VectorNode,
  groupNodeSchema,
  imageNodeSchema,
  rectNodeSchema,
  sceneNodeSchema,
  textAlignSchema,
  textNodeSchema,
  textOverflowSchema,
  lineBreakSchema,
  textRunSchema,
  textSpanSchema,
  textVerticalAlignSchema,
  vectorGeometrySchema,
  vectorNodeSchema,
} from './scene/nodes.js';

export {
  type AssetRef,
  type BlendMode,
  type Color,
  type Effect,
  type Fit,
  type FontRef,
  type GradientStop,
  type MaskRef,
  type Paint,
  type Size,
  type Stroke,
  type Transform,
  type UnitPoint,
  assetRefSchema,
  blendModeSchema,
  blendModes,
  colorSchema,
  effectSchema,
  fitSchema,
  fontRefSchema,
  gradientStopSchema,
  identityTransform,
  maskRefSchema,
  paintSchema,
  sizeSchema,
  strokeSchema,
  transformSchema,
  unitPointSchema,
} from './scene/primitives.js';

export {
  type Artwork,
  type Frame,
  type Scene,
  artworkSchema,
  frameSchema,
  isScene,
  parseScene,
  sceneSchema,
} from './scene/scene.js';

export { sceneInvariants } from './scene/invariants.js';

export {
  type Matrix,
  type Point,
  applyMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrix,
  transformMatrix,
} from './scene/matrix.js';

export {
  type FrameVisit,
  type SceneVisitor,
  type VisitContext,
  anchorBox,
  nodeMatrix,
  walk,
  walkFrame,
} from './scene/visitor.js';

export {
  type Bounds,
  type FrameBounds,
  boundsVisitor,
  frameBounds,
  sceneBounds,
  unionBounds,
} from './scene/bounds.js';

export {
  type SceneFontFace,
  type SceneResources,
  fontFaceKey,
  sceneResources,
} from './scene/resources.js';
