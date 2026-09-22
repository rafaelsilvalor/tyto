/**
 * `@tyto/template-kit` — what a template written in TypeScript composes with.
 *
 * ADR 0005 gave a template two routes, and this one is code: `defineTemplate` pairs a
 * manifest with a function, and `compile` calls that function once per (artwork, format).
 * `@tyto/core/template` supplies the six node builders; this package supplies the layer
 * above them, which the SDK deliberately does not — arrangement.
 *
 * ## The three layers, and where each one lives
 *
 * `docs/template-conventions.md` is the long form. In short:
 *
 * 1. **Tokens** — colours, type scale, spacing, flat geometry. Exported constants with no
 *    logic. **They do not live here**, because they belong to a brand rather than to a
 *    mechanism: a palette shared by two Estratégia templates is a module beside those
 *    templates, and a kit that shipped one would be deciding somebody else's brand.
 * 2. **Parts** — functions returning a `NodeDraft`: a pill, a row of a listing. Also not
 *    here, for the same reason, and shared between templates by import.
 * 3. **Arrangement** — {@link stack}, {@link row}, {@link inset}, {@link at}. This is the
 *    only layer that is the same whatever is being drawn, so it is the only one this
 *    package owns.
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
