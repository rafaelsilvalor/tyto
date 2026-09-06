/**
 * @tyto/core — the vocabulary every other package speaks.
 *
 * Today: `Result`, `Diagnostic`, the diagnostic catalog, source ranges and the Scene IR.
 * The visitor, the ports and the template SDK follow in E2.2, E2.3 and E4. Pure: no Node,
 * no DOM (ADR 0010).
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
  type TextRun,
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
  textRunSchema,
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
