import { type Socket, connect } from 'node:net';

import type { CliConsole, CliStdio } from '../environment.js';
import { EXIT_INTERNAL, EXIT_OK, type ExitCode } from '../exit.js';
import {
  type PickedWindow,
  type WindowRecord,
  handshakeLine,
  listWindows,
  parseAnswer,
  pickWindow,
  WINDOW_PID_VARIABLE,
  connectTargetOf,
  processAlive,
  readFirstLine,
} from './window-endpoint.js';

/**
 * `tyto mcp --window` — the relay between an agent's stdio and a running window (ADR 0180).
 *
 * An agent's host still registers one stdio command; this one picks a window, proves it may talk
 * to it, and then copies bytes both ways until either end closes. It reads no frame: the window
 * serves the protocol. Stdout carries the window's frames and nothing else (ADR 0179 decision 7);
 * which window was picked, and every failure, goes to stderr.
 */

export const NO_HOME = 'tyto mcp --window: there is no TYTO_HOME to find a window in (ADR 0180)\n';

export const NO_WINDOW =
  'tyto mcp --window: no Tyto window is open. Open the folder in Tyto and start again, or run tyto mcp without --window to serve the files (ADR 0180)\n';

export const WINDOW_REFUSED =
  'tyto mcp --window: the window refused the connection. Close the window and open it again, then start again (ADR 0180)\n';

export const WINDOW_UNREACHABLE =
  'tyto mcp --window: the window did not answer on its endpoint. It may have just closed; start again (ADR 0180)\n';

export interface RelayOptions {
  readonly home: string | undefined;
  readonly folder: string;
  readonly platform: NodeJS.Platform;
  readonly stdio: CliStdio;
  readonly err: CliConsole['err'];
  readonly signal?: AbortSignal;
  /** The window {@link WINDOW_PID_VARIABLE} names, preferred over the folder rule (ADR 0181). */
  readonly named?: number;
  /** The tests' seams; the process's own in a terminal. */
  readonly alive?: (pid: number) => boolean;
  readonly connectTo?: (endpoint: string) => Socket;
}

/**
 * Connects to a record's endpoint: a loopback port or a socket path. Undefined when the record
 * names neither, a non-loopback `tcp://` host included, which is never connected to: the
 * handshake would carry the token there.
 */
export function connectToEndpoint(endpoint: string): Socket | undefined {
  const target = connectTargetOf(endpoint);
  if (target === undefined) return undefined;
  return 'path' in target ? connect(target.path) : connect(target.port, target.host);
}

function pickedLine(picked: PickedWindow): string {
  const { record, why } = picked;
  const where = record.folder ?? 'no folder';
  if (why === 'named') {
    return `tyto mcp --window: relaying to the window that started this terminal, ${where} (pid ${String(record.pid)})
`;
  }
  return why === 'folder'
    ? `tyto mcp --window: relaying to the window of ${where} (pid ${String(record.pid)})\n`
    : `tyto mcp --window: no open window holds this folder; relaying to the most recent one, ${where} (pid ${String(record.pid)})\n`;
}

/** Said when the terminal's window is gone, before the folder rule picks another. */
export function namedGoneLine(pid: number): string {
  return `tyto mcp --window: ${WINDOW_PID_VARIABLE} names pid ${String(pid)}, which has no open window; picking by folder instead
`;
}

/** Connects and sends the handshake; resolves with the socket once the window accepted it. */
async function open(
  record: WindowRecord,
  connectTo: (endpoint: string) => Socket | undefined,
): Promise<{ socket: Socket } | { failure: string; readonly nobodyListens?: true }> {
  const socket = connectTo(record.endpoint);
  // An endpoint this relay cannot reach is skipped like one nobody listens at.
  if (socket === undefined) return { failure: WINDOW_UNREACHABLE, nobodyListens: true };
  const connected = await new Promise<NodeJS.ErrnoException | true>((resolve) => {
    socket.once('connect', () => resolve(true));
    socket.once('error', (cause: NodeJS.ErrnoException) => resolve(cause));
  });
  if (connected !== true) {
    socket.destroy();
    // No port or socket at the record's endpoint: a record whose window is gone, and whose pid
    // another process now has, so the liveness check let it through (TYTO-656). A relay older
    // than ADR 0189 reads a `tcp://` endpoint as a pipe's name and lands here too, with ENOENT.
    const nobodyListens = connected.code === 'ENOENT' || connected.code === 'ECONNREFUSED';
    return nobodyListens
      ? { failure: WINDOW_UNREACHABLE, nobodyListens: true }
      : { failure: WINDOW_UNREACHABLE };
  }
  socket.write(handshakeLine(record.token));
  const line = await readFirstLine(socket);
  const answer = line === undefined ? undefined : parseAnswer(line);
  if (answer?.ok !== true) {
    socket.destroy();
    return { failure: answer === undefined ? WINDOW_UNREACHABLE : WINDOW_REFUSED };
  }
  return { socket };
}

/** Copies stdio to the socket and back until either side ends, or `signal` fires. */
function pump(socket: Socket, stdio: CliStdio, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      stdio.input.unpipe(socket);
      socket.unpipe(stdio.output);
      socket.end();
      socket.destroy();
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    // `end: false` on the way out: the agent's stdout is not the relay's to close.
    socket.pipe(stdio.output, { end: false });
    stdio.input.pipe(socket, { end: false });
    stdio.input.once('end', finish);
    stdio.input.once('close', finish);
    socket.once('close', finish);
    socket.once('error', finish);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted === true) finish();
  });
}

export async function relayToWindow(options: RelayOptions): Promise<ExitCode> {
  const { err } = options;
  if (options.home === undefined) {
    err(NO_HOME);
    return EXIT_INTERNAL;
  }
  let records = await listWindows(options.home, options.platform, options.alive ?? processAlive);
  const connectTo = options.connectTo ?? connectToEndpoint;
  let first = true;
  let unreachable = false;
  for (;;) {
    const picked = pickWindow(records, options.folder, options.platform, options.named);
    if (first && options.named !== undefined && picked?.why !== 'named') {
      err(namedGoneLine(options.named));
    }
    first = false;
    if (picked === undefined) {
      // Every window there was had nobody listening: that, rather than "none is open".
      err(unreachable ? WINDOW_UNREACHABLE : NO_WINDOW);
      return EXIT_INTERNAL;
    }
    err(pickedLine(picked));
    const opened = await open(picked.record, connectTo);
    if (!('failure' in opened)) {
      await pump(opened.socket, options.stdio, options.signal);
      return EXIT_OK;
    }
    // Nobody listens where that record says: the next window in the same order, never a wait,
    // since a window writes its record only once it listens (ADR 0180, TYTO-656).
    if (opened.nobodyListens !== true) {
      err(opened.failure);
      return EXIT_INTERNAL;
    }
    err(nobodyListensLine(picked.record));
    unreachable = true;
    records = records.filter((record) => record !== picked.record);
  }
}

/** Said when a record's endpoint has nobody listening, before the next window is tried. */
export function nobodyListensLine(record: WindowRecord): string {
  return `tyto mcp --window: nobody listens at the endpoint of pid ${String(record.pid)}; its record is stale, trying the next window\n`;
}
