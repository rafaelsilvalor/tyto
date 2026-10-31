import { type AnsiRun, type AnsiState, type AnsiStyle, readAnsi } from './ansi.js';
import type { LinkSpan, OutputLink } from './command-links.js';

/**
 * A session's scrollback as lines (TYTO-496): what a command printed, read into styled runs,
 * plus the panel's own lines — the command echoed, how it ended, a refusal — which are
 * `note`s and never the command's text.
 */

export type OutputStream = 'out' | 'err' | 'note';

export interface OutputLine {
  readonly stream: OutputStream;
  readonly runs: readonly AnsiRun[];
}

export interface Scrollback {
  readonly lines: readonly OutputLine[];
  /** Whether the last line is still open: the command printed no line break after it yet. */
  readonly open: boolean;
  /** Lines let go from the top to stay under {@link SCROLLBACK_LIMIT}. */
  readonly dropped: number;
}

/**
 * The most lines a session keeps. A `watch` left running prints for hours, and a window that
 * kept every line would grow main's memory's twin in the renderer; a terminal keeps a few
 * thousand for the same reason.
 */
export const SCROLLBACK_LIMIT = 3000;

export const EMPTY_SCROLLBACK: Scrollback = { lines: [], open: false, dropped: 0 };

const textOf = (runs: readonly AnsiRun[]): string => runs.map((run) => run.text).join('');

export const lineText = (line: OutputLine): string => textOf(line.runs);

function capped(lines: OutputLine[], open: boolean, dropped: number): Scrollback {
  const over = lines.length - SCROLLBACK_LIMIT;
  return over > 0
    ? { lines: lines.slice(over), open, dropped: dropped + over }
    : { lines, open, dropped };
}

/**
 * The scrollback after a command printed `chunk` on `stream`. A line break ends a line; a
 * carriage return alone starts the line over, the way a progress counter redraws itself.
 */
export function withOutput(
  scrollback: Scrollback,
  stream: 'out' | 'err',
  chunk: string,
  ansi: AnsiState,
): Scrollback {
  const lines = [...scrollback.lines];
  let open = scrollback.open && lines.at(-1)?.stream === stream;
  const pieces = chunk.replaceAll('\r\n', '\n').split('\n');

  pieces.forEach((piece, index) => {
    const isLast = index === pieces.length - 1;
    const redrawn = piece.lastIndexOf('\r');
    const restart = redrawn !== -1;
    const runs = readAnsi(ansi, restart ? piece.slice(redrawn + 1) : piece);
    const last = lines.at(-1);
    const continued = open && last !== undefined;
    if (continued) {
      lines[lines.length - 1] = { stream, runs: restart ? runs : [...last.runs, ...runs] };
    } else if (!isLast || piece !== '') {
      lines.push({ stream, runs });
    }
    // Every piece but the last ended at a line break. The last leaves its line open if it
    // printed something, or if it continued a line that was already open.
    open = isLast && (piece !== '' || continued);
  });

  return capped(lines, open, scrollback.dropped);
}

const PLAIN: AnsiStyle = {};

/** The scrollback with one of the panel's own lines added, on a line of its own. */
export function withNote(scrollback: Scrollback, text: string): Scrollback {
  return capped(
    [...scrollback.lines, { stream: 'note', runs: [{ text, style: PLAIN }] }],
    false,
    scrollback.dropped,
  );
}

/** Everything in the scrollback as text, one line per line: what Copy copies. */
export const scrollbackText = (scrollback: Scrollback): string =>
  scrollback.lines.map(lineText).join('\n');

/** Where a find query matches in each line, as offsets; ignoring case. */
export interface FindMatch {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

export function findMatches(scrollback: Scrollback, query: string): readonly FindMatch[] {
  if (query === '') return [];
  const wanted = query.toLowerCase();
  const matches: FindMatch[] = [];
  scrollback.lines.forEach((line, index) => {
    const text = lineText(line).toLowerCase();
    let from = text.indexOf(wanted);
    while (from !== -1) {
      matches.push({ line: index, start: from, end: from + wanted.length });
      from = text.indexOf(wanted, from + wanted.length);
    }
  });
  return matches;
}

/** A piece of a line drawn as one element: a style, and a link or a find match if any. */
export interface Piece {
  readonly text: string;
  readonly style: AnsiStyle;
  readonly link?: OutputLink;
  /** The match's place among all of the scrollback's, for marking the current one. */
  readonly match?: number;
}

/**
 * A line cut into pieces at every boundary of a style run, a link and a find match, so each
 * piece is drawn with all three. `matches` are this line's, with their index among all.
 */
export function piecesOf(
  runs: readonly AnsiRun[],
  links: readonly LinkSpan[],
  matches: readonly { readonly start: number; readonly end: number; readonly index: number }[],
): readonly Piece[] {
  const cuts = new Set<number>();
  let offset = 0;
  for (const run of runs) {
    cuts.add(offset);
    offset += run.text.length;
  }
  cuts.add(offset);
  for (const span of [...links, ...matches]) {
    cuts.add(span.start);
    cuts.add(span.end);
  }
  const sorted = [...cuts].filter((cut) => cut >= 0 && cut <= offset).sort((a, b) => a - b);

  const pieces: Piece[] = [];
  let runIndex = 0;
  let runStart = 0;
  for (let at = 0; at < sorted.length - 1; at += 1) {
    const start = sorted[at] ?? 0;
    const end = sorted[at + 1] ?? 0;
    if (end <= start) continue;
    while (runIndex < runs.length && runStart + (runs[runIndex]?.text.length ?? 0) <= start) {
      runStart += runs[runIndex]?.text.length ?? 0;
      runIndex += 1;
    }
    const run = runs[runIndex];
    if (run === undefined) break;
    const link = links.find((span) => span.start <= start && end <= span.end)?.link;
    const match = matches.find((span) => span.start <= start && end <= span.end)?.index;
    pieces.push({
      text: run.text.slice(start - runStart, end - runStart),
      style: run.style,
      ...(link === undefined ? {} : { link }),
      ...(match === undefined ? {} : { match }),
    });
  }
  return pieces;
}
