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
  connectTo: (endpoint: string) => Socket,
): Promise<{ socket: Socket } | { failure: string }> {
  const socket = connectTo(record.endpoint);
  const connected = await new Promise<boolean>((resolve) => {
    socket.once('connect', () => resolve(true));
    socket.once('error', () => resolve(false));
  });
  if (!connected) {
    socket.destroy();
    return { failure: WINDOW_UNREACHABLE };
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
  const records = await listWindows(options.home, options.platform, options.alive ?? processAlive);
  const picked = pickWindow(records, options.folder, options.platform, options.named);
  if (options.named !== undefined && picked?.why !== 'named') err(namedGoneLine(options.named));
  if (picked === undefined) {
    err(NO_WINDOW);
    return EXIT_INTERNAL;
  }
  err(pickedLine(picked));
  const opened = await open(picked.record, options.connectTo ?? ((endpoint) => connect(endpoint)));
  if ('failure' in opened) {
    err(opened.failure);
    return EXIT_INTERNAL;
  }
  await pump(opened.socket, options.stdio, options.signal);
  return EXIT_OK;
}
