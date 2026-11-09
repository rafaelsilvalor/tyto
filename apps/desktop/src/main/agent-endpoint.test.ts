import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { type Socket, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { type WindowRecord, run, serveAgent } from '@tyto/command-line';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AgentEndpoint, createAgentEndpoint } from './agent-endpoint.js';

/**
 * The window's endpoint (ADR 0180) with the real MCP server behind it: `serveAgent` from
 * `@tyto/command-line`, the code `tyto mcp` runs, over a real named pipe on Windows and a real
 * Unix socket elsewhere. The last test drives it through `tyto mcp --window` itself.
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
  const socket = connect(at);
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
      expect(record.endpoint).toBe(`\\\\.\\pipe\\tyto-test-${String(process.pid)}`);
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

  it('refuses a wrong token with no reason, closes, and serves nothing', async () => {
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
