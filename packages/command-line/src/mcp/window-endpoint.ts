import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import type { Readable } from 'node:stream';

import { z } from 'zod';

/**
 * The contract between a running window and `tyto mcp --window` (ADR 0180): where a window says
 * it is listening, how a client proves it may talk to it, and which window a client picks when
 * several are open. Both sides import it from here, so the two never drift: the window (desktop
 * main, TYTO-566 PR 2) writes the record and answers the handshake; the relay reads the records
 * and sends the handshake.
 *
 * Nothing here listens or connects. That stays with the callers, which own the sockets.
 */

/** `TYTO_HOME/windows/`: one record per open window, named by its process id. */
export const WINDOWS_FOLDER = 'windows';

/**
 * The longest Unix socket path, in bytes, this contract writes. `sun_path` is 104 bytes on macOS
 * and 108 on Linux, NUL included; the smaller one, less its NUL, is the limit everywhere.
 */
export const UNIX_SOCKET_PATH_MAX = 103;

export const windowRecordSchema = z.object({
  version: z.literal(1),
  pid: z.number().int().positive(),
  /** A named pipe on Windows, a Unix socket path elsewhere: what `net.connect` takes. */
  endpoint: z.string().min(1),
  /** The workspace folder the window has open, absolute; null when it has none. */
  folder: z.string().min(1).nullable(),
  /** Random, at least 128 bits as hex; the gate (ADR 0180 decision 3). */
  token: z.string().min(32),
  /** ISO 8601; the most recent window wins when no folder matches. */
  startedAt: z.string().min(1),
});

export type WindowRecord = z.infer<typeof windowRecordSchema>;

type Platform = NodeJS.Platform;

const pathOf = (platform: Platform): typeof posix => (platform === 'win32' ? win32 : posix);

/** Lower-case letters, digits and dashes: a user name in a pipe or folder name, made safe. */
function safeName(user: string): string {
  const safe = user.toLowerCase().replace(/[^a-z0-9-]+/gu, '-');
  return safe === '' || safe === '-' ? 'user' : safe;
}

export function windowsFolder(home: string, platform: Platform): string {
  return pathOf(platform).join(home, WINDOWS_FOLDER);
}

export function recordPath(home: string, pid: number, platform: Platform): string {
  return pathOf(platform).join(windowsFolder(home, platform), `${String(pid)}.json`);
}

export interface EndpointPlace {
  readonly home: string;
  readonly pid: number;
  readonly platform: Platform;
  /** The OS user name; part of the pipe name, so two users' windows never share one. */
  readonly user: string;
  /** `os.tmpdir()`: where a socket goes when `TYTO_HOME` is too deep for one. */
  readonly tmp: string;
}

/**
 * Where a window listens. On Windows a named pipe, `\\.\pipe\tyto-<user>-<pid>`. Elsewhere a Unix
 * socket beside the record, or — when that path would pass {@link UNIX_SOCKET_PATH_MAX} bytes —
 * in `<tmp>/tyto-<user>/`, a folder the window creates with mode 0700.
 */
export function endpointFor(place: EndpointPlace): string {
  const name = `tyto-${safeName(place.user)}`;
  if (place.platform === 'win32') return `\\\\.\\pipe\\${name}-${String(place.pid)}`;
  const socket = `${String(place.pid)}.sock`;
  const beside = posix.join(windowsFolder(place.home, 'linux'), socket);
  if (Buffer.byteLength(beside, 'utf8') <= UNIX_SOCKET_PATH_MAX) return beside;
  return posix.join(place.tmp, name, socket);
}

/** Whether a process is running: signal 0 tests without sending; EPERM means it runs as another. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The records of the windows that are open. A record that does not parse, or whose process is
 * gone, is skipped and left where it is: a window removes its own record when it quits, and a
 * client deletes nothing it did not write.
 */
export async function listWindows(
  home: string,
  platform: Platform,
  alive: (pid: number) => boolean = processAlive,
): Promise<WindowRecord[]> {
  const folder = windowsFolder(home, platform);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const records: WindowRecord[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(pathOf(platform).join(folder, name), 'utf8'));
    } catch {
      continue;
    }
    const record = windowRecordSchema.safeParse(parsed);
    if (record.success && alive(record.data.pid)) records.push(record.data);
  }
  return records;
}

/**
 * The variable a terminal tab Tyto started carries: the process id of the window that started
 * it (ADR 0181). The relay prefers that window over the folder rule, so an agent started in a
 * window's terminal reaches that window and not the most recent one.
 */
export const WINDOW_PID_VARIABLE = 'TYTO_WINDOW';

/** The process id a {@link WINDOW_PID_VARIABLE} value names, or undefined when it names none. */
export function windowPidOf(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]{0,9}$/u.test(value.trim())) return undefined;
  return Number(value.trim());
}

export interface PickedWindow {
  readonly record: WindowRecord;
  /**
   * `named`: the window {@link WINDOW_PID_VARIABLE} names; `folder`: its workspace holds the
   * folder asked for; `most-recent`: none did.
   */
  readonly why: 'named' | 'folder' | 'most-recent';
}

/** Whether `inner` is `outer` or inside it, by the platform's rule (Windows ignores case). */
function within(platform: Platform, outer: string, inner: string): boolean {
  const path = pathOf(platform);
  const fold = (value: string): string =>
    platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const relative = path.relative(fold(outer), fold(inner));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const newestFirst = (left: WindowRecord, right: WindowRecord): number =>
  right.startedAt.localeCompare(left.startedAt) || right.pid - left.pid;

/**
 * Which window serves `folder`: the open window `named` (a process id), when one is; else the
 * one whose workspace holds the folder (the deepest, then the most recent), else the most
 * recently started window. Undefined when none is open. A named window that is not open — its
 * terminal outlived it — falls back to the folder rule rather than failing.
 */
export function pickWindow(
  records: readonly WindowRecord[],
  folder: string,
  platform: Platform,
  named?: number,
): PickedWindow | undefined {
  const chosen = named === undefined ? undefined : records.find((record) => record.pid === named);
  if (chosen !== undefined) return { record: chosen, why: 'named' };
  const holding = records
    .filter((record) => record.folder !== null && within(platform, record.folder, folder))
    .sort(
      (left, right) =>
        (right.folder ?? '').length - (left.folder ?? '').length || newestFirst(left, right),
    );
  const [match] = holding;
  if (match !== undefined) return { record: match, why: 'folder' };
  const [recent] = [...records].sort(newestFirst);
  return recent === undefined ? undefined : { record: recent, why: 'most-recent' };
}

/* ------------------------------------------------------------------------- handshake -- */

/** The client's first line on a fresh connection; nothing else is read until it is answered. */
export function handshakeLine(token: string): string {
  return `${JSON.stringify({ tyto: 'window', version: 1, token })}\n`;
}

/** The window's answer to a good handshake. A bad one is answered {@link REFUSED_LINE} and cut. */
export function acceptedLine(pid: number, folder: string | null): string {
  return `${JSON.stringify({ tyto: 'window', ok: true, pid, folder })}\n`;
}

/** No reason given: a wrong token, a malformed line and a wrong version read the same. */
export const REFUSED_LINE = `${JSON.stringify({ tyto: 'window', ok: false })}\n`;

/** The longest first line either side reads before giving up on the peer. */
export const HANDSHAKE_MAX_BYTES = 4096;

const answerSchema = z.object({
  tyto: z.literal('window'),
  ok: z.boolean(),
  pid: z.number().optional(),
  folder: z.string().nullable().optional(),
});

/**
 * Compares two tokens in time that does not depend on where they differ. Both are hashed first,
 * so their lengths cannot differ either, and the length of the real token is not told.
 */
export function sameToken(expected: string, given: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(expected), digest(given));
}

/** Whether a client's first line carries this window's token. */
export function checkHandshake(line: string, token: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const hello = z
    .object({ tyto: z.literal('window'), version: z.literal(1), token: z.string() })
    .safeParse(parsed);
  return hello.success && sameToken(token, hello.data.token);
}

/** Reads the parsed window answer from a line, or undefined when it is not one. */
export function parseAnswer(line: string): z.infer<typeof answerSchema> | undefined {
  try {
    const answer = answerSchema.safeParse(JSON.parse(line));
    return answer.success ? answer.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads one line from a stream, and puts back whatever came after it, so the next reader sees
 * the stream from the line's end. Undefined when the stream ends first or the line passes
 * {@link HANDSHAKE_MAX_BYTES}.
 *
 * The stream is left paused, so nothing after the line is dropped before the next reader is
 * attached. `pipe` resumes it; a reader that only listens for `data` must call `resume()`, since
 * a stream paused on purpose does not start flowing when a listener is added.
 */
export function readFirstLine(stream: Readable): Promise<string | undefined> {
  return new Promise((resolve) => {
    let buffered = Buffer.alloc(0);
    const finish = (line: string | undefined, rest?: Buffer): void => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onEnd);
      stream.off('close', onEnd);
      stream.pause();
      if (rest !== undefined && rest.length > 0) stream.unshift(rest);
      resolve(line);
    };
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf(0x0a);
      if (end >= 0) {
        finish(buffered.subarray(0, end).toString('utf8'), buffered.subarray(end + 1));
      } else if (buffered.length > HANDSHAKE_MAX_BYTES) {
        finish(undefined);
      }
    };
    const onEnd = (): void => {
      finish(undefined);
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onEnd);
    stream.once('close', onEnd);
  });
}
