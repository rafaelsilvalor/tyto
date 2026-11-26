import type { TemplateContext } from '@tyto/core';

/**
 * A slide's role, flags and enum values, read from the adjustments its `::lamina` wrote
 * (TYTO-552). Four template repositories wrote their own `roleOf` — the first marked role wins,
 * an unmarked slide takes the default — and one walked back past bare continuations to the
 * slide that says what it is (ADR 0203, TYTO-679). That is one function here.
 *
 * Nothing here reports: an enum value the manifest does not list is reported by the compiler
 * at its own place in the brief and never reaches the template, and two role flags written
 * together come back as `conflict` for the template to see (a warning at the flag's own range
 * is the manifest's to declare, TYTO-901).
 */

/** What these readers see of a template's context. */
export type AdjustedContext = Pick<TemplateContext, 'adjustments' | 'artwork' | 'artworks'>;

/** The roles a template's slides may have, how they are written, and how one carries on. */
export interface RoleSpec<Role extends string, Default extends string> {
  /** The role flags, in precedence order: when two are written, the first listed wins. */
  readonly roles: readonly Role[];
  /** The role of a slide that writes none. */
  readonly default: Default;
  /**
   * A slide that writes `flag` and no role carries on from the slides before it: back past
   * other bare continuations to the first one that writes a role. A role in `carries` carries
   * on; any other, or a slide before with neither, gives the default.
   */
  readonly continuation?: { readonly flag: string; readonly carries: readonly Role[] };
}

/** A slide's role, and the role flags written together on it when more than one was. */
export interface SlideRole<Role extends string, Default extends string> {
  readonly role: Role | Default;
  /** Two or more role flags on one slide, in precedence order; `role` is the first. */
  readonly conflict?: readonly Role[];
}

/** Which role this slide has, from its own flags or, as a continuation, from the ones before. */
export function roleOf<Role extends string, Default extends string>(
  context: AdjustedContext,
  spec: RoleSpec<Role, Default>,
): SlideRole<Role, Default> {
  const marked = (adjustments: AdjustedContext['adjustments']): Role[] =>
    spec.roles.filter((role) => adjustments[role] === true);
  const own = marked(context.adjustments);
  const [first] = own;
  if (first !== undefined) return { role: first, ...(own.length > 1 ? { conflict: own } : {}) };

  const continuation = spec.continuation;
  if (continuation === undefined || context.adjustments[continuation.flag] !== true) {
    return { role: spec.default };
  }
  const before = context.artworks?.slice(0, context.artwork.index).reverse() ?? [];
  for (const { adjustments } of before) {
    const [role] = marked(adjustments);
    if (role !== undefined) {
      return { role: continuation.carries.includes(role) ? role : spec.default };
    }
    if (adjustments[continuation.flag] !== true) return { role: spec.default };
  }
  return { role: spec.default };
}

/** Whether this slide writes the flag `name`. */
export function flag(context: Pick<AdjustedContext, 'adjustments'>, name: string): boolean {
  return context.adjustments[name] === true;
}

/**
 * The enum `name`'s value on this slide, typed, or `fallback` when the slide writes none. A value
 * outside `values` cannot arrive from a brief — the compiler reports it against the manifest
 * and drops it — so one here is a template whose `values` disagree with its manifest, and it
 * reads the fallback too.
 */
export function oneOf<Value extends string>(
  context: Pick<AdjustedContext, 'adjustments'>,
  name: string,
  values: readonly Value[],
  fallback: Value,
): Value {
  const written = context.adjustments[name];
  return typeof written === 'string' && (values as readonly string[]).includes(written)
    ? (written as Value)
    : fallback;
}
