/**
 * The brief a delivery copies into `editaveis/`, with its image paths pointing at the
 * delivery's `assets/` (ADR 0057).
 *
 * **Only the frontmatter is read, and only a top-level value that is exactly a path the
 * brief resolved to an image is changed.** An image slot is always written in the
 * frontmatter (`docs/brief-language.md`), so that is where every path this has to rewrite
 * lives; a comment or a body line that happens to mention the same file name is left alone,
 * because it is prose, not a reference.
 *
 * Line-based on purpose, rather than a YAML round trip: re-serialising the block would
 * reformat every other key the author wrote, and the promise of `editaveis/` is that the
 * brief is the one that produced the artwork. Line endings are kept as they were.
 */

/** One top-level `key: value` line of the frontmatter. */
const ENTRY = /^([A-Za-z_][\w-]*)([ \t]*:[ \t]*)(.*?)([ \t]*)$/u;
const FENCE = /^---[ \t]*$/u;

interface Line {
  readonly text: string;
  readonly ending: string;
}

function linesOf(source: string): Line[] {
  const parts = source.split(/(\r\n|\n|\r)/u);
  const lines: Line[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push({ text: parts[index] ?? '', ending: parts[index + 1] ?? '' });
  }
  return lines;
}

/** The index of the closing fence, or `-1` when the brief has no frontmatter. */
function closingFence(lines: readonly Line[]): number {
  if (!FENCE.test(lines[0]?.text.replace(/^\uFEFF/u, '') ?? '')) return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (FENCE.test(lines[index]?.text ?? '')) return index;
  }
  return -1;
}

/** A scalar as the author wrote it, without the quotes YAML would drop. */
function unquoted(value: string): { readonly text: string; readonly quote: string } {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    return { text: value.slice(1, -1), quote };
  }
  return { text: value, quote: '' };
}

/**
 * `source` with every frontmatter value found in `renames` replaced by its new name, keeping
 * the key, the spacing, the quotes and the line endings the author wrote.
 */
export function rewriteFrontmatterValues(
  source: string,
  renames: ReadonlyMap<string, string>,
): string {
  const lines = linesOf(source);
  const end = closingFence(lines);
  if (end === -1 || renames.size === 0) return source;

  return lines
    .map((line, index) => {
      if (index === 0 || index >= end) return line.text + line.ending;
      const entry = ENTRY.exec(line.text);
      if (entry === null) return line.text + line.ending;
      const [, key, separator, raw, trailing] = entry;
      const value = unquoted(raw ?? '');
      const renamed = renames.get(value.text);
      if (renamed === undefined) return line.text + line.ending;
      return `${key ?? ''}${separator ?? ''}${value.quote}${renamed}${value.quote}${trailing ?? ''}${line.ending}`;
    })
    .join('');
}

/** Every top-level frontmatter value, unquoted — what an earlier delivery's brief pointed at. */
export function frontmatterValues(source: string): string[] {
  const lines = linesOf(source);
  const end = closingFence(lines);
  const values: string[] = [];
  for (let index = 1; index < end; index += 1) {
    const entry = ENTRY.exec(lines[index]?.text ?? '');
    if (entry !== null) values.push(unquoted(entry[3] ?? '').text);
  }
  return values;
}
