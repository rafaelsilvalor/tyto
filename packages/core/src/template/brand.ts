/**
 * A brand's kit: the logo and the signature a template draws for its brand (ADR 0063).
 *
 * A template names its brand in its manifest (ADR 0052) and decides where the logo and the
 * signature go; what they *are* can come from a plugin, so the art itself does not have to
 * live beside the template. The template reads the kit for its own brand from
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

/** What a template is handed for its brand. Both fields are optional, and absent is normal. */
export interface BrandKit {
  readonly logo?: MarkShape;
  readonly signature?: string;
}

/** The kit of a template whose brand nobody supplied one for, or that names no brand. */
export const noBrandKit: BrandKit = Object.freeze({});
