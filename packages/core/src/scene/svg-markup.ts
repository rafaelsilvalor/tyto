/**
 * The subset of SVG a `Vector` of kind `svg` may carry, and the one check that enforces it
 * (ADR 0068).
 *
 * Both exporters inline the markup into the document they write, so whatever the file
 * says, it says to the whole artwork. A `<style>` block reaches every node — two icons
 * exported from Illustrator both declare `.cls-1`, and the first repaints the second — and
 * an `id` is a name the next file can declare too, so `url(#gradient)` in one icon can
 * paint with the other's gradient. Past those two, a file can carry script, event handlers
 * and references to the network. None of that has a place in an artwork.
 *
 * So the markup is not sanitised; it is refused unless it is flat geometry: a closed list of
 * shape elements and the presentation attributes that paint them, nothing that names
 * anything and nothing that can be named. Rewriting the file instead — prefixing ids,
 * scoping CSS — would be a second parser per exporter and exactly the disagreement two
 * sinks that sanitise differently produce. A refusal is one function, and the exporters
 * inline what it accepted verbatim.
 *
 * The reader is a tokenizer that has to account for every character. Anything it does not
 * recognise is a refusal, so a construct it never heard of — a DOCTYPE, an entity it does
 * not know, an unquoted value an HTML parser would read differently from an XML one — is
 * refused rather than passed through.
 */

/** Every element the subset admits: shapes, the group that holds them, and two notes. */
const ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'title',
  'desc',
]);

/** The two elements whose text is a note to the reader rather than something drawn. */
const TEXT_ELEMENTS: ReadonlySet<string> = new Set(['title', 'desc']);

/**
 * Geometry and the presentation attributes that paint it.
 *
 * `id`, `class` and `style` are absent on purpose: the first two are names something else
 * can reach, and an inline `style` on the root can position it anywhere on the page.
 */
const ATTRIBUTES: ReadonlySet<string> = new Set([
  'version',
  'baseProfile',
  'viewBox',
  'preserveAspectRatio',
  'xml:space',
  'x',
  'y',
  'width',
  'height',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'pathLength',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'clip-rule',
  'visibility',
  'display',
  'color',
  'shape-rendering',
  'vector-effect',
  'paint-order',
]);

/**
 * What an author does instead, said once so every refusal points the same way.
 *
 * One literal and not a concatenation: the diagnostic catalog reads its placeholders off
 * the template's type, and a concatenated string has type `string`.
 */
export const SVG_MARKUP_WAY_OUT =
  "only flat shapes painted by presentation attributes are inlined: draw it as a contour (a vector of kind 'path'), place it as a PNG, or re-export it from Illustrator with Styling set to Presentation Attributes";

const NAME = /[A-Za-z_:][A-Za-z0-9_:.-]*/y;
const SPACE = /[ \t\r\n]*/y;
const XML_DECLARATION = /<\?xml[^<>?]*\?>/y;
/** XML forbids `--` inside a comment, and refusing it keeps HTML from ending one early. */
const COMMENT = /<!--(?!>|->)((?:[^-<>]|-(?!-))*)-->/y;
const ATTRIBUTE_VALUE = /"([^"]*)"|'([^']*)'/y;
const ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9A-Fa-f]{1,6});/y;

interface Cursor {
  readonly markup: string;
  at: number;
}

function match(cursor: Cursor, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = cursor.at;
  const found = pattern.exec(cursor.markup);
  if (found !== null) cursor.at = pattern.lastIndex;
  return found;
}

function skipSpace(cursor: Cursor): void {
  match(cursor, SPACE);
}

/** The first thing wrong with a run of text or an attribute value, if anything is. */
function textProblem(text: string, where: string): string | undefined {
  if (/[<>]/u.test(text)) return `a '<' or '>' in ${where}`;
  for (let index = text.indexOf('&'); index !== -1; index = text.indexOf('&', index + 1)) {
    ENTITY.lastIndex = index;
    if (ENTITY.exec(text) === null) return `an entity Tyto does not read in ${where}`;
  }
  return undefined;
}

function valueProblem(element: string, name: string, value: string): string | undefined {
  const where = `the attribute '${name}' on <${element}>`;
  const text = textProblem(value, where);
  if (text !== undefined) return text;
  // A paint that points at a gradient or a pattern points at an id, and the subset has none
  // to point at; any other `url()` reaches outside the file.
  if (/url\s*\(/iu.test(value)) return `a url() reference in ${where}`;
  if (/javascript:/iu.test(value)) return `a script URL in ${where}`;
  return undefined;
}

/** Reads one start tag's attributes up to and including `>` or `/>`. */
function readAttributes(
  cursor: Cursor,
  element: string,
): { readonly problem?: string; readonly selfClosing: boolean } {
  for (;;) {
    const before = cursor.at;
    skipSpace(cursor);
    if (cursor.markup.startsWith('/>', cursor.at)) {
      cursor.at += 2;
      return { selfClosing: true };
    }
    if (cursor.markup.startsWith('>', cursor.at)) {
      cursor.at += 1;
      return { selfClosing: false };
    }
    if (cursor.at === before)
      return { problem: `<${element}> without space between its attributes`, selfClosing: false };

    const name = match(cursor, NAME)?.[0];
    if (name === undefined)
      return { problem: `a start tag <${element}> that does not close`, selfClosing: false };

    const namespace = name === 'xmlns' || name.startsWith('xmlns:');
    if (/^on/iu.test(name))
      return { problem: `the event handler '${name}' on <${element}>`, selfClosing: false };
    if (!namespace && !ATTRIBUTES.has(name)) {
      return { problem: `the attribute '${name}' on <${element}>`, selfClosing: false };
    }

    skipSpace(cursor);
    if (cursor.markup[cursor.at] !== '=') {
      return {
        problem: `the attribute '${name}' on <${element}> without a value`,
        selfClosing: false,
      };
    }
    cursor.at += 1;
    skipSpace(cursor);
    const quoted = match(cursor, ATTRIBUTE_VALUE);
    if (quoted === null) {
      return { problem: `an unquoted value for '${name}' on <${element}>`, selfClosing: false };
    }
    const problem = valueProblem(element, name, quoted[1] ?? quoted[2] ?? '');
    if (problem !== undefined) return { problem, selfClosing: false };
  }
}

/**
 * The first construct in `markup` outside the subset, as a phrase an author can act on —
 * "a <style> element", "the attribute 'id' on <path>" — or `undefined` when it all is.
 *
 * The phrase is a noun on purpose: every caller puts it in its own sentence, with its own
 * code, and names the way out with {@link SVG_MARKUP_WAY_OUT}.
 */
export function checkSvgMarkup(markup: string): string | undefined {
  const cursor: Cursor = { markup, at: markup.startsWith('\uFEFF') ? 1 : 0 };
  const open: string[] = [];
  let rootSeen = false;

  skipSpace(cursor);
  match(cursor, XML_DECLARATION);

  while (cursor.at < markup.length) {
    const textStart = cursor.at;
    const nextTag = markup.indexOf('<', cursor.at);
    const textEnd = nextTag === -1 ? markup.length : nextTag;
    const text = markup.slice(textStart, textEnd);
    cursor.at = textEnd;

    if (text.trim() !== '') {
      const parent = open.at(-1);
      if (parent === undefined || !TEXT_ELEMENTS.has(parent)) {
        return parent === undefined
          ? 'text outside the root <svg>'
          : `text inside <${parent}>, which is not a shape`;
      }
      const problem = textProblem(text, `the text of <${parent}>`);
      if (problem !== undefined) return problem;
    }
    if (nextTag === -1) break;

    if (markup.startsWith('<!--', cursor.at)) {
      if (match(cursor, COMMENT) === null) return 'a comment that does not close cleanly';
      continue;
    }
    if (markup.startsWith('<!', cursor.at)) return 'a DOCTYPE or CDATA section';
    if (markup.startsWith('<?', cursor.at)) return 'a processing instruction';

    if (markup.startsWith('</', cursor.at)) {
      cursor.at += 2;
      const name = match(cursor, NAME)?.[0];
      skipSpace(cursor);
      if (name === undefined || markup[cursor.at] !== '>') return 'an end tag that does not close';
      cursor.at += 1;
      if (open.at(-1) !== name) return `an end tag </${name}> that closes nothing open`;
      open.pop();
      continue;
    }

    cursor.at += 1;
    const name = match(cursor, NAME)?.[0];
    if (name === undefined) return "a '<' that starts no tag";
    if (!ELEMENTS.has(name)) return `a <${name}> element`;
    if (open.length === 0 && (rootSeen || name !== 'svg')) {
      return rootSeen ? 'a second root element' : `a root <${name}> where <svg> belongs`;
    }
    if (open.length > 0 && name === 'svg') return 'an <svg> nested inside the file';
    if (open.length > 0 && TEXT_ELEMENTS.has(open.at(-1) ?? '')) {
      return `a <${name}> inside <${open.at(-1) ?? ''}>`;
    }
    rootSeen = true;

    const attributes = readAttributes(cursor, name);
    if (attributes.problem !== undefined) return attributes.problem;
    if (!attributes.selfClosing) open.push(name);
  }

  if (!rootSeen) return 'no root <svg> element';
  if (open.length > 0) return `a <${open.at(-1) ?? ''}> that is never closed`;
  return undefined;
}
