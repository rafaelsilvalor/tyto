import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from '../environment.js';
import { run } from '../program.js';
import { serveAgent } from './command.js';
import type { BriefInFront, WindowActionAnswer, WindowPort } from './tools.js';

/**
 * The window's tools (ADR 0180) through the protocol, with a fake window behind `serveAgent`:
 * which tools a workspace of each trust is offered, what the reads answer, and that a path is
 * confined before the window is asked to open it. The window's own side — the box, the setting,
 * the renderer — is `apps/desktop`'s.
 */

let root: string;
let folder: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-window-tools-'));
  folder = join(root, 'project');
  home = join(root, 'home');
  await mkdir(join(folder, '.tyto'), { recursive: true });
  await writeFile(join(folder, '.tyto', 'project.json'), '{}\n');
  await writeFile(join(folder, 'a.brief'), '---\ntemplate: x\n---\n');
  await mkdir(home, { recursive: true });
  await writeFile(join(root, 'outside.brief'), 'secret\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const quiet = { out: () => {}, err: () => {} };

const environment = (): CliEnvironment => ({
  version: '0.0.0-test',
  cwd: folder,
  home,
  console: quiet,
  rasterizer: () => {
    throw new Error('no preview here');
  },
});

async function trust(): Promise<void> {
  const out: string[] = [];
  const code = await run(['trust', 'add', folder], {
    ...environment(),
    console: { out: (text) => out.push(text), err: (text) => out.push(text) },
    confirm: () => Promise.resolve(true),
  });
  expect(code, out.join('')).toBe(0);
}

interface FakeWindow extends WindowPort {
  readonly opened: string[];
  readonly shown: string[];
}

function fakeWindow(front: BriefInFront | undefined): FakeWindow {
  const opened: string[] = [];
  const shown: string[] = [];
  const done: WindowActionAnswer = { done: true };
  return {
    opened,
    shown,
    briefInFront: () => Promise.resolve(front),
    selection: () =>
      Promise.resolve({
        ranges: [{ from: { line: 2, column: 1 }, to: { line: 2, column: 9 }, text: 'template' }],
      }),
    openFile: (path) => {
      opened.push(path);
      return Promise.resolve(done);
    },
    showFormat: (format) => {
      shown.push(format);
      return Promise.resolve(format === 'feed' ? done : { done: false, reason: 'no such format' });
    },
  };
}

/** A client of `serveAgent` over two in-memory streams, as the window's connection is. */
async function connect(window: WindowPort) {
  const input = new PassThrough();
  const output = new PassThrough();
  const waiting = new Map<number, (message: { result: Record<string, unknown> }) => void>();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
    let end: number;
    while ((end = written.indexOf('\n')) >= 0) {
      const message = JSON.parse(written.slice(0, end)) as {
        id?: number;
        result: Record<string, unknown>;
      };
      written = written.slice(end + 1);
      if (message.id !== undefined) waiting.get(message.id)?.(message);
    }
  });
  const served = serveAgent(environment(), { input, output }, undefined, 'test', window);
  let next = 1;
  const request = (method: string, params: object = {}) => {
    const id = next++;
    const answered = new Promise<{ result: Record<string, unknown> }>((resolve) =>
      waiting.set(id, resolve),
    );
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answered;
  };
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = async (): Promise<string[]> =>
    ((await request('tools/list')).result['tools'] as { name: string }[]).map((tool) => tool.name);
  const call = async (name: string, args: object = {}) => {
    const { result } = await request('tools/call', { name, arguments: args });
    const [first] = result['content'] as { text: string }[];
    return { text: first?.text ?? '', isError: result['isError'] === true };
  };
  return {
    tools,
    call,
    close: async () => {
      input.end();
      await served;
    },
  };
}

const front = (path: string | null): BriefInFront => ({
  path,
  name: path === null ? null : 'a.brief',
  text: '---\ntemplate: x\n---\nunsaved typing\n',
  unsaved: true,
  kind: 'brief',
  format: 'feed',
});

describe('the window tools', () => {
  it('offers only the window reads in a restricted folder', async () => {
    const client = await connect(fakeWindow(front(join(folder, 'a.brief'))));
    const tools = await client.tools();
    expect(tools).toContain('brief_in_front');
    expect(tools).toContain('selection');
    expect(tools).not.toContain('open_file');
    expect(tools).not.toContain('show_format');
    await client.close();
  });

  it('offers the window actions in a trusted folder, and opens a confined path', async () => {
    await trust();
    const window = fakeWindow(front(join(folder, 'a.brief')));
    const client = await connect(window);
    expect(await client.tools()).toEqual(expect.arrayContaining(['open_file', 'show_format']));

    expect(await client.call('open_file', { path: 'a.brief' })).toEqual({
      text: 'done',
      isError: false,
    });
    const outside = await client.call('open_file', { path: join('..', 'outside.brief') });
    expect(outside.isError).toBe(true);
    expect(outside.text).toMatch(/outside the folder served/u);
    expect(window.opened).toHaveLength(1);
    expect(window.opened[0]?.toLowerCase()).toBe(join(folder, 'a.brief').toLowerCase());

    expect(await client.call('show_format', { format: 'feed' })).toEqual({
      text: 'done',
      isError: false,
    });
    expect(await client.call('show_format', { format: 'nope' })).toEqual({
      text: 'no such format',
      isError: true,
    });
    await client.close();
  });

  it('reads the brief in front, unsaved text included, and the selection', async () => {
    const client = await connect(fakeWindow(front(join(folder, 'a.brief'))));
    const answer = JSON.parse((await client.call('brief_in_front')).text) as BriefInFront;
    expect(answer.text).toContain('unsaved typing');
    expect(answer.unsaved).toBe(true);
    expect(answer.format).toBe('feed');
    const selected = JSON.parse((await client.call('selection')).text) as {
      ranges: { text: string }[];
    };
    expect(selected.ranges.map((range) => range.text)).toEqual(['template']);
    await client.close();
  });

  it('answers a brief in front outside the folder with its name only', async () => {
    const client = await connect(fakeWindow(front(join(root, 'outside.brief'))));
    const answer = await client.call('brief_in_front');
    expect(answer.text).not.toContain('unsaved typing');
    expect(JSON.parse(answer.text)).toMatchObject({ outside: true, path: null, text: null });
    expect((await client.call('selection')).isError).toBe(true);
    await client.close();
  });

  it('answers an untitled brief, which has no path to confine', async () => {
    const client = await connect(fakeWindow(front(null)));
    expect(JSON.parse((await client.call('brief_in_front')).text)).toMatchObject({
      path: null,
      text: expect.stringContaining('unsaved typing'),
    });
    await client.close();
  });

  it('says so when no document is in front', async () => {
    const client = await connect(fakeWindow(undefined));
    expect(await client.call('brief_in_front')).toEqual({
      text: 'no document is in front',
      isError: true,
    });
    await client.close();
  });
});
