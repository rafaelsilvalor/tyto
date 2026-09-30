import type { TemplateManifest } from './manifest.js';
import type { ResolvedSlot } from '../brief/resolve.js';
import type { Size } from '../scene/primitives.js';
import type { Diagnostics, Result } from '../result/result.js';
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

  /**
   * Tells the author something about this frame without failing it (ADR 0058).
   *
   * A template returns a frame and nothing else, so before this there was no way for one
   * to say "the slide you wrote does not fit the grid" — it drew what fitted and the rest
   * was cut in silence. A report is a warning from the diagnostic catalog: the template
   * names the code and its own numbers, and `compile` supplies the artwork, the format and
   * the source range of the directive the artwork came from. Severity and wording stay in
   * the catalog, where every other diagnostic keeps them.
   */
  readonly report: (report: TemplateReport) => void;
}

/**
 * What a template may report, as a closed list (ADR 0058).
 *
 * Closed on purpose: an installed template runs in its plugin's process and its reports
 * cross back as data, and a list the host checks is what keeps a plugin from writing an
 * arbitrary diagnostic — an error, say, or somebody else's code — into the author's run.
 */
export type TemplateReport = {
  /** The content runs past the room the template has for it; `overflow` is in px. */
  readonly code: 'W_TEMPLATE_OVERFLOW';
  readonly overflow: number;
};

/** Every code a template may report, for the checks that cannot read a type. */
export const templateReportCodes = ['W_TEMPLATE_OVERFLOW'] as const;

/**
 * The `measure` of a context that has no faces to measure against.
 *
 * For a compile with no font cache and for a context built by hand in a test: it answers
 * `undefined` for every node, which is the honest answer rather than a guessed height.
 */
export const measureNothing: TemplateContext['measure'] = () => undefined;

/** The `report` of a context built by hand, in a test or a preview: it keeps nothing. */
export const reportNothing: TemplateContext['report'] = () => undefined;

export type TemplateBuild = (context: TemplateContext) => Frame;

export interface Template {
  readonly manifest: TemplateManifest;
  readonly build: TemplateBuild;
}

export function defineTemplate(manifest: TemplateManifest, build: TemplateBuild): Template {
  return { manifest, build };
}

/**
 * What crosses to a template that runs in another process: its context without `measure`
 * and `report`, which are functions and cannot be cloned (ADR 0048). The other end rebuilds
 * `measure` over the faces that crossed with the call, with the same `measureText`, and
 * `report` as a list that crosses back beside the frame (ADR 0058).
 */
export type TemplateCall = Omit<TemplateContext, 'measure' | 'report'>;

/** What an installed template's build answers across the boundary: its frame and reports. */
export interface TemplateAnswer {
  readonly frame: Frame;
  /** Always a list, never absent: an answer crosses as JSON, where `undefined` is lost. */
  readonly reports: readonly TemplateReport[];
}

/**
 * A template whose frame is answered later — an installed code template, running in its
 * plugin's process (ADR 0048).
 *
 * Not a `Template` with a wider return type. A `Template` is called by `compile` inside its
 * loop, and every template in this repository answers there and then; widening `build`
 * would make every caller await what none of them waits for. A different field name keeps
 * the two apart in the types, so a deferred template cannot reach `compile` by mistake,
 * and `compileDeferred` is the one path that awaits.
 *
 * It answers with diagnostics rather than a throw, because what goes wrong on the far side
 * of a process boundary — a timeout, a crash, an answer the IR schema refuses — is already
 * a value by the time it arrives here.
 */
export interface DeferredTemplate {
  readonly manifest: TemplateManifest;
  readonly buildLater: (context: TemplateContext) => Promise<Result<Frame, Diagnostics>>;
}

export function isDeferredTemplate(
  template: Template | DeferredTemplate,
): template is DeferredTemplate {
  return 'buildLater' in template;
}
