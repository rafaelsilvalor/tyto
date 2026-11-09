import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from '../environment.js';
import { EXIT_INTERNAL, EXIT_OK } from '../exit.js';
import { run } from '../program.js';
import { NO_WINDOW, WINDOW_REFUSED, WINDOW_UNREACHABLE, relayToWindow } from './relay.js';
import {
  REFUSED_LINE,
  UNIX_SOCKET_PATH_MAX,
  type WindowRecord,
  acceptedLine,
  checkHandshake,
  endpointFor,
  handshakeLine,
  listWindows,
  pickWindow,
  processAlive,
  readFirstLine,
  recordPath,
  sameToken,
} from './window-endpoint.js';

/**
 * `tyto mcp --window` against a fake window (ADR 0180): a real `net` server on a real named pipe
 * (Windows) or Unix socket (elsewhere), speaking the handshake the desktop's main will speak and
 * then echoing every frame. What is under test is the relay and the contract both sides share;
 * the window's own server is TYTO-566 PR 2.
 */

let home: string;
let folder: string;
let out: string[];
let errors: string[];
const servers: Server[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-win-'));
  folder = await mkdtemp(join(tmpdir(), 'tyto-ws-'));
  await mkdir(join(home, 'windows'), { recursive: true });
  out = [];
  errors = [];
});

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await rm(home, { recursive: true, force: true });
  await rm(folder, { recursive: true, force: true });
});

/** A pipe or socket name no other test, and no other run, shares. */
function uniqueEndpoint(): string {
  const name = `tyto-test-${randomBytes(6).toString('hex')}`;
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : join(home, 'windows', `${name}.sock`);
}

interface FakeWindow {
  readonly record: WindowRecord;
  /** Every handshake line the window read, and whether it accepted it. */
  readonly hellos: { line: string; accepted: boolean }[];
}

/** Listens like a window, writes its record, answers the handshake, then echoes each frame. */
async function fakeWindow(
  overrides: Partial<WindowRecord> = {},
  write = true,
): Promise<FakeWindow> {
  const record: WindowRecord = {
    version: 1,
    pid: process.pid,
    endpoint: uniqueEndpoint(),
    folder,
    token: randomBytes(32).toString('hex'),
    startedAt: new Date().toISOString(),
    ...overrides,
  };
  const hellos: FakeWindow['hellos'] = [];
  const server = createServer((socket: Socket) => {
    void (async () => {
      const line = await readFirstLine(socket);
      const accepted = line !== undefined && checkHandshake(line, record.token);
      hellos.push({ line: line ?? '', accepted });
      if (!accepted) {
        socket.end(REFUSED_LINE);
        return;
      }
      socket.write(acceptedLine(record.pid, record.folder));
      let buffered = '';
      socket.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        let end: number;
        while ((end = buffered.indexOf('\n')) >= 0) {
          const frame = JSON.parse(buffered.slice(0, end)) as { id: number; method: string };
          buffered = buffered.slice(end + 1);
          socket.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { echo: frame.method } })}\n`,
          );
        }
      });
      socket.resume();
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(record.endpoint, resolve));
  if (write) {
    await writeFile(join(home, 'windows', `${String(record.pid)}.json`), JSON.stringify(record));
  }
  return { record, hellos };
}

/** `run(['mcp', '--window'])` over two in-memory streams: what an agent's host is to it. */
function relay(args: readonly string[] = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  let written = '';
  const waiting = new Map<number, (frame: { result: { echo: string } }) => void>();
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
    let end: number;
    while ((end = written.indexOf('\n')) >= 0) {
      const line = written.slice(0, end);
      written = written.slice(end + 1);
      lines.push(line);
      // Throws on anything but one JSON-RPC frame: nothing else may reach stdout.
      const frame = JSON.parse(line) as { jsonrpc: string; id: number; result: { echo: string } };
      expect(frame.jsonrpc).toBe('2.0');
      waiting.get(frame.id)?.(frame);
    }
  });
  const environment: CliEnvironment = {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: folder,
    home,
    // The relay renders nothing: a rasterizer asked for is a bug.
    rasterizer: () => {
      throw new Error('the relay asked for a rasterizer');
    },
    stdio: () => ({ input, output }),
  };
  const exit = run(['mcp', '--window', ...args], environment);
  let next = 1;
  const request = (method: string) => {
    const id = next++;
    const answered = new Promise<{ result: { echo: string } }>((resolve) =>
      waiting.set(id, resolve),
    );
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method })}\n`);
    return answered;
  };
  return { exit, request, lines, input, written: () => written };
}

describe('tyto mcp --window', () => {
  it('relays frames both ways, says on stderr which window, and prints nothing but frames', async () => {
    const window = await fakeWindow();
    const client = relay();

    expect((await client.request('tools/list')).result.echo).toBe('tools/list');
    expect((await client.request('initialize')).result.echo).toBe('initialize');
    client.input.end();

    expect(await client.exit).toBe(EXIT_OK);
    expect(client.lines).toHaveLength(2);
    expect(client.written()).toBe('');
    expect(out).toEqual([]);
    expect(window.hellos).toEqual([{ line: expect.any(String), accepted: true }]);
    expect(errors.join('')).toContain(`the window of ${folder} (pid ${String(process.pid)})`);
  });

  it('is refused by a window whose token it does not carry, and writes nothing to stdout', async () => {
    const window = await fakeWindow();
    await writeFile(
      join(home, 'windows', `${String(process.pid)}.json`),
      JSON.stringify({ ...window.record, token: 'f'.repeat(64) }),
    );
    const client = relay();

    expect(await client.exit).toBe(EXIT_INTERNAL);
    expect(window.hellos.map((hello) => hello.accepted)).toEqual([false]);
    expect(errors.join('')).toContain(WINDOW_REFUSED);
    expect(client.lines).toEqual([]);
    expect(client.written()).toBe('');
  });

  it('fails as an internal failure, and says why, when no window is open', async () => {
    const client = relay();
    expect(await client.exit).toBe(EXIT_INTERNAL);
    expect(errors.join('')).toBe(NO_WINDOW);
    expect(client.lines).toEqual([]);
  });

  it('says the window did not answer when its endpoint is gone', async () => {
    await writeFile(
      join(home, 'windows', `${String(process.pid)}.json`),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        endpoint: uniqueEndpoint(),
        folder,
        token: 'a'.repeat(64),
        startedAt: new Date().toISOString(),
      } satisfies WindowRecord),
    );
    const client = relay();
    expect(await client.exit).toBe(EXIT_INTERNAL);
    expect(errors.join('')).toContain(WINDOW_UNREACHABLE);
  });

  it('skips a window whose process is gone, and leaves its record where it is', async () => {
    const gone = await fakeWindow({ pid: 999_999_991, folder }, true);
    const live = await fakeWindow({ folder: home }, true);
    const input = new PassThrough();
    const output = new PassThrough();
    const exit = relayToWindow({
      home,
      folder,
      platform: process.platform,
      stdio: { input, output },
      err: (text) => errors.push(text),
      alive: (pid) => pid !== gone.record.pid,
    });
    input.end();

    expect(await exit).toBe(EXIT_OK);
    expect(gone.hellos).toEqual([]);
    expect(live.hellos.map((hello) => hello.accepted)).toEqual([true]);
    expect(errors.join('')).toContain('relaying to the most recent one');
    expect(
      (await readdir(join(home, 'windows'))).filter((name) => name.endsWith('.json')),
    ).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ the contract -- */

const record = (overrides: Partial<WindowRecord>): WindowRecord => ({
  version: 1,
  pid: 10,
  endpoint: 'x',
  folder: null,
  token: 't'.repeat(32),
  startedAt: '2026-11-09T10:00:00.000Z',
  ...overrides,
});

describe('pickWindow', () => {
  it('picks the window whose workspace holds the folder over a more recent one', () => {
    const holding = record({ pid: 1, folder: '/work/a', startedAt: '2026-11-09T09:00:00.000Z' });
    const recent = record({ pid: 2, folder: '/work/b', startedAt: '2026-11-09T11:00:00.000Z' });
    expect(pickWindow([recent, holding], '/work/a/task', 'linux')).toEqual({
      record: holding,
      why: 'folder',
    });
  });

  it('picks the deepest workspace that holds the folder', () => {
    const outer = record({ pid: 1, folder: '/work', startedAt: '2026-11-09T11:00:00.000Z' });
    const inner = record({ pid: 2, folder: '/work/a', startedAt: '2026-11-09T09:00:00.000Z' });
    expect(pickWindow([outer, inner], '/work/a', 'linux')?.record).toBe(inner);
  });

  it('falls back to the most recent window, and says so', () => {
    const old = record({ pid: 1, folder: '/x', startedAt: '2026-11-09T09:00:00.000Z' });
    const recent = record({ pid: 2, folder: null, startedAt: '2026-11-09T11:00:00.000Z' });
    expect(pickWindow([old, recent], '/elsewhere', 'linux')).toEqual({
      record: recent,
      why: 'most-recent',
    });
    expect(pickWindow([], '/elsewhere', 'linux')).toBeUndefined();
  });

  it('does not take a sibling with a common prefix for a parent', () => {
    const sibling = record({ pid: 1, folder: '/work/a', startedAt: '2026-11-09T11:00:00.000Z' });
    expect(pickWindow([sibling], '/work/ab', 'linux')?.why).toBe('most-recent');
  });

  it('compares Windows folders without case, and POSIX ones with it', () => {
    const windows = record({ pid: 1, folder: 'C:\\Work\\A' });
    expect(pickWindow([windows], 'c:\\work\\a\\task', 'win32')?.why).toBe('folder');
    const posix = record({ pid: 1, folder: '/Work/A' });
    expect(pickWindow([posix], '/work/a/task', 'linux')?.why).toBe('most-recent');
  });
});

describe('listWindows', () => {
  it('reads the live records and skips malformed and dead ones without removing them', async () => {
    const live = record({ pid: 41, endpoint: 'pipe-a' });
    await writeFile(join(home, 'windows', '41.json'), JSON.stringify(live));
    await writeFile(join(home, 'windows', '42.json'), JSON.stringify(record({ pid: 42 })));
    await writeFile(join(home, 'windows', '43.json'), '{ not json');
    await writeFile(join(home, 'windows', '44.json'), JSON.stringify({ pid: 44 }));

    expect(await listWindows(home, process.platform, (pid) => pid !== 42)).toEqual([live]);
    expect(await readdir(join(home, 'windows'))).toHaveLength(4);
  });

  it('answers none when there is no windows folder', async () => {
    expect(await listWindows(join(home, 'nowhere'), process.platform)).toEqual([]);
  });

  it('names the record after the process', () => {
    expect(recordPath('/home/u/.tyto', 7, 'linux')).toBe('/home/u/.tyto/windows/7.json');
    expect(recordPath('C:\\Users\\u\\.tyto', 7, 'win32')).toBe(
      'C:\\Users\\u\\.tyto\\windows\\7.json',
    );
  });
});

describe('processAlive', () => {
  it('is true for this process and false for one that is not running', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(999_999_991)).toBe(false);
  });
});

describe('endpointFor', () => {
  const place = { pid: 1234, user: 'Ana Maria', tmp: '/tmp' };

  it('is a named pipe on Windows, with the user and the process in its name', () => {
    expect(endpointFor({ ...place, home: 'C:\\Users\\ana\\.tyto', platform: 'win32' })).toBe(
      '\\\\.\\pipe\\tyto-ana-maria-1234',
    );
  });

  it('is a socket beside the record when the path fits', () => {
    expect(endpointFor({ ...place, home: '/home/ana/.tyto', platform: 'linux' })).toBe(
      '/home/ana/.tyto/windows/1234.sock',
    );
  });

  it('moves to a per-user folder in tmp when TYTO_HOME is too deep for a socket', () => {
    const suffix = '/windows/1234.sock';
    const fits = `/${'h'.repeat(UNIX_SOCKET_PATH_MAX - suffix.length - 1)}`;
    expect(`${fits}${suffix}`).toHaveLength(UNIX_SOCKET_PATH_MAX);
    expect(endpointFor({ ...place, home: fits, platform: 'darwin' })).toBe(`${fits}${suffix}`);
    expect(endpointFor({ ...place, home: `${fits}h`, platform: 'darwin' })).toBe(
      '/tmp/tyto-ana-maria/1234.sock',
    );
  });
});

describe('handshake', () => {
  const token = randomBytes(32).toString('hex');

  it('accepts the token and nothing else', () => {
    expect(checkHandshake(handshakeLine(token).trimEnd(), token)).toBe(true);
    expect(checkHandshake(handshakeLine(`${token}0`).trimEnd(), token)).toBe(false);
    expect(checkHandshake(handshakeLine('').trimEnd(), token)).toBe(false);
    expect(checkHandshake(JSON.stringify({ tyto: 'window', version: 2, token }), token)).toBe(
      false,
    );
    expect(checkHandshake('not json', token)).toBe(false);
  });

  it('compares tokens of any length without throwing', () => {
    expect(sameToken(token, token)).toBe(true);
    expect(sameToken(token, 'short')).toBe(false);
  });

  it('reads the first line and leaves what follows it for the next reader', async () => {
    const stream = new PassThrough();
    stream.write(`${handshakeLine(token)}{"jsonrpc":"2.0","id":1}\n`);
    expect(await readFirstLine(stream)).toBe(handshakeLine(token).trimEnd());
    const rest = await new Promise<string>((resolve) =>
      stream.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8'))).resume(),
    );
    expect(rest).toBe('{"jsonrpc":"2.0","id":1}\n');
  });

  it('gives up on a first line longer than the limit', async () => {
    const stream = new PassThrough();
    stream.write('x'.repeat(5000));
    expect(await readFirstLine(stream)).toBeUndefined();
  });
});
