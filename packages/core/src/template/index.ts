/**
 * `@tyto/core/template` — the SDK a `template.ts` imports (`docs/template-authoring.md`).
 *
 * A separate entry point from `@tyto/core` on purpose: a template author wants the six
 * node builders and the values that feed them, not the pipeline's `Result`, the
 * diagnostic catalog or the visitor. Pure: no Node, no DOM (ADR 0010).
 *
 * `defineTemplate` is not here yet. It takes a manifest, and the manifest schema arrives
 * with E4.1; wiring the two is E4.2.
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
  run,
  solid,
  stop,
} from './values.js';

export { TemplateError } from './errors.js';
