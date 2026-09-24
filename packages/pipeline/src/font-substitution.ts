import { type Diagnostics, diagnostic } from '@tyto/core';

/** A face in the three fields a font label names. */
interface Face {
  readonly family: string;
  readonly weight: number;
  readonly style: string;
}

/**
 * `W_FONT_SUBSTITUTED` for each face a font library drew in something else (ADR 0037).
 *
 * Here rather than in `@tyto/fonts`, which describes bytes on a disk and stays free of the
 * compiler (ADR 0021), and rather than in each app: the CLI's job and the desktop preview
 * both report it, and two copies of one sentence is how two surfaces come to disagree. The
 * input is typed structurally so that `FontLibrary.substitutions()` passes straight in.
 *
 * The label is the one `E_EXPORT_FONT_UNRESOLVED` uses — family, weight, style — so a
 * reader who has seen one recognises the other.
 */
export function fontSubstitutionWarnings(
  substitutions: readonly { readonly requested: Face; readonly drawn: Face }[],
): Diagnostics {
  const label = (face: Face): string => `${face.family} ${String(face.weight)} ${face.style}`;
  return substitutions.map((item) =>
    diagnostic('W_FONT_SUBSTITUTED', {
      font: label(item.requested),
      substitute: label(item.drawn),
    }),
  );
}
