/**
 * Source locations for diagnostics.
 *
 * A location is a pair of UTF-16 code-unit offsets, because that is what Lezer produces
 * and what CodeMirror consumes: keeping the same unit end to end means a diagnostic can
 * travel from the parser to the editor gutter without a single conversion. Line and
 * column are derived on demand — they cost a scan of the source, and only the CLI and
 * the editor ever need them.
 */

/** Half-open `[start, end)` span of source text. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/** One-based, the way editors and compilers report positions to humans. */
export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

export interface LineColumnRange {
  readonly start: LineColumn;
  readonly end: LineColumn;
}

/**
 * Rejects impossible spans by throwing rather than by returning a `Result`: a negative or
 * inverted range is a bug in the caller, not a malformed brief, and the repo reserves
 * `Result` for errors a user can cause.
 */
export function sourceRange(start: number, end: number): SourceRange {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new TypeError(`Range offsets must be integers, received (${start}, ${end}).`);
  }
  if (start < 0) {
    throw new RangeError(`Range start must not be negative, received ${start}.`);
  }
  if (end < start) {
    throw new RangeError(`Range end ${end} must not precede start ${start}.`);
  }
  return { start, end };
}

export function emptyRangeAt(offset: number): SourceRange {
  return sourceRange(offset, offset);
}

export function isEmptyRange(range: SourceRange): boolean {
  return range.start === range.end;
}

export function rangeLength(range: SourceRange): number {
  return range.end - range.start;
}

/** An empty range contains exactly its own offset, so a caret diagnostic can be located. */
export function rangeContains(range: SourceRange, offset: number): boolean {
  if (isEmptyRange(range)) return offset === range.start;
  return offset >= range.start && offset < range.end;
}

export function rangeContainsRange(outer: SourceRange, inner: SourceRange): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

export function rangesIntersect(a: SourceRange, b: SourceRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Smallest range covering both, including the gap between them. */
export function unionRanges(a: SourceRange, b: SourceRange): SourceRange {
  return sourceRange(Math.min(a.start, b.start), Math.max(a.end, b.end));
}

/** Orders by start, then by end, so diagnostics sort the way a reader scans a file. */
export function compareRanges(a: SourceRange, b: SourceRange): number {
  return a.start - b.start || a.end - b.end;
}

export function sliceRange(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end);
}

/**
 * Offsets of the first character of each line.
 *
 * Formatting a run of diagnostics is the common case, and scanning the source once per
 * diagnostic would be quadratic; the index is built once and searched in log time.
 */
export interface LineIndex {
  readonly lineStarts: readonly number[];
  readonly length: number;
}

export function createLineIndex(text: string): LineIndex {
  const lineStarts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    const char = text[offset];
    if (char === '\n') {
      lineStarts.push(offset + 1);
    } else if (char === '\r') {
      // A lone \r ends a line too; \r\n must not count twice.
      if (text[offset + 1] === '\n') offset += 1;
      lineStarts.push(offset + 1);
    }
  }
  return { lineStarts, length: text.length };
}

function lineIndexOf(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const start = lineStarts[middle];
    if (start === undefined || start > offset) {
      high = middle - 1;
    } else {
      low = middle;
    }
  }
  return low;
}

/** Offsets past the end clamp to the last position, so a truncated file still reports. */
export function lineColumnAtIndex(index: LineIndex, offset: number): LineColumn {
  const clamped = Math.max(0, Math.min(offset, index.length));
  const line = lineIndexOf(index.lineStarts, clamped);
  const lineStart = index.lineStarts[line] ?? 0;
  return { line: line + 1, column: clamped - lineStart + 1 };
}

export function lineColumnAt(text: string, offset: number): LineColumn {
  return lineColumnAtIndex(createLineIndex(text), offset);
}

export function lineColumnRangeAtIndex(index: LineIndex, range: SourceRange): LineColumnRange {
  return {
    start: lineColumnAtIndex(index, range.start),
    end: lineColumnAtIndex(index, range.end),
  };
}

export function lineColumnRange(text: string, range: SourceRange): LineColumnRange {
  return lineColumnRangeAtIndex(createLineIndex(text), range);
}
