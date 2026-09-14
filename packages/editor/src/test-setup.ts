/**
 * jsdom has no layout engine, and CodeMirror asks for one.
 *
 * `Range.prototype.getClientRects` is not implemented there, so every test that renders a
 * lint marker or a selection layer prints a `TypeError` stack to stderr from CodeMirror's
 * measuring pass. It fails nothing — the measurement is decorative in a headless run — and
 * it buries the lines that matter under twenty frames of library internals.
 *
 * An empty list is the honest answer rather than a convenient one: in jsdom there really is
 * no rectangle, and the measuring code already handles a range it cannot measure. Faking a
 * plausible geometry would make a layout-dependent test pass for a reason that does not
 * exist (TYTO-92).
 */
const emptyRectList = (): DOMRectList => {
  const rects: DOMRect[] = [];
  return Object.assign(rects, {
    item: (index: number): DOMRect | null => rects[index] ?? null,
  }) as unknown as DOMRectList;
};

if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = emptyRectList;
}
