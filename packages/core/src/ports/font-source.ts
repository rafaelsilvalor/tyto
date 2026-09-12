/**
 * Font bytes, as the measurement stage is allowed to see them.
 *
 * `core` is pure (ADR 0010) and opens no files, and measuring a laid-out string needs the
 * outlines of a real face. So whoever loaded the scene answers this, the same way
 * {@link AssetResolver} answers for images — and for the same reason: a font on a disk, in
 * a bucket or inside an Electron asar is a question about a runtime, not about a brief.
 *
 * ## Outlines, not the web font
 *
 * This asks for the `.ttf`/`.otf`, not the `.woff2` the exporters embed. They are two
 * encodings of one design and a measurement has to be taken from the same one that gets
 * drawn, which is why `fonts/README.md` requires both to come from a single upstream
 * release. Handing a WOFF2 here would also drag a Brotli decoder into a pure package for
 * no gain.
 *
 * Synchronous, because `compile` is. A scene is measured while it is being built and
 * nothing in that path can await.
 */

/** A face, in the vocabulary the IR uses for one: a family and the two style axes. */
export interface FontFace {
  readonly family: string;
  /** CSS weights, 100..900. */
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

export interface FontSource {
  /**
   * The face's outline bytes, or `undefined` when nothing supplies it.
   *
   * Absence is a value, not a rejection, and it is not an error either: a scene whose font
   * nobody can measure is laid out from the lines the brief wrote, exactly as it was
   * before anything measured anything. The exporters still report the missing face when
   * they cannot embed it (`E_EXPORT_FONT_UNRESOLVED`), which is where an author needs to
   * hear about it — a compile that refused would take the whole artwork down over a
   * measurement it only wanted in order to improve the line breaks.
   */
  outlines(face: FontFace): Uint8Array | undefined;
}
