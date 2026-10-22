import { type Diagnostics, diagnostic } from '@tyto/core';

import { googleFamily } from './catalogue.js';

/** A face in the three fields a font label names. */
interface Face {
  readonly family: string;
  readonly weight: number;
  readonly style: string;
}

/** What a font library drew, and in what: `FontLibrary.substitutions()` passes straight in. */
export interface Substitution {
  readonly requested: Face;
  readonly drawn: Face;
}

/** The alternatives a template's manifest names for a family (`manifest.fonts`). */
export type AlternativesOf = (family: string) => readonly string[] | undefined;

/** The label `W_FONT_SUBSTITUTED` uses — family, weight, style — so one reads like the other. */
const label = (face: Face): string => `${face.family} ${String(face.weight)} ${face.style}`;

/**
 * What a missing face says when Google Fonts is on (ADR 0120): **one line per face**.
 *
 * A family nobody can supply — not Google, not another plugin's `font-source` — is
 * `W_FONT_UNAVAILABLE`, which takes the place of `W_FONT_SUBSTITUTED` and still names the
 * substitute, so ADR 0037's fallback and its warning stay one sentence. A family some source
 * serves keeps `W_FONT_SUBSTITUTED`: when it is still missing here its fetch failed or was not
 * allowed, and `W_FONT_SOURCE_FAILED` beside it says why — calling it licensed would be false.
 * With Google Fonts off, the app calls `fontSubstitutionWarnings` instead, exactly as before
 * this package existed.
 */
export function googleFontWarnings(
  substitutions: readonly Substitution[],
  alternativesOf: AlternativesOf = () => undefined,
  /** Whether another plugin's `font-source` declares the family. */
  servedElsewhere: (family: string) => boolean = () => false,
): Diagnostics {
  return substitutions.map(({ requested, drawn }) => {
    const params = { font: label(requested), substitute: label(drawn) };
    if (googleFamily(requested.family) !== undefined || servedElsewhere(requested.family)) {
      return diagnostic('W_FONT_SUBSTITUTED', params);
    }
    const named = alternativesOf(requested.family) ?? [];
    return diagnostic('W_FONT_UNAVAILABLE', {
      ...params,
      family: requested.family,
      alternatives: named.length === 0 ? '' : ` Free fonts of the same kind: ${named.join(', ')}.`,
    });
  });
}
