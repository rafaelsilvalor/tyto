import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from '../environment.js';
import { EXIT_INTERNAL, EXIT_OK } from '../exit.js';
import { run } from '../program.js';
import {
  NO_WINDOW,
  WINDOW_REFUSED,
  WINDOW_UNREACHABLE,
  namedGoneLine,
  relayToWindow,
} from './relay.js';
import {
  REFUSED_LINE,
  UNIX_SOCKET_PATH_MAX,
  type WindowRecord,
  acceptedLine,
  checkHandshake,
  connectTargetOf,
  handshakeLine,
  listenTargetFor,
  loopbackEndpoint,
  listWindows,
  pickWindow,
  processAlive,
  readFirstLine,
  recordPath,
  sameToken,
  windowPidOf,
} from './window-endpoint.js';

/**
 * `tyto mcp --window` against a fake window (ADR 0180): a real `net` server on a loopback port
 * (Windows, ADR 0189) or Unix socket (elsewhere), speaking the handshake the desktop's main will speak and
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

/** How a fake window listens: as the platform's window does (ADR 0189), or forced. */
type Transport = 'tcp' | 'socket';

const platformTransport: Transport = process.platform === 'win32' ? 'tcp' : 'socket';

/** A socket path no other test, and no other run, shares. */
function uniqueSocket(): string {
  return join(home, 'windows', `tyto-test-${randomBytes(6).toString('hex')}.sock`);
}

/** An endpoint nobody listens at: a loopback port just given back, or a socket never made. */
async function vacantEndpoint(): Promise<string> {
  if (platformTransport === 'socket') return uniqueSocket();
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return loopbackEndpoint(port);
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
  transport: Transport = platformTransport,
): Promise<FakeWindow> {
  const record: WindowRecord = {
    version: 1,
    pid: process.pid,
    // A loopback port is known once listening; set below.
    endpoint: transport === 'socket' ? uniqueSocket() : 'tcp://127.0.0.1:0',
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
  if (transport === 'socket') {
    await new Promise<void>((resolve) => server.listen(record.endpoint, resolve));
  } else {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    record.endpoint = loopbackEndpoint((server.address() as AddressInfo).port);
  }
  if (write) {
    await writeFile(join(home, 'windows', `${String(record.pid)}.json`), JSON.stringify(record));
  }
  return { record, hellos };
}

/** `run(['mcp', '--window'])` over two in-memory streams: what an agent's host is to it. */
function relay(
  args: readonly string[] = [],
  variables?: Readonly<Record<string, string | undefined>>,
) {
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
    ...(variables === undefined ? {} : { variables }),
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
        endpoint: await vacantEndpoint(),
        folder,
        token: 'a'.repeat(64),
        startedAt: new Date().toISOString(),
      } satisfies WindowRecord),
    );
    const client = relay();
    expect(await client.exit).toBe(EXIT_INTERNAL);
    expect(errors.join('')).toContain(WINDOW_UNREACHABLE);
  });

  it('tries the next window when nobody listens where a live record says, and says so (TYTO-656)', async () => {
    // A record whose pid is alive but whose window is gone — a pid Windows gave to another
    // process — and that the pick puts first: its workspace holds the folder.
    const stale = 424_242;
    await writeFile(
      join(home, 'windows', `${String(stale)}.json`),
      JSON.stringify({
        version: 1,
        pid: stale,
        endpoint: await vacantEndpoint(),
        folder,
        token: 'a'.repeat(64),
        startedAt: new Date().toISOString(),
      } satisfies WindowRecord),
    );
    const live = await fakeWindow({ folder: home }, true);
    const input = new PassThrough();
    const output = new PassThrough();
    const exit = relayToWindow({
      home,
      folder,
      platform: process.platform,
      stdio: { input, output },
      err: (text) => errors.push(text),
      alive: () => true,
    });
    input.end();

    expect(await exit).toBe(EXIT_OK);
    expect(live.hellos.map((hello) => hello.accepted)).toEqual([true]);
    const said = errors.join('');
    expect(said).toContain(`the window of ${folder} (pid ${String(stale)})`);
    expect(said).toContain(`nobody listens at the endpoint of pid ${String(stale)}`);
    expect(said).toContain('relaying to the most recent one');
  });

  it('relays over a loopback port on every platform, as a Windows window serves (ADR 0189)', async () => {
    const window = await fakeWindow({}, true, 'tcp');
    expect(window.record.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:[1-9][0-9]*$/u);
    const client = relay();

    expect((await client.request('tools/list')).result.echo).toBe('tools/list');
    client.input.end();
    expect(await client.exit).toBe(EXIT_OK);
    expect(window.hellos.map((hello) => hello.accepted)).toEqual([true]);
  });

  it('never sends its token to a tcp endpoint off this machine: it skips the record (ADR 0189)', async () => {
    // 192.0.2.1 is TEST-NET-1: nothing answers there, so a relay that tried would hang.
    await writeFile(
      join(home, 'windows', `${String(process.pid)}.json`),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        endpoint: 'tcp://192.0.2.1:4000',
        folder,
        token: 'a'.repeat(64),
        startedAt: new Date().toISOString(),
      } satisfies WindowRecord),
    );
    const client = relay();

    expect(await client.exit).toBe(EXIT_INTERNAL);
    expect(errors.join('')).toContain(
      `nobody listens at the endpoint of pid ${String(process.pid)}`,
    );
    expect(errors.join('')).toContain(WINDOW_UNREACHABLE);
  }, 2000);

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

describe('tyto mcp --window from a terminal Tyto started (ADR 0181)', () => {
  it('relays to the window TYTO_WINDOW names, though its workspace does not hold the folder', async () => {
    const window = await fakeWindow({ folder: home });
    const client = relay([], { TYTO_WINDOW: String(process.pid) });
    expect((await client.request('tools/list')).result.echo).toBe('tools/list');
    client.input.end();

    expect(await client.exit).toBe(EXIT_OK);
    expect(window.hellos.map((hello) => hello.accepted)).toEqual([true]);
    expect(errors.join('')).toContain('relaying to the window that started this terminal');
    expect(errors.join('')).not.toContain('most recent');
  });

  it('prefers the named window over the one whose workspace holds the folder', async () => {
    const holding = await fakeWindow({ pid: 4101, folder }, true);
    const named = await fakeWindow({ pid: 4102, folder: home }, true);
    const input = new PassThrough();
    const output = new PassThrough();
    const exit = relayToWindow({
      home,
      folder,
      platform: process.platform,
      stdio: { input, output },
      err: (text) => errors.push(text),
      named: 4102,
      alive: () => true,
    });
    input.end();

    expect(await exit).toBe(EXIT_OK);
    expect(holding.hellos).toEqual([]);
    expect(named.hellos.map((hello) => hello.accepted)).toEqual([true]);
  });

  it('falls back to the folder rule when the named window is gone, and says so', async () => {
    const holding = await fakeWindow({ pid: 4201, folder }, true);
    await fakeWindow({ pid: 4202, folder: home }, true);
    const input = new PassThrough();
    const output = new PassThrough();
    const exit = relayToWindow({
      home,
      folder,
      platform: process.platform,
      stdio: { input, output },
      err: (text) => errors.push(text),
      named: 4202,
      alive: (pid) => pid !== 4202,
    });
    input.end();

    expect(await exit).toBe(EXIT_OK);
    expect(holding.hellos.map((hello) => hello.accepted)).toEqual([true]);
    expect(errors.join('')).toContain(namedGoneLine(4202));
    expect(errors.join('')).toContain('relaying to the window of');
  });

  it('reads a process id from TYTO_WINDOW, and nothing else', () => {
    expect(windowPidOf('4102')).toBe(4102);
    expect(windowPidOf(' 4102 ')).toBe(4102);
    for (const value of [undefined, '', '0', '-1', '12a', '1.5', '01', '99999999999']) {
      expect(windowPidOf(value)).toBeUndefined();
    }
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

  it('picks the named window first, and ignores a name no open window has', () => {
    const holding = record({ pid: 1, folder: '/work/a' });
    const named = record({ pid: 2, folder: '/work/b' });
    expect(pickWindow([holding, named], '/work/a', 'linux', 2)).toEqual({
      record: named,
      why: 'named',
    });
    expect(pickWindow([holding, named], '/work/a', 'linux', 3)).toEqual({
      record: holding,
      why: 'folder',
    });
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

describe('listenTargetFor', () => {
  const place = { pid: 1234, user: 'Ana Maria', tmp: '/tmp' };

  it('is a loopback port the system picks on Windows, never every interface (ADR 0189)', () => {
    expect(listenTargetFor({ ...place, home: 'C:\\Users\\ana\\.tyto', platform: 'win32' })).toEqual(
      { host: '127.0.0.1', port: 0 },
    );
  });

  it('is a socket beside the record when the path fits', () => {
    expect(listenTargetFor({ ...place, home: '/home/ana/.tyto', platform: 'linux' })).toEqual({
      path: '/home/ana/.tyto/windows/1234.sock',
    });
  });

  it('moves to a per-user folder in tmp when TYTO_HOME is too deep for a socket', () => {
    const suffix = '/windows/1234.sock';
    const fits = `/${'h'.repeat(UNIX_SOCKET_PATH_MAX - suffix.length - 1)}`;
    expect(`${fits}${suffix}`).toHaveLength(UNIX_SOCKET_PATH_MAX);
    expect(listenTargetFor({ ...place, home: fits, platform: 'darwin' })).toEqual({
      path: `${fits}${suffix}`,
    });
    expect(listenTargetFor({ ...place, home: `${fits}h`, platform: 'darwin' })).toEqual({
      path: '/tmp/tyto-ana-maria/1234.sock',
    });
  });
});

describe('connectTargetOf', () => {
  it('reads back the loopback endpoint a Windows window writes', () => {
    expect(connectTargetOf(loopbackEndpoint(49_152))).toEqual({ host: '127.0.0.1', port: 49_152 });
  });

  it('takes a socket path, or a pipe from a window older than ADR 0189, as a path', () => {
    expect(connectTargetOf('/home/ana/.tyto/windows/1.sock')).toEqual({
      path: '/home/ana/.tyto/windows/1.sock',
    });
    expect(connectTargetOf('\\\\.\\pipe\\tyto-ana-1')).toEqual({ path: '\\\\.\\pipe\\tyto-ana-1' });
  });

  it('refuses a tcp endpoint off loopback, or with no usable port', () => {
    for (const endpoint of [
      'tcp://192.0.2.1:4000',
      'tcp://0.0.0.0:4000',
      'tcp://localhost:4000',
      'tcp://127.0.0.1.example.com:4000',
      'tcp://127.0.0.1:0',
      'tcp://127.0.0.1:65536',
      'tcp://127.0.0.1:04000',
      'tcp://127.0.0.1:',
    ]) {
      expect(connectTargetOf(endpoint), endpoint).toBeUndefined();
    }
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
