/**
 * `@tyto/core/template` — the SDK a `template.ts` imports (`docs/template-authoring.md`).
 *
 * A separate entry point from `@tyto/core` on purpose: a template author wants the six
 * node builders and the values that feed them, not the pipeline's `Result`, the
 * diagnostic catalog or the visitor. Pure: no Node, no DOM (ADR 0010).
 *
 * `defineTemplate` is not here yet. The manifest it takes ships from `@tyto/core` — a
 * template author declares one, a template registry reads one, and neither wants the node
 * builders — so wiring the two is all that is left, in E4.2.
 */

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
