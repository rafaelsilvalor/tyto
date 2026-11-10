import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { type Socket, connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  type WindowRecord,
  connectTargetOf,
  connectToEndpoint,
  run,
  serveAgent,
} from '@tyto/command-line';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AgentEndpoint, createAgentEndpoint, osUserName } from './agent-endpoint.js';

/**
 * The window's endpoint (ADR 0180) with the real MCP server behind it: `serveAgent` from
 * `@tyto/command-line`, the code `tyto mcp` runs, over a real loopback port on Windows (ADR 0189)
 * and a real Unix socket elsewhere. On Windows the records folder is restricted by the real
 * `icacls`. Linux CI runs none of the Windows-only tests here. The last test drives the endpoint
 * through `tyto mcp --window` itself.
 */

let home: string;
let folder: string;
let endpoint: AgentEndpoint | undefined;
let counts: number[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-agent-home-'));
  folder = await mkdtemp(join(tmpdir(), 'tyto-agent-ws-'));
  counts = [];
});

afterEach(async () => {
  await endpoint?.close();
  endpoint = undefined;
  await rm(home, { recursive: true, force: true });
  await rm(folder, { recursive: true, force: true });
});

const quiet = { out: () => {}, err: () => {} };

async function started(serve?: (socket: Socket, signal: AbortSignal) => Promise<void>) {
  let open: string | null = folder;
  const opened = createAgentEndpoint({
    home,
    pid: process.pid,
    platform: process.platform,
    user: 'test',
    tmp: tmpdir(),
    folder: () => open,
    serve:
      serve ??
      ((socket, signal) =>
        serveAgent(
          {
            version: '0.0.0-test',
            cwd: folder,
            home,
            console: quiet,
            rasterizer: () => {
              throw new Error('no preview in this test');
            },
          },
          { input: socket, output: socket },
          signal,
          'the window',
        )),
    onConnections: (count) => counts.push(count),
  });
  endpoint = opened;
  await opened.start();
  const record = JSON.parse(
    await readFile(join(home, 'windows', `${String(process.pid)}.json`), 'utf8'),
  ) as WindowRecord;
  return {
    endpoint: opened,
    record,
    open: (next: string | null) => {
      open = next;
    },
  };
}

/** A raw client: writes `text` in one write, and collects every line the window answers. */
function client(at: string, text: string) {
  const socket = connectToEndpoint(at);
  if (socket === undefined) throw new Error(`no endpoint a client can reach: ${at}`);
  const lines: string[] = [];
  let buffered = '';
  const waiters: { count: number; resolve: () => void }[] = [];
  socket.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      lines.push(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
    }
    for (const waiter of waiters) if (lines.length >= waiter.count) waiter.resolve();
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.once('connect', () => socket.write(text));
  const lineCount = (count: number) =>
    new Promise<void>((resolve) => {
      if (lines.length >= count) resolve();
      else waiters.push({ count, resolve });
    });
  return { socket, lines, closed, lineCount };
}

const hello = (token: string): string =>
  `${JSON.stringify({ tyto: 'window', version: 1, token })}\n`;

const initialize = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
})}\n`;

describe('the agent endpoint', () => {
  it('writes a record a relay can read, with a fresh token and the open folder', async () => {
    const { record } = await started();
    expect(record).toMatchObject({ version: 1, pid: process.pid, folder });
    expect(record.token).toMatch(/^[0-9a-f]{64}$/u);
    if (process.platform === 'win32') {
      expect(record.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:[1-9][0-9]*$/u);
    } else {
      // Owner only: the record, its folder and the socket (ADR 0180 decision 3).
      const mode = async (path: string) => (await stat(path)).mode & 0o777;
      expect(await mode(join(home, 'windows', `${String(process.pid)}.json`))).toBe(0o600);
      expect(await mode(join(home, 'windows'))).toBe(0o700);
      expect(await mode(record.endpoint)).toBe(0o600);
    }
  });

  it('answers a frame sent in the same write as the handshake', async () => {
    const { record } = await started();
    const agent = client(record.endpoint, `${hello(record.token)}${initialize}`);
    await agent.lineCount(2);

    expect(JSON.parse(agent.lines[0] ?? '')).toEqual({
      tyto: 'window',
      ok: true,
      pid: process.pid,
      folder,
    });
    expect(JSON.parse(agent.lines[1] ?? '')).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: 'tyto' } },
    });
    agent.socket.destroy();
  });

  it('gives a wrong token nothing before it closes: one refusal line, no pid, no folder, no frame', async () => {
    let served = 0;
    const { record } = await started(() => {
      served += 1;
      return Promise.resolve();
    });
    const agent = client(record.endpoint, `${hello('0'.repeat(64))}${initialize}`);
    await agent.closed;

    expect(agent.lines).toEqual([JSON.stringify({ tyto: 'window', ok: false })]);
    expect(served).toBe(0);
    expect(counts).toEqual([]);
  });

  it('refuses a browser: an HTTP request is a malformed first line, and nothing is served', async () => {
    let served = 0;
    const { record } = await started(() => {
      served += 1;
      return Promise.resolve();
    });
    const browser = client(
      record.endpoint,
      `POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\n\r\n${hello(record.token)}`,
    );
    await browser.closed;

    expect(browser.lines).toEqual([JSON.stringify({ tyto: 'window', ok: false })]);
    expect(served).toBe(0);
  });

  it.runIf(process.platform === 'win32')(
    "listens on loopback only: this machine's own network addresses are refused (ADR 0189)",
    async () => {
      const { record } = await started();
      const target = connectTargetOf(record.endpoint);
      if (target === undefined || 'path' in target) throw new Error('not a loopback port');
      const addresses = Object.values(networkInterfaces())
        .flat()
        .filter((entry) => entry !== undefined && entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry?.address ?? '');
      // A machine with no network address has nothing to probe; the output says which it had.
      process.stdout.write(`network addresses probed: ${addresses.join(', ') || 'none'}\n`);
      for (const address of addresses) {
        const answer = await new Promise<string>((resolve) => {
          const socket = connect(target.port, address);
          socket.once('connect', () => {
            socket.destroy();
            resolve('connected');
          });
          socket.once('error', (cause: NodeJS.ErrnoException) => resolve(cause.code ?? 'error'));
        });
        expect(answer, address).toBe('ECONNREFUSED');
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'keeps the record to its owner and SYSTEM: the records folder inherits nothing from TYTO_HOME',
    async () => {
      await started();
      const recordFile = join(home, 'windows', `${String(process.pid)}.json`);
      const acl = execFileSync('icacls', [recordFile], { encoding: 'utf8' });
      process.stdout.write(acl);
      const entries = acl
        .split(/\r?\n/u)
        .map((line) => line.replace(recordFile, '').trim())
        .filter((line) => line.includes(':('));
      expect(entries).toHaveLength(2);
      expect(entries.some((entry) => entry.startsWith('NT AUTHORITY\\SYSTEM:'))).toBe(true);
      const user = osUserName().toLowerCase();
      expect(entries.some((entry) => entry.toLowerCase().includes(`\\${user}:`))).toBe(true);
    },
  );

  it('counts the agents connected, and cuts them all', async () => {
    const { endpoint: opened, record } = await started();
    const agent = client(record.endpoint, `${hello(record.token)}${initialize}`);
    await agent.lineCount(2);
    expect(opened.connections()).toBe(1);

    opened.cut();
    await agent.closed;
    await expect.poll(() => counts).toEqual([1, 0]);
    expect(opened.connections()).toBe(0);
  });

  it('stops listening when switched off, cutting agents and removing the record, and listens again (agentsListen)', async () => {
    const { endpoint: opened, record } = await started();
    const recordFile = join(home, 'windows', `${String(process.pid)}.json`);
    const agent = client(record.endpoint, `${hello(record.token)}${initialize}`);
    await agent.lineCount(2);

    // What `agentsListen: false` does, applied live (ADR 0180 amendment).
    await opened.close();
    await agent.closed;
    await expect(stat(recordFile)).rejects.toThrow();
    const refused = await new Promise<string>((resolve) => {
      const socket = connectToEndpoint(record.endpoint);
      if (socket === undefined) {
        resolve('unreachable');
        return;
      }
      socket.once('connect', () => {
        socket.destroy();
        resolve('connected');
      });
      socket.once('error', (cause: NodeJS.ErrnoException) => resolve(cause.code ?? 'error'));
    });
    expect(refused).not.toBe('connected');

    // And back on: the same token, a fresh record. A socket keeps its path; a loopback port is
    // whichever the system gives this time.
    await opened.start();
    const again = JSON.parse(await readFile(recordFile, 'utf8')) as WindowRecord;
    expect(again.token).toBe(record.token);
    if (process.platform !== 'win32') expect(again.endpoint).toBe(record.endpoint);
    const second = client(again.endpoint, `${hello(again.token)}${initialize}`);
    await second.lineCount(2);
    second.socket.destroy();
  });

  it('writes the record again when the window opens another folder', async () => {
    const { endpoint: opened, open } = await started();
    open(null);
    await opened.folderChanged();
    const record = JSON.parse(
      await readFile(join(home, 'windows', `${String(process.pid)}.json`), 'utf8'),
    ) as WindowRecord;
    expect(record.folder).toBeNull();
  });

  it('removes its record when it closes', async () => {
    const { endpoint: opened } = await started();
    await opened.close();
    await expect(stat(join(home, 'windows', `${String(process.pid)}.json`))).rejects.toThrow();
  });

  it('serves tyto mcp --window: the relay finds it, and tools/list is answered', async () => {
    await started();
    const input = new PassThrough();
    const output = new PassThrough();
    const errors: string[] = [];
    const lines: string[] = [];
    let written = '';
    const answered = new Promise<void>((resolve) => {
      output.on('data', (chunk: Buffer) => {
        written += chunk.toString('utf8');
        let end: number;
        while ((end = written.indexOf('\n')) >= 0) {
          lines.push(written.slice(0, end));
          written = written.slice(end + 1);
        }
        if (lines.length >= 2) resolve();
      });
    });
    const exit = run(['mcp', '--window'], {
      version: '0.0.0-test',
      cwd: folder,
      home,
      console: { out: (text) => errors.push(text), err: (text) => errors.push(text) },
      rasterizer: () => {
        throw new Error('the relay renders nothing');
      },
      stdio: () => ({ input, output }),
    });
    input.write(initialize);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await answered;
    input.end();

    expect(await exit).toBe(0);
    const tools = (JSON.parse(lines[1] ?? '') as { result: { tools: { name: string }[] } }).result
      .tools;
    expect(tools.map((tool) => tool.name)).toContain('list_templates');
    expect(errors.join('')).toContain(`relaying to the window of ${folder}`);
  });
});
