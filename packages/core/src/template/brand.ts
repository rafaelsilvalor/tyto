/**
 * A brand's kit: the logo, the wordmark and the signature a template draws for its brand (ADR
 * 0063, ADR 0066).
 *
 * A template names its brand in its manifest (ADR 0052) and decides where they go; what they
 * *are* can come from a plugin, so the art itself does not have to live beside the template. The template reads the kit for its own brand from
 * `context.brand`, and draws whatever it chooses when a field is absent.
 */

/**
 * A mark: a flat, single-colour icon held as geometry — the box its `d` was drawn in, and
 * the `d` itself. **No colour**: the fill is decided where the mark is placed, which is what
 * lets the same mark be dark on paper and white on a dark panel without a second copy
 * (`docs/template-conventions.md`, "Geometry in, colour out").
 *
 * Declared here rather than in `@tyto/template-kit`, which re-exports it as `Mark`, because
 * a brand kit carries one and `TemplateContext` carries the kit. `MarkShape` and not `Mark`
 * here, because `@tyto/core` already exports the brief's `Mark`, an inline span.
 */
export interface MarkShape {
  readonly box: { readonly w: number; readonly h: number };
  readonly d: string;
  /**
   * `evenodd` when the shape has holes punched by inner subpaths.
   *
   * Winding order would do it under `nonzero`, but a hole that depends on the direction a
   * subpath happens to run is a hole that closes the first time somebody redraws it.
   */
  readonly fillRule: 'nonzero' | 'evenodd';
}

/**
 * The tones a toned mark's layers are tagged with (ADR 0066). A tone is a role, not a
 * colour: the template that places the mark decides which colour each tone is drawn in.
 */
export type MarkTone = 'primary' | 'secondary';

/** One layer of a toned mark: a shape and the tone it is drawn in. */
export interface MarkLayer {
  readonly tone: MarkTone;
  readonly d: string;
  readonly fillRule: 'nonzero' | 'evenodd';
}

/**
 * A mark in more than one tone: layers drawn in order, later over earlier, all in the one box
 * (ADR 0066). Still no colour, for the same reason as {@link MarkShape}.
 */
export interface TonedMarkShape {
  readonly box: { readonly w: number; readonly h: number };
  readonly layers: readonly MarkLayer[];
}

/**
 * What a kit's logo and wordmark may be: one shape, read as all `primary`, or toned layers.
 *
 * Both stay accepted so that a one-colour kit written for ADR 0063 keeps working as it was.
 */
export type BrandMark = MarkShape | TonedMarkShape;

/** True when the mark is held as toned layers rather than as one shape. */
export function isTonedMark(mark: BrandMark): mark is TonedMarkShape {
  return 'layers' in mark;
}

/** What a template is handed for its brand. Every field is optional, and absent is normal. */
export interface BrandKit {
  readonly logo?: BrandMark;
  /** The brand's name drawn as a mark, for the layouts that set it beside the logo (ADR 0066). */
  readonly wordmark?: BrandMark;
  readonly signature?: string;
}

/** The kit of a template whose brand nobody supplied one for, or that names no brand. */
export const noBrandKit: BrandKit = Object.freeze({});
