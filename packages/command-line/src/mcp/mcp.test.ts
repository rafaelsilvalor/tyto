import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { RasterOptions, Rasterizer } from '@tyto/raster';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from '../environment.js';
import { EXIT_INTERNAL, EXIT_OK } from '../exit.js';
import { run } from '../program.js';
import { NO_STDIO } from './command.js';
import { MCP_TOOLS, PREVIEW_MAX_SIDE, toolsFor } from './tools.js';

import briefSource from '../__fixtures__/cartaz.brief?raw';
import formatsSource from '../__fixtures__/formats.yaml?raw';
import manifestSource from '../__fixtures__/cartaz.manifest.yaml?raw';
import markSource from '../__fixtures__/mark.svg?raw';
import templateMarkup from '../__fixtures__/cartaz.html?raw';

/**
 * `tyto mcp` driven through the protocol itself (ADR 0179): `run(['mcp'])` over two in-memory
 * streams, a JSON-RPC message per line written in and read out, as Claude Code or Claude Desktop
 * would. Every line the server writes is parsed, which is the test that stdout carries frames
 * and nothing else. SVG is real end to end; the PNG comes from a fake rasterizer, as in
 * `cli.test.ts`, because what is under test is what reaches the agent, not Chromium.
 */

const SECRET = 'S3CRET-SECTION-VALUE';
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let folder: string;
let out: string[];
let errors: string[];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tyto-mcp-'));
  out = [];
  errors = [];
  const template = join(folder, 'templates', 'cartaz');
  await mkdir(join(template, 'assets'), { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
  await writeFile(join(template, 'assets', 'mark.svg'), markSource);
  await writeFile(join(folder, 'formats.yaml'), formatsSource);
  await mkdir(join(folder, 'task', 'assets'), { recursive: true });
  await writeFile(join(folder, 'task', 'brief.brief'), briefSource);
  await writeFile(join(folder, 'task', 'assets', 'logo.png'), LOGO_PNG);
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

interface RasterCall {
  readonly options: RasterOptions;
}

interface FakeRasterizer extends Rasterizer {
  readonly calls: RasterCall[];
  closed: boolean;
  close(): Promise<void>;
}

/** A rasterizer that answers PNG-looking bytes, or waits for {@link gate} before it does. */
function fakeRasterizer(gate?: Promise<void>): FakeRasterizer {
  const fake: FakeRasterizer = {
    calls: [],
    closed: false,
    raster: async (_html, options) => {
      fake.calls.push({ options });
      if (gate !== undefined) await gate;
      return new TextEncoder().encode(`png:${String(options.width)}`);
    },
    close: () => {
      fake.closed = true;
      return Promise.resolve();
    },
  };
  return fake;
}

interface Message {
  readonly jsonrpc: string;
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: unknown;
}

/** A client over two in-memory streams: what an agent's MCP host is to `tyto mcp`. */
function connect(overrides: Partial<CliEnvironment> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  const waiting = new Map<number, (message: Message) => void>();
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
    let end: number;
    while ((end = written.indexOf('\n')) >= 0) {
      const line = written.slice(0, end);
      written = written.slice(end + 1);
      // Throws on anything that is not one JSON-RPC message: the stdout test, every frame.
      const message = JSON.parse(line) as Message;
      lines.push(line);
      expect(message.jsonrpc).toBe('2.0');
      if (message.id !== undefined) waiting.get(message.id)?.(message);
    }
  });
  const lines: string[] = [];
  const rasterizer = fakeRasterizer();
  const environment: CliEnvironment = {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: folder,
    rasterizer: () => rasterizer,
    stdio: () => ({ input, output }),
    ...overrides,
  };
  const exit = run(['mcp', ...(overrides.cwd === undefined ? [] : [folder])], environment);
  let next = 1;
  const send = (message: object): void => {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const request = (method: string, params: object = {}): Promise<Message> => {
    const id = next++;
    const answered = new Promise<Message>((resolve) => waiting.set(id, resolve));
    send({ id, method, params });
    return answered;
  };
  const start = async (): Promise<void> => {
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    send({ method: 'notifications/initialized' });
  };
  const call = async (name: string, args: object = {}) => {
    const answer = await request('tools/call', { name, arguments: args });
    return answer.result as {
      content: { type: string; text?: string; data?: string; mimeType?: string }[];
      isError?: boolean;
    };
  };
  const stop = async (): Promise<number> => {
    input.end();
    return exit;
  };
  return { send, request, start, call, stop, lines, rasterizer, nextId: () => next };
}

const textOf = (result: { content: { type: string; text?: string }[] }): string =>
  result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');

async function restrictedWorkspace(): Promise<void> {
  await mkdir(join(folder, '.tyto', 'plugin-files'), { recursive: true });
  await writeFile(
    join(folder, '.tyto', 'project.json'),
    JSON.stringify({ sections: { someplugin: { token: SECRET } } }),
  );
}

describe('tyto mcp', () => {
  it('without a stdio port, fails as an internal failure and says why', async () => {
    const { stdio: _none, ...environment } = {
      console: { out: (text: string) => out.push(text), err: (text: string) => errors.push(text) },
      version: '0.0.0-test',
      cwd: folder,
      rasterizer: () => fakeRasterizer(),
      stdio: undefined,
    };
    expect(await run(['mcp'], environment)).toBe(EXIT_INTERNAL);
    expect(errors.join('')).toBe(NO_STDIO);
  });

  it('offers the read tools in a restricted folder, withholds its plugin files, and prints nothing but frames', async () => {
    await restrictedWorkspace();
    const client = connect();
    await client.start();
    const listed = await client.request('tools/list');
    const names = (listed.result?.['tools'] as { name: string }[]).map((tool) => tool.name);
    expect(names.sort()).toEqual(toolsFor('restricted').slice().sort());
    await client.call('list_templates');
    expect(await client.stop()).toBe(EXIT_OK);

    expect(errors.join('')).toContain('was not loaded: this folder is restricted');
    expect(errors.join('')).toContain('workspace restricted');
    // The console's `out` is stdout in a terminal: nothing may reach it while the protocol runs.
    expect(out).toEqual([]);
    expect(client.lines.join('\n')).not.toContain(SECRET);
  }, 30_000);

  it('serves the folder it is given, wherever it was started', async () => {
    const client = connect({ cwd: tmpdir() });
    await client.start();
    const checked = await client.call('check_brief', { path: 'task/brief.brief' });
    expect(checked.isError).toBeUndefined();
    await client.stop();
    expect(errors.join('')).toContain(`(${folder})`);
  }, 30_000);

  it('lists templates and describes one, with its skeleton', async () => {
    const client = connect();
    await client.start();
    const templates = JSON.parse(textOf(await client.call('list_templates'))) as { name: string }[];
    expect(templates.map((template) => template.name)).toContain('cartaz');

    const described = JSON.parse(
      textOf(await client.call('describe_template', { name: 'cartaz' })),
    ) as {
      formats: { id: string; w: number }[];
      skeleton: string;
    };
    expect(described.formats).toContainEqual({ id: 'feed', w: 1080, h: 1080 });
    expect(described.skeleton).toContain('template: cartaz');

    const unknown = await client.call('describe_template', { name: 'nope' });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('nope');
    await client.stop();
  }, 30_000);

  it('checks a brief by path, and one handed over as text, with lines and columns', async () => {
    const client = connect();
    await client.start();

    const clean = JSON.parse(
      textOf(await client.call('check_brief', { path: 'task/brief.brief' })),
    ) as {
      status: string;
      diagnostics: { code: string; severity: string }[];
    };
    // Filtered by severity: a machine without a face adds warnings CI does not (AGENTS.md).
    expect(clean.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(clean.status).toBe('ok');

    const broken = await client.call('check_brief', {
      text: '---\ntemplate: cartaz\nformats: [feed]\ncor: verde\n---\n::slide\n  Um\n',
    });
    expect(broken.isError).toBe(true);
    const document = JSON.parse(textOf(broken)) as {
      diagnostics: { code: string; severity: string; line?: number; path?: string }[];
    };
    const error = document.diagnostics.find((item) => item.severity === 'error');
    expect(error?.path).toBe('<inline brief>');
    expect(error?.line).toBe(4);

    const neither = await client.call('check_brief', {});
    expect(textOf(neither)).toBe('give exactly one of path and text');
    // The check ran no browser.
    expect(client.rasterizer.calls).toEqual([]);
    await client.stop();
  }, 30_000);

  it('refuses a path outside the folder and its workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'tyto-mcp-outside-'));
    try {
      await writeFile(join(outside, 'other.brief'), briefSource);
      const client = connect();
      await client.start();
      // A junction inside the folder that leads out of it: refused as where it leads.
      await symlink(outside, join(folder, 'linked'), 'junction');
      for (const path of [
        join(outside, 'other.brief'),
        join('..', outside.split(/[\\/]/u).pop() ?? '', 'other.brief'),
        // Missing and outside answers as outside: a different sentence would say what exists.
        join(outside, 'missing.brief'),
        join('linked', 'other.brief'),
      ]) {
        const refused = await client.call('check_brief', { path });
        expect(refused.isError, path).toBe(true);
        expect(textOf(refused), path).toContain('is outside the folder tyto mcp was started in');
      }
      await client.stop();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 30_000);

  it('previews one format as PNG images no larger than the ceiling, and closes the browser', async () => {
    const client = connect();
    await client.start();
    const preview = await client.call('render_preview', {
      path: 'task/brief.brief',
      format: 'feed',
    });
    const images = preview.content.filter((item) => item.type === 'image');
    expect(images).toHaveLength(2);
    expect(images.every((image) => image.mimeType === 'image/png')).toBe(true);
    expect(Buffer.from(images[0]?.data ?? '', 'base64').toString('utf8')).toBe('png:1080');
    for (const { options } of client.rasterizer.calls) {
      const side = Math.max(options.width, options.height) * (options.scale ?? 1);
      expect(side).toBeLessThanOrEqual(PREVIEW_MAX_SIDE);
    }
    expect(client.rasterizer.calls.length).toBe(2);

    const unknown = await client.call('render_preview', {
      path: 'task/brief.brief',
      format: 'nope',
    });
    expect(textOf(unknown)).toContain("no format 'nope'");
    await client.stop();
    expect(client.rasterizer.closed).toBe(true);
  }, 30_000);

  /**
   * Starts a preview whose first frame waits, cancels it or not, lets the frame finish, and
   * counts the frames rastered once the job has had time to start the next.
   */
  async function framesRastered(cancel: boolean): Promise<number> {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rasterizer = fakeRasterizer(gate);
    const client = connect({ rasterizer: () => rasterizer });
    await client.start();
    const id = client.nextId();
    client.send({
      id,
      method: 'tools/call',
      params: { name: 'render_preview', arguments: { path: 'task/brief.brief', format: 'feed' } },
    });
    await expect.poll(() => rasterizer.calls.length).toBe(1);
    if (cancel) client.send({ method: 'notifications/cancelled', params: { requestId: id } });
    // Let the cancellation land before the frame in flight finishes.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    // Room for the second frame to start, which the control arm shows it does.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const count = rasterizer.calls.length;
    await client.stop();
    return count;
  }

  it('stops rendering when the client cancels the call', async () => {
    // Two artworks, one rastered at a time: the second never starts once the call is cancelled.
    expect(await framesRastered(true)).toBe(1);
  }, 30_000);

  it('control: renders both artworks when nobody cancels', async () => {
    expect(await framesRastered(false)).toBe(2);
  }, 30_000);
});

/**
 * The images a brief cites stay inside the folder too (TYTO-652, ADR 0179 amendment). Written
 * as an escape (`../`, an absolute path) they were already refused; through a link inside the
 * folder they were read. Every escape answers as a missing file does, so the agent cannot tell
 * which files exist out there. A real link on every platform: a junction on Windows, which
 * needs no privilege, and a symlink elsewhere. A link that cannot be made fails the test.
 */
describe('images a brief cites', () => {
  async function imageErrors(image: string): Promise<{ check: string[]; preview: string[] }> {
    const client = connect();
    await client.start();
    const text = `---\ntemplate: cartaz\nformats: [feed]\nimagem: ${image}\n---\n::slide\n  Um\n`;
    const codesOf = async (name: string, args: object): Promise<string[]> => {
      const document = JSON.parse(textOf(await client.call(name, args))) as {
        diagnostics: { code: string; severity: string }[];
      };
      return document.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => item.code);
    };
    const check = await codesOf('check_brief', { text });
    const preview = await codesOf('render_preview', { text, format: 'feed' });
    await client.stop();
    return { check, preview };
  }

  it('are drawn from inside the folder, and refused as missing from outside it, links included', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'tyto-mcp-images-'));
    try {
      await writeFile(join(outside, 'secret.png'), LOGO_PNG);
      await writeFile(join(folder, 'inside.png'), LOGO_PNG);
      await symlink(
        outside,
        join(folder, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const climbed = join('..', basename(outside));

      // The control: an image inside the folder is drawn.
      expect(await imageErrors('inside.png')).toEqual({ check: [], preview: [] });

      const missing = { check: ['E_ASSET_NOT_FOUND'], preview: ['E_ASSET_NOT_FOUND'] };
      for (const [there, absent] of [
        [join(climbed, 'secret.png'), join(climbed, 'nothing.png')],
        [join(outside, 'secret.png'), join(outside, 'nothing.png')],
        [join('linked', 'secret.png'), join('linked', 'nothing.png')],
      ] as const) {
        // A file that is there and one that is not answer alike.
        expect(await imageErrors(there), there).toEqual(missing);
        expect(await imageErrors(absent), absent).toEqual(missing);
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('toolsFor', () => {
  const tools = [...MCP_TOOLS, { name: 'write_brief', access: 'write' as const }];

  it('offers a tool that writes only to a trusted workspace', () => {
    expect(toolsFor('restricted', tools)).not.toContain('write_brief');
    expect(toolsFor('trusted', tools)).toContain('write_brief');
  });

  it('offers every read tool either way', () => {
    for (const tool of MCP_TOOLS) {
      expect(toolsFor('restricted')).toContain(tool.name);
      expect(toolsFor('trusted')).toContain(tool.name);
    }
  });
});
