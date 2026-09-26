import type { TemplateManifest } from './manifest.js';
import type { ResolvedSlot } from '../brief/resolve.js';
import type { Size } from '../scene/primitives.js';
import type { Frame } from '../scene/scene.js';
import type { MeasurableText, TextMeasurement } from '../text/layout.js';

/**
 * `defineTemplate` — what a `template.ts` exports (`docs/template-authoring.md`).
 *
 * A template is a manifest and a function. The manifest is read without running anything,
 * which is what lets a picker list templates and a brief be validated long before output
 * is asked for; the function runs once per (artwork, format) and returns that frame.
 *
 * It does nothing but pair the two. There is no registration, no lifecycle and no state:
 * `compile` calls the function, and a template that needs to know where it is in a scene
 * reads its context rather than remembering.
 */

export interface TemplateContext {
  /** The format this call is for — one of the manifest's. */
  readonly format: string;

  /**
   * What that format measures, from the project's `formats.yaml`.
   *
   * A template states its layout, not its canvas: two templates that each wrote their own
   * 1080×1920 would eventually disagree about what `story` is, and `%` and `vw/vh` are
   * relative to this number. Pass it to `frame({ size })`.
   */
  readonly size: Size;

  /**
   * Unique per (artwork, format). **Pass it to `frame({ idPrefix })`.**
   *
   * Node ids are derived from position, so two artworks with a `feed` frame each would
   * both generate `feed.0` and the scene would fail `E_SCENE_DUPLICATE_ID`. So would the
   * two formats of one artwork, which is why this carries both and not just the artwork.
   */
  readonly idPrefix: string;

  readonly artwork: {
    readonly id: string;
    /** Zero-based, in the order the brief wrote the repeat slot. */
    readonly index: number;
    /** How many artworks the brief produced, for a template that numbers its slides. */
    readonly count: number;
  };

  /**
   * Every slot the brief gave a value, by name, with the repeatable one already resolved
   * to this artwork's occurrence — a template reads `slots.slide` and gets this slide.
   */
  readonly slots: Readonly<Record<string, ResolvedSlot>>;

  /**
   * The adjustments written on this artwork's repeatable slot, flattened: `true` for a
   * flag, the value for an enum. `{destaque}` is `adjustments.destaque === true`.
   * Adjustments on any other slot are on that slot, in `slots`.
   */
  readonly adjustments: Readonly<Record<string, string | true>>;

  /**
   * How big `node` will come out once it is laid out — asked before it is placed (ADR 0038).
   *
   * The same `measureText` that `compile` runs on the frame afterwards, against the same
   * faces, so a box sized from this answer holds exactly the lines that are then drawn in
   * it. Measure the node as it will be placed: its `box.w` decides where the lines break,
   * its `overflow` whether it shrinks.
   *
   * **`undefined` means unmeasurable, never zero** — no font cache was wired into this
   * compile, or a run's face is not one anybody supplied. A measurement of an empty node is
   * a real answer with `height: 0`. A template that falls back to a guess on `undefined`
   * does so knowingly, and should expect the exporter's own layout to differ from it.
   */
  readonly measure: (node: MeasurableText) => TextMeasurement | undefined;
}

/**
 * The `measure` of a context that has no faces to measure against.
 *
 * For a compile with no font cache and for a context built by hand in a test: it answers
 * `undefined` for every node, which is the honest answer rather than a guessed height.
 */
export const measureNothing: TemplateContext['measure'] = () => undefined;

export type TemplateBuild = (context: TemplateContext) => Frame;

export interface Template {
  readonly manifest: TemplateManifest;
  readonly build: TemplateBuild;
}

export function defineTemplate(manifest: TemplateManifest, build: TemplateBuild): Template {
  return { manifest, build };
}
