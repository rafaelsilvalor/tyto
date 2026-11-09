import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { type Server, type Socket, createServer } from 'node:net';
import { userInfo } from 'node:os';
import { posix } from 'node:path';

import {
  REFUSED_LINE,
  type WindowRecord,
  acceptedLine,
  checkHandshake,
  endpointFor,
  readFirstLine,
  recordPath,
  windowsFolder,
} from '@tyto/command-line';

/**
 * The window's local endpoint for agents (ADR 0180): a named pipe on Windows, a Unix socket
 * elsewhere, announced by a record in `TYTO_HOME/windows/<pid>.json` that `tyto mcp --window`
 * reads. Each connection must open with the record's token; then it carries MCP frames, served by
 * {@link AgentEndpointOptions.serve} — the same tools `tyto mcp` serves, under the same trust.
 *
 * The record and the endpoint's name come from `@tyto/command-line`, which the relay reads them
 * with, so the two sides cannot drift apart.
 */

/** A connection that has not sent its first line by then is cut: a caller sends it at once. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** The OS user name, for the pipe's name; `user` when the system cannot say. */
export function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'user';
  }
}

export interface AgentEndpointOptions {
  /** `TYTO_HOME`. */
  readonly home: string;
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  readonly user: string;
  /** `os.tmpdir()`, for a socket a deep `TYTO_HOME` cannot hold. */
  readonly tmp: string;
  /** The open workspace folder, or null; read whenever the record is written. */
  readonly folder: () => string | null;
  /** Serves MCP on an accepted connection until it closes or `signal` fires. */
  readonly serve: (socket: Socket, signal: AbortSignal) => Promise<void>;
  /** The number of agents connected, after every change. */
  readonly onConnections?: (count: number) => void;
  readonly onError?: (message: string, cause: unknown) => void;
  readonly now?: () => Date;
}

export interface AgentEndpoint {
  /** Listens and writes the record. */
  start(): Promise<void>;
  /** Writes the record again, after the window opened another folder. */
  folderChanged(): Promise<void>;
  /** Closes every agent's connection; the endpoint keeps listening. */
  cut(): void;
  connections(): number;
  /** Where it listens; undefined before {@link start}. */
  endpoint(): string | undefined;
  /** Stops listening, cuts every connection and removes the record. */
  close(): Promise<void>;
  /** The record removed at once, for `will-quit`, which does not wait for a promise. */
  removeRecordNow(): void;
}

export function createAgentEndpoint(options: AgentEndpointOptions): AgentEndpoint {
  const token = randomBytes(32).toString('hex');
  const startedAt = (options.now ?? (() => new Date()))().toISOString();
  const record = recordPath(options.home, options.pid, options.platform);
  const endpoint = endpointFor(options);
  const posixSocket = options.platform !== 'win32';
  const live = new Map<Socket, AbortController>();
  let server: Server | undefined;
  let listening = false;

  const report = (): void => options.onConnections?.(live.size);

  const writeRecord = async (): Promise<void> => {
    const contents: WindowRecord = {
      version: 1,
      pid: options.pid,
      endpoint,
      folder: options.folder(),
      token,
      startedAt,
    };
    // Written beside and renamed, so a relay never reads half a record. Mode 0600: reading it
    // is what a caller needs (ADR 0180 decision 3); Windows ignores the mode, and the file
    // inherits the profile's ACL there.
    const partial = `${record}.${String(options.pid)}.partial`;
    await writeFile(partial, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
    await rename(partial, record);
  };

  const accept = async (socket: Socket): Promise<void> => {
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => socket.destroy());
    const line = await readFirstLine(socket);
    socket.setTimeout(0);
    if (line === undefined || !checkHandshake(line, token)) {
      // The same answer for every failure, no reason, and the connection closed.
      socket.end(REFUSED_LINE);
      socket.destroySoon();
      return;
    }
    socket.write(acceptedLine(options.pid, options.folder()));
    const controller = new AbortController();
    live.set(socket, controller);
    report();
    socket.once('close', () => controller.abort());
    try {
      // `serve` resumes the socket once the protocol listens: until then, a frame sent with the
      // handshake waits in the paused stream.
      await options.serve(socket, controller.signal);
    } catch (cause) {
      options.onError?.('an agent connection failed', cause);
    } finally {
      live.delete(socket);
      socket.destroy();
      report();
    }
  };

  return {
    async start() {
      const folder = windowsFolder(options.home, options.platform);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      if (posixSocket) {
        const socketFolder = posix.dirname(endpoint);
        await mkdir(socketFolder, { recursive: true, mode: 0o700 });
        await chmod(socketFolder, 0o700);
        // A socket file left by a process that had this pid before refuses `listen`.
        await rm(endpoint, { force: true });
      }
      server = createServer((socket) => {
        socket.on('error', () => socket.destroy());
        void accept(socket);
      });
      server.on('error', (cause) => options.onError?.('the agent endpoint failed', cause));
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(endpoint, () => {
          server?.off('error', reject);
          resolve();
        });
      });
      listening = true;
      if (posixSocket) await chmod(endpoint, 0o600);
      await writeRecord();
    },
    async folderChanged() {
      if (listening) await writeRecord();
    },
    cut() {
      for (const [socket, controller] of live) {
        controller.abort();
        socket.destroy();
      }
    },
    connections: () => live.size,
    endpoint: () => (listening ? endpoint : undefined),
    async close() {
      this.cut();
      this.removeRecordNow();
      if (server !== undefined && listening) {
        listening = false;
        await new Promise<void>((resolve) => server?.close(() => resolve()));
      }
      if (posixSocket) await rm(endpoint, { force: true });
    },
    removeRecordNow() {
      rmSync(record, { force: true });
    },
  };
}
