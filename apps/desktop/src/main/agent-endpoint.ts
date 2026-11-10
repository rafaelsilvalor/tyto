import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { userInfo } from 'node:os';
import { posix, win32 } from 'node:path';

import {
  REFUSED_LINE,
  type WindowRecord,
  acceptedLine,
  checkHandshake,
  listenTargetFor,
  loopbackEndpoint,
  readFirstLine,
  recordPath,
  windowsFolder,
} from '@tyto/command-line';

/**
 * The window's local endpoint for agents (ADR 0180): a loopback TCP port on Windows (ADR 0189),
 * a Unix socket elsewhere, announced by a record in `TYTO_HOME/windows/<pid>.json` that `tyto mcp --window`
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

/**
 * Makes `TYTO_HOME/windows` readable by its owner and SYSTEM only, on Windows. On TCP the token
 * is the only gate (ADR 0189), and the record that holds it would otherwise inherit whatever
 * `TYTO_HOME` grants: on the maintainer's machine, a read grant to a local group another tool
 * added. `icacls` drops the inherited entries and grants those two, inheritable, so a record
 * written there afterwards carries them from the moment it exists.
 */
export function restrictFolderOnWindows(folder: string, account: string): Promise<void> {
  const icacls = win32.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe');
  const args = [
    folder,
    '/inheritance:r',
    '/grant:r',
    '*S-1-5-18:(OI)(CI)F',
    `${account}:(OI)(CI)F`,
  ];
  return new Promise((resolve, reject) => {
    execFile(icacls, args, { windowsHide: true }, (cause) => {
      if (cause === null) resolve();
      else reject(cause);
    });
  });
}

/** The account `icacls` names: `DOMAIN\user` when Windows says the domain, the user otherwise. */
export function windowsAccount(user: string, domain: string | undefined): string {
  return domain === undefined || domain === '' ? user : `${domain}\\${user}`;
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
  /**
   * Restricts the records folder to its owner before the window listens (Windows only; Unix
   * creates it 0700). The tests' seam; {@link restrictFolderOnWindows} by default.
   */
  readonly restrictFolder?: (folder: string) => Promise<void>;
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
  const target = listenTargetFor(options);
  // A socket's path is known before it listens; a loopback port only after.
  let endpoint: string | undefined = 'path' in target ? target.path : undefined;
  const live = new Map<Socket, AbortController>();
  let server: Server | undefined;
  let listening = false;

  const report = (): void => options.onConnections?.(live.size);

  const writeRecord = async (): Promise<void> => {
    if (endpoint === undefined) return;
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
      if ('path' in target) {
        const socketFolder = posix.dirname(target.path);
        await mkdir(socketFolder, { recursive: true, mode: 0o700 });
        await chmod(socketFolder, 0o700);
        // A socket file left by a process that had this pid before refuses `listen`.
        await rm(target.path, { force: true });
      } else {
        const restrict =
          options.restrictFolder ??
          ((path: string) =>
            restrictFolderOnWindows(path, windowsAccount(osUserName(), process.env['USERDOMAIN'])));
        // Before listening: a window that cannot keep its token to its owner does not listen.
        await restrict(folder);
      }
      server = createServer((socket) => {
        socket.on('error', () => socket.destroy());
        void accept(socket);
      });
      server.on('error', (cause) => options.onError?.('the agent endpoint failed', cause));
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        const onListening = (): void => {
          server?.off('error', reject);
          resolve();
        };
        // Loopback only, never `0.0.0.0`, which every machine on the network could reach.
        if ('path' in target) server?.listen(target.path, onListening);
        else server?.listen(target.port, target.host, onListening);
      });
      listening = true;
      if ('path' in target) await chmod(target.path, 0o600);
      else endpoint = loopbackEndpoint((server.address() as AddressInfo).port);
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
      if ('path' in target) await rm(target.path, { force: true });
    },
    removeRecordNow() {
      rmSync(record, { force: true });
    },
  };
}
