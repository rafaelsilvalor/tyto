/**
 * The three escapes a self-contained document needs.
 *
 * They are separate functions rather than one, because the three grammars disagree about
 * what is dangerous: `&` matters in HTML and nowhere else, `.` matters in a CSS selector
 * and nowhere else, and `"` matters in a `url()` and in HTML but for different reasons.
 * A single "escape" helper would have to be the union of all three, which would encode
 * characters that were fine and make the output unreadable in a snapshot nobody could
 * then review.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text and attribute values. Applied to everything that came from a brief or a slot. */
export function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * A node id as a CSS id selector.
 *
 * Ids in the IR read as paths — `slide-1.feed.copy` — and every one of those dots is a
 * class selector to a CSS parser. Escaping is per character rather than per known
 * offender: an id comes from a template author, and guessing which punctuation they will
 * reach for is how a selector silently stops matching.
 */
export function cssIdSelector(id: string): string {
  const escaped = [...id]
    .map((character, index) => {
      if (/[a-zA-Z_]/u.test(character)) return character;
      if (/[0-9-]/u.test(character)) return index === 0 ? `\\${character}` : character;
      return `\\${character}`;
    })
    .join('');
  return `#${escaped}`;
}

/**
 * An SVG document as the body of a `url()`.
 *
 * Percent-encoded rather than base64: base64 would need an encoder this package cannot
 * borrow (no `Buffer`, no `btoa` — it is pure, ADR 0010) and would turn every mask in a
 * committed snapshot into a wall nobody can diff. Only the five characters that end the
 * `url("…")` or that a browser would read as an escape are touched, so `<svg viewBox=…`
 * still reads as itself.
 */
export function svgDataUri(markup: string): string {
  const encoded = markup
    .replaceAll('%', '%25')
    .replaceAll('"', '%22')
    .replaceAll('#', '%23')
    .replaceAll('\n', '')
    .replaceAll('\r', '');
  return `data:image/svg+xml,${encoded}`;
}
