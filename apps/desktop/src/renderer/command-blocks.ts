import type { CommandsOrder } from '../../shared/command-runs.js';
import type { OutputLine } from './command-output.js';
import type { CommandRun, CommandSession } from './command-sessions.js';
import { joinCommandLine, splitCommandLine } from './command-words.js';

/**
 * The command panel's scrollback as blocks, one per run (TYTO-496): a header that says the
 * command, when it started and how it ended, over what the run printed. Rafael found the runs
 * hard to follow stacked as plain lines, and chose on 2026-10-30 to have the order and the
 * folding of older runs as settings (`commandsOrder`, `commandsFoldOlderRuns`).
 */

export interface RunBlock {
  readonly run: CommandRun;
  /** Its lines, each with its place in the scrollback, which find's matches are counted by. */
  readonly lines: readonly { readonly line: OutputLine; readonly index: number }[];
}

/** The session's runs with their lines, in the order the setting asks for. */
export function blocksOf(session: CommandSession, order: CommandsOrder): readonly RunBlock[] {
  const byRun = new Map<number, { line: OutputLine; index: number }[]>();
  session.scrollback.lines.forEach((line, index) => {
    if (line.run === undefined) return;
    byRun.set(line.run, [...(byRun.get(line.run) ?? []), { line, index }]);
  });
  return inRunOrder(
    session.runs.map((run) => ({ run, lines: byRun.get(run.number) ?? [] })),
    order,
  );
}

const isPath = (word: string): boolean => /[\\/]/u.test(word) && !/^--?[\w-]+=/u.test(word);

/**
 * The command as a header shows it: each path cut to its file name, so the first thing a run
 * says is what it did and not where a folder is. The whole line is the header's tooltip.
 */
export function shortCommand(line: string): string {
  const split = splitCommandLine(line);
  if (!split.ok) return line;
  return joinCommandLine(
    split.words.map((word) =>
      isPath(word)
        ? (word
            .split(/[\\/]+/u)
            .filter(Boolean)
            .at(-1) ?? word)
        : word,
    ),
  );
}

/** Things in a run's order — blocks, Problems' sections — as `commandsOrder` asks. */
export const inRunOrder = <T>(items: readonly T[], order: CommandsOrder): readonly T[] =>
  order === 'newestFirst' ? [...items].reverse() : items;

/**
 * A command's Problems section title, as its run's header says it: the command with its paths
 * cut to file names, when it started, and how it ended (`ended` is the words for that).
 */
export const sectionTitle = (run: CommandRun, locale: string, ended: string): string =>
  `${shortCommand(run.line)} · ${startTime(run, locale)} · ${ended}`;

/** When a run started, as hours and minutes in the window's language. */
export const startTime = (run: CommandRun, locale: string): string =>
  new Date(run.startedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/**
 * Whether a block is drawn folded to its header: with the setting on, every run but the newest,
 * unless a person opened it, or find has a match in it — a match in a folded block would be
 * counted and never seen.
 */
export function isFolded(
  block: RunBlock,
  newest: number | undefined,
  fold: boolean,
  opened: ReadonlySet<number>,
  matchedLines: ReadonlySet<number>,
): boolean {
  if (!fold || block.run.number === newest || opened.has(block.run.number)) return false;
  return !block.lines.some(({ index }) => matchedLines.has(index));
}
