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
 * drawn, which is why `@tyto/fonts`'s README requires both to come from a single upstream
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
   * Absence is a value, not a rejection: a scene whose font nobody can measure is still
   * built, and laid out from the lines the brief wrote, exactly as it was before anything
   * measured anything — a compile that refused would take the whole artwork down over a
   * measurement it only wanted in order to improve the line breaks.
   *
   * It is reported, though, and at compile time (ADR 0110): `compile` raises
   * `E_FONT_FACE_UNAVAILABLE`, an error that is not fatal, on the text that asks for the
   * face, because the exporters ask the same question of their own port and will have no
   * bytes either (`E_EXPORT_FONT_UNRESOLVED`). Hearing it at the end of an export is too
   * late for whoever is writing the brief.
   *
   * The two questions are not quite the same one, and where they part the export is still
   * the only one that reports. This port is asked by face, without the `FontRef.source` the
   * exporters see, so it cannot refuse a `file` font as they do; and `@tyto/fonts`' library
   * answers a family it does not ship with the machine's face or a substitute, while the
   * exporters substitute only for a `system` font. What this catches is a family the
   * adapter ships with a face it does not — the italic of ADR 0110's title, before it shipped.
   */
  outlines(face: FontFace): Uint8Array | undefined;
}
