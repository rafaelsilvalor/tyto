import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from '@tyto/plugin-api';

/**
 * What the app wrote down when something broke, in a file a beta tester can hand over.
 *
 * Before this the desktop wrote **nothing**: a render that threw, a preview that never
 * answered and a save that failed each left the process with no record at all, so a report
 * could only ever be somebody's memory of what they had been doing. The problems panel is a
 * different instrument — it is about the *document*, and this is about the *program*.
 *
 * **Local file, and no ADR was needed to say so.** ADR 0011 keeps Tyto ignorant of Jira,
 * Drive, OAuth and machine identity, and nothing in `docs/adr/` permits this app to send
 * anything anywhere — measured rather than assumed: `apps/desktop` declares twelve
 * dependencies and none of them can open a socket, and every adapter in `packages/io` is
 * `node:fs`. So "does not phone home" is not a switch somebody turned off, it is a capability
 * the codebase does not contain. The file goes where this app already puts things a person
 * may read and delete (ADR 0009), beside `layout.json`, the recent list and the credential
 * store.
 *
 * **In its own `logs/` subfolder, and that is not tidiness.** The card asks for a menu item
 * that opens the folder, so whatever folder opens is the folder a tester is invited to
 * screenshot and send. `userData` itself holds `credentials` and `recent-files.json` — every
 * path that person has ever opened. `logs/` is the only folder in this app that is safe to
 * hand over whole.
 *
 * **Writes are synchronous, and that is the one performance decision here.** A line written
 * from an `uncaughtException` handler has to reach the disk before the process can die, and
 * an awaited write cannot promise that. `layout-store.ts` and `recent-files.ts` are async
 * because losing a splitter position costs nothing; losing the line that explains a crash
 * costs the only thing this file is for. That trade holds **only while the log takes crashes
 * and failures and nothing else** — the first call site that logs per keystroke makes it
 * wrong, and that is why {@link DesktopLog} has no `trace`.
 */

/** The log, plus where it is, which is what the menu item needs. */
export interface DesktopLog extends Logger {
  /** The folder the "open the log folder" menu item reveals. */
  readonly directory: string;
}

export interface FileLogOptions {
  /** Where the files go. Created on first write, not here. */
  readonly directory: string;
  /** `app.getVersion()`. On every line, because a report without it names no build. */
  readonly version: string;
  /** `process.platform`. On every line, for the same reason. */
  readonly platform: string;
  /**
   * How large one file may get before it is rotated.
   *
   * 256 KiB, counted rather than rounded: an entry is a timestamp, a level, the version, the
   * platform and a message — about 90 bytes — plus, for a crash, a stack flattened onto the
   * line, 400 to 800 more. So the ceiling is roughly 300 to 2700 entries, and this log only
   * takes failures. A tester who produces 2700 of them has a different problem.
   */
  readonly maxBytes?: number;
}

export const DEFAULT_MAX_BYTES = 256 * 1024;

/** The current file, and the one generation kept behind it. */
export const LOG_FILE = 'tyto.log';
export const PREVIOUS_LOG_FILE = 'tyto.log.1';

type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * A `detail` reduced to one line of text, or nothing.
 *
 * An `Error` becomes its message and its stack, because the stack is the whole reason a
 * crash line is worth writing. Anything else becomes JSON, and anything that will not
 * serialise becomes `String(value)` rather than taking the log down with it — a logger that
 * throws inside an error path is a loop.
 */
function describe(detail: unknown): string | undefined {
  if (detail === undefined) return undefined;
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/**
 * Newlines and carriage returns flattened, so one entry is one line.
 *
 * A stack is multi-line by nature, and a log where one entry spans nine lines cannot be
 * grepped, counted or truncated at a line boundary. `⏎` rather than a space, so the shape of
 * the stack survives for whoever reads it.
 */
const oneLine = (text: string): string => text.replace(/\r?\n/gu, ' ⏎ ');

export function fileLog({
  directory,
  version,
  platform,
  maxBytes = DEFAULT_MAX_BYTES,
}: FileLogOptions): DesktopLog {
  const file = join(directory, LOG_FILE);
  const previous = join(directory, PREVIOUS_LOG_FILE);

  const rotate = (): void => {
    try {
      if (statSync(file).size < maxBytes) return;
      // One generation, overwritten. Two files at the ceiling is half a megabyte, ever — a
      // log that grows forever on somebody's disk is the second bug this card would ship.
      renameSync(file, previous);
    } catch {
      // No file yet, or a rename the OS refused. Either way the append below is still the
      // right next move.
    }
  };

  const write = (level: Level, message: string, detail?: unknown): void => {
    const described = describe(detail);
    const line = [
      new Date().toISOString(),
      level.toUpperCase(),
      version,
      platform,
      oneLine(message),
      ...(described === undefined ? [] : [oneLine(described)]),
    ].join(' | ');

    try {
      mkdirSync(directory, { recursive: true });
      rotate();
      appendFileSync(file, `${line}\n`, 'utf8');
    } catch {
      // A disk that will not take the log is not a reason to take the app down. There is
      // nowhere left to report this to — writing it down is what just failed.
    }
  };

  return {
    directory,
    debug: (message, detail) => {
      write('debug', message, detail);
    },
    info: (message, detail) => {
      write('info', message, detail);
    },
    warn: (message, detail) => {
      write('warn', message, detail);
    },
    error: (message, detail) => {
      write('error', message, detail);
    },
  };
}

/**
 * What the process writes down when nobody caught something.
 *
 * **This changes behaviour and the change is stated rather than hidden.** Electron shows its
 * own error box for an `uncaughtException` only while nothing else is listening; a listener
 * takes that over. So after this card a main-process crash leaves a line in the log and no
 * box on screen. Re-throwing from inside the handler does not give the box back — Node treats
 * an exception raised inside an `uncaughtException` listener as fatal and ends the process
 * printing to a stream a packaged app has nobody reading. Putting the box back means calling
 * `dialog.showErrorBox`, which is an Electron API and therefore the composition root's, not
 * this file's; it is recorded in the PR as an open end rather than guessed at here.
 *
 * `process` is taken as an argument for the reason everything else in main is injected — so
 * this can be driven by a test without a running Electron (ADR 0010).
 */
export function installCrashHandlers(target: Pick<NodeJS.Process, 'on'>, log: Logger): void {
  target.on('uncaughtException', (error: Error) => {
    log.error('uncaught exception in main', error);
  });

  target.on('unhandledRejection', (reason: unknown) => {
    log.error('unhandled rejection in main', reason);
  });
}
