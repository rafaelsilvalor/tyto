import type { OutputLine } from './command-output.js';
import { lineText } from './command-output.js';

/**
 * What a line of the command panel means, which is what it is coloured by (TYTO-725): not the
 * stream it came on. The command line writes more than errors to stderr — the permission
 * question of `plugin install`, the left-out notice of a folder not trusted, warnings among
 * the diagnostics — so a run that ended `✓ 0` showed red lines when stderr was painted red.
 *
 * - `error` and `warning`: a diagnostic as `formatDiagnostics` prints it,
 *   `[path[:line:column]: ]<severity> <CODE> <message>`, on either stream.
 * - `hint`: the indented hint `formatDiagnostics` prints under a diagnostic, and only there; an
 *   indented line anywhere else is `plain`.
 * - `ansi`: a line the command coloured itself. Its colours win, so the line takes none.
 * - `note`: one of the panel's own lines — a built-in's answer, a refusal.
 * - `plain`: everything else, stdout or stderr alike.
 *
 * Whether the run worked is its header's to say (`✓ 0`, `✗ 1`), not every line's.
 */

export type LineTone = 'error' | 'warning' | 'hint' | 'ansi' | 'note' | 'plain';

/** Where a diagnostic's code sits in its line, drawn with weight so it can be read out. */
export interface CodeSpan {
  readonly start: number;
  readonly end: number;
}

export interface LineReading {
  readonly tone: LineTone;
  readonly code?: CodeSpan;
}

/**
 * The severity and code `formatDiagnostics` writes, after an optional place ending in `: `.
 * The place is lazy so the first `<severity> <CODE>` is the one read; a Windows path's drive
 * colon is followed by a backslash, never a space, so it cannot end the place early.
 */
const DIAGNOSTIC = /^(?:.*?: )?(error|warning) ([EW]_[A-Z0-9_]+)(?= |$)/u;

/** The hint's indent: four spaces, as `formatDiagnostics` writes it. */
const HINT_INDENT = '    ';

/** Colours the command chose: a foreground, a background, or the two swapped. */
const isColoured = (line: OutputLine): boolean =>
  line.runs.some(
    (run) =>
      run.text !== '' &&
      (run.style.foreground !== undefined ||
        run.style.background !== undefined ||
        run.style.inverse === true),
  );

/** What `line` means, given what the line before it in the same run meant. */
export function readLine(line: OutputLine, previous?: LineReading): LineReading {
  if (line.stream === 'note') return { tone: 'note' };
  if (isColoured(line)) return { tone: 'ansi' };
  const text = lineText(line);
  const diagnostic = DIAGNOSTIC.exec(text);
  if (diagnostic !== null) {
    const severity = diagnostic[1] === 'error' ? 'error' : 'warning';
    const code = diagnostic[2] ?? '';
    const end = diagnostic[0].length;
    return { tone: severity, code: { start: end - code.length, end } };
  }
  const followsDiagnostic =
    previous !== undefined &&
    (previous.tone === 'error' || previous.tone === 'warning' || previous.tone === 'hint');
  if (followsDiagnostic && text.startsWith(HINT_INDENT) && text.trim() !== '') {
    return { tone: 'hint' };
  }
  return { tone: 'plain' };
}

/** Every line of one run read in order, each with the one before it. */
export function readLines(lines: readonly OutputLine[]): readonly LineReading[] {
  const readings: LineReading[] = [];
  for (const line of lines) readings.push(readLine(line, readings.at(-1)));
  return readings;
}
