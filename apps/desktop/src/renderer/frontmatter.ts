/**
 * Changing which template a brief uses, as the smallest edit that does it (E9.3).
 *
 * The picker's job is one line of YAML, and the obvious implementation — build the new
 * document and call `setValue` — is wrong in three ways at once. It loses the cursor, it
 * empties the undo history, and `setValue` deliberately does not notify `onChange`, so the
 * preview would not refresh until the next keystroke. What comes back from here is a range
 * and a replacement, which the caller dispatches as an ordinary edit: the cursor stays,
 * Ctrl+Z puts the old template back, and the preview updates through the same path typing
 * uses.
 *
 * A text edit and not a YAML round trip, for the reason the grammar gives (ADR 0004,
 * `docs/brief-language.md`): the frontmatter is taken whole and its YAML is left alone.
 * Parsing and re-emitting it would reformat a block the author wrote — reordering keys,
 * dropping comments, changing quoting — to change one word.
 */

/** What `template:` must be replaced with, in offsets into the brief as it stands. */
export interface TemplateEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

const FENCE = /^---[ \t]*$/u;
const TEMPLATE_KEY = /^([ \t]*template[ \t]*:[ \t]*)(.*)$/u;

interface Line {
  /** Without its line ending. */
  readonly text: string;
  readonly start: number;
  /** The offset just past `text`, before any line ending. */
  readonly end: number;
}

/**
 * The document as lines, keeping every offset the caller's.
 *
 * Not `split('\n')`: a brief may use any of the three endings, sometimes within one file
 * (`docs/brief-language.md`), and an offset computed against a normalised copy would point
 * at the wrong character in the buffer the editor is holding.
 */
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  for (const match of text.matchAll(/\r\n|\n|\r/gu)) {
    lines.push({ text: text.slice(start, match.index), start, end: match.index });
    start = match.index + match[0].length;
  }
  lines.push({ text: text.slice(start), start, end: text.length });

  return lines;
}

/** The ending the document already uses, so an inserted line does not introduce a second. */
function lineEndingOf(text: string): string {
  return /\r\n/u.test(text) ? '\r\n' : /\r(?!\n)/u.test(text) ? '\r' : '\n';
}

/**
 * The lines the frontmatter's fences enclose, or `undefined` when there is no frontmatter.
 *
 * The opening fence must be the first line: that is what the grammar requires, and a `---`
 * further down is a horizontal rule in somebody's prose. A block that is never closed is
 * not frontmatter either — the grammar reports every line of it — so this reports none.
 */
function frontmatterOf(lines: readonly Line[]): { open: Line; close: Line } | undefined {
  const open = lines[0];
  if (open === undefined || !FENCE.test(open.text)) return undefined;

  const close = lines.slice(1).find((line) => FENCE.test(line.text));
  return close === undefined ? undefined : { open, close };
}

/**
 * The edit that makes `brief` use `template`, or nothing when it already does.
 *
 * Three shapes, in the order they are met: the key is there and gets a new value; the
 * frontmatter is there without the key and gains a line; there is no frontmatter and the
 * brief gains one. The third is what a brief being written from scratch looks like, which
 * is the first thing the picker is used on.
 */
export function planTemplateEdit(brief: string, template: string): TemplateEdit | undefined {
  const lines = linesOf(brief);
  const ending = lineEndingOf(brief);
  const block = frontmatterOf(lines);

  if (block === undefined) {
    // The closing fence ends its own line, so whatever the brief already said starts on the
    // next one with nothing between. A blank line here would be one the author has to
    // delete, in the case the picker is most used: a brief being written from scratch.
    return { from: 0, to: 0, insert: `---${ending}template: ${template}${ending}---${ending}` };
  }

  for (const line of lines) {
    if (line.start <= block.open.start || line.start >= block.close.start) continue;
    const key = TEMPLATE_KEY.exec(line.text);
    if (key === null) continue;

    // Only the value is replaced, so whatever indentation and spacing the author used
    // around the colon survives a change of template.
    const prefix = key[1] ?? '';
    const current = (key[2] ?? '').trim();
    if (current === template) return undefined;
    return { from: line.start + prefix.length, to: line.end, insert: template };
  }

  // A frontmatter with no `template:` — the CLI's `--template` covers that case and the
  // desktop has no flag, so the key is added rather than assumed. Directly under the
  // opening fence, because a reader looks for it first and YAML does not care.
  const at =
    block.open.end + (brief.slice(block.open.end).match(/^(?:\r\n|\n|\r)/u)?.[0].length ?? 0);
  return { from: at, to: at, insert: `template: ${template}${ending}` };
}

/** The template a brief names right now, for a picker that has to show the current one. */
export function templateOf(brief: string): string | undefined {
  const lines = linesOf(brief);
  const block = frontmatterOf(lines);
  if (block === undefined) return undefined;

  for (const line of lines) {
    if (line.start <= block.open.start || line.start >= block.close.start) continue;
    const key = TEMPLATE_KEY.exec(line.text);
    if (key === null) continue;
    const value = (key[2] ?? '').trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}
