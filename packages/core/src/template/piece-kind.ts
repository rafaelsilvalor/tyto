import type { FormatCatalogue, FormatKind } from '../config/formats.js';
import type { TemplateManifest } from './manifest.js';

/**
 * What kind of piece a template makes, per format it declares (TYTO-194,
 * `docs/format-kinds.md`).
 *
 * **Derived, never declared.** A piece kind is two facts that already have a home: the canvas,
 * which is the format's `kind` in `formats.yaml`, and whether the template runs across several
 * artworks, which is whether its manifest has a repeatable slot. A `grid` that repeats is a
 * `carrossel`, a `story` that repeats is `stories`. A field on the manifest saying so could only
 * disagree with the manifest it sits in.
 *
 * A template that *can* repeat is a sequence even when one brief writes a single occurrence:
 * this answers what the template makes, before any brief is read.
 */
export type PieceKind = FormatKind | 'carrossel' | 'stories';

export interface TemplatePiece {
  readonly format: string;
  /** Absent when the format declares no `kind` — a project's `formats.yaml` may not say. */
  readonly kind?: PieceKind;
  /** Whether the template runs across several artworks. */
  readonly sequence: boolean;
}

/** The sequence of a canvas kind, for the two kinds that have a name for one. */
const SEQUENCE_OF: Partial<Record<FormatKind, PieceKind>> = {
  grid: 'carrossel',
  story: 'stories',
};

/** One entry per format the manifest declares, in the manifest's order. */
export function pieceKinds(
  manifest: Pick<TemplateManifest, 'formats' | 'slots'>,
  catalogue: Pick<FormatCatalogue, 'kindOf'>,
): TemplatePiece[] {
  const sequence = Object.values(manifest.slots).some((slot) => slot.repeat);

  return manifest.formats.map((format) => {
    const canvas = catalogue.kindOf(format);
    if (canvas === undefined) return { format, sequence };

    // A kind with no sequence name (a banner, say) is still its canvas kind, and `sequence`
    // says it repeats: nobody has named a carousel of banners yet.
    const kind = sequence ? (SEQUENCE_OF[canvas] ?? canvas) : canvas;
    return { format, kind, sequence };
  });
}
