/**
 * `@tyto/core/template` — the SDK a `template.ts` imports (`docs/template-authoring.md`).
 *
 * A separate entry point from `@tyto/core` on purpose: a template author wants the six
 * node builders and the values that feed them, not the pipeline's `Result`, the
 * diagnostic catalog or the visitor. Pure: no Node, no DOM (ADR 0010).
 *
 * `defineTemplate` pairs a manifest with the function `compile` calls once per (artwork,
 * format), and `runsOf` turns the rich text of a brief into runs. The manifest type itself
 * ships from `@tyto/core`: a registry reads one without wanting the node builders.
 */

export {
  type Template,
  type TemplateBuild,
  type TemplateContext,
  defineTemplate,
} from './define.js';

export { type RunStyle, type RunsOptions, runsOf } from './runs.js';

export {
  type FrameOptions,
  type GroupDraft,
  type GroupOptions,
  type ImageDraft,
  type ImageOptions,
  type NodeDraft,
  type NodeOptions,
  type RectDraft,
  type RectOptions,
  type TextDraft,
  type TextOptions,
  type VectorDraft,
  type VectorOptions,
  frame,
  group,
  image,
  rect,
  text,
  vector,
} from './nodes.js';

export {
  type AtLeastTwo,
  type ColorChannels,
  type NonEmpty,
  type RunOptions,
  color,
  font,
  imagePaint,
  linearGradient,
  radialGradient,
  lineBreak,
  run,
  solid,
  stop,
} from './values.js';

export { TemplateError } from './errors.js';
