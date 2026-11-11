import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';

import { ok } from '@tyto/core';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RasterOptions, Rasterizer } from '@tyto/raster';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from '../environment.js';
import { EXIT_INTERNAL, EXIT_OK } from '../exit.js';
import { run } from '../program.js';
import { workspaceOfFolder } from '../workspace.js';
import { NO_STDIO } from './command.js';
import { RECIPE_RUN_FIRST, openSession } from './session.js';
import { recordPath } from './window-endpoint.js';
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

/**
 * A restricted folder with a plugin section holding {@link SECRET}, under `plugins`, the key the
 * project file reads its sections from (ADR 0147). The loader withholds it there and says so with
 * `W_PROJECT_SECTIONS_WITHHELD`, which a test asserts, so the secret is known to be in play.
 */
async function restrictedWorkspace(): Promise<void> {
  await mkdir(join(folder, '.tyto', 'plugin-files'), { recursive: true });
  await writeFile(
    join(folder, '.tyto', 'project.json'),
    JSON.stringify({ plugins: { someplugin: { token: SECRET } } }),
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
    // The secret is in play: the workspace `tyto mcp` loads read the section and withheld it.
    // No tool reports project diagnostics, so the loader is asked directly.
    const workspace = await workspaceOfFolder(
      folder,
      {},
      {
        console: { out: () => {}, err: () => {} },
        version: '0.0.0-test',
        cwd: folder,
        rasterizer: () => fakeRasterizer(),
      },
      (path) => path,
    );
    expect(workspace?.loaded.trust).toBe('restricted');
    expect(workspace?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'W_PROJECT_SECTIONS_WITHHELD',
    );

    expect(errors.join('')).toContain('was not loaded: this folder is restricted');
    expect(errors.join('')).toContain('workspace restricted');
    expect(errors.join('')).not.toContain(SECRET);
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
    expect(toolsFor('restricted', {}, tools)).not.toContain('write_brief');
    expect(toolsFor('trusted', {}, tools)).toContain('write_brief');
  });

  it('offers window reads wherever a window serves, and window actions only when trusted (ADR 0180)', () => {
    const matrix = (['restricted', 'trusted'] as const).flatMap((trust) =>
      [false, true].map((window) => ({
        trust,
        window,
        tools: toolsFor(trust, { window }).filter((name) =>
          [
            'brief_in_front',
            'selection',
            'open_file',
            'show_format',
            'propose_edit',
            'proposal_status',
          ].includes(name),
        ),
      })),
    );
    expect(matrix).toEqual([
      { trust: 'restricted', window: false, tools: [] },
      { trust: 'restricted', window: true, tools: ['brief_in_front', 'selection'] },
      { trust: 'trusted', window: false, tools: [] },
      {
        trust: 'trusted',
        window: true,
        tools: [
          'brief_in_front',
          'selection',
          'open_file',
          'show_format',
          'propose_edit',
          'proposal_status',
        ],
      },
    ]);
  });

  it('offers every read tool either way', () => {
    for (const tool of MCP_TOOLS) {
      if (tool.access !== 'read') continue;
      expect(toolsFor('restricted')).toContain(tool.name);
      expect(toolsFor('trusted')).toContain(tool.name);
    }
  });
});

/**
 * The tools that write (ADR 0185), in a trusted workspace: the folder holds a project file that
 * names an output folder and a preset, and `trust add` trusted it in a home of the test's own.
 */
describe('the tools that write', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'tyto-mcp-home-'));
    await mkdir(join(folder, '.tyto'), { recursive: true });
    await writeFile(
      join(folder, '.tyto', 'project.json'),
      JSON.stringify({
        output: 'exports',
        exportPresets: { redes: { formats: ['feed'], types: ['svg'], folder: 'entregas' } },
      }),
    );
    const trusted = await run(['trust', 'add', folder], {
      console: { out: () => undefined, err: () => undefined },
      version: '0.0.0-test',
      cwd: folder,
      home,
      confirm: () => Promise.resolve(true),
      rasterizer: () => fakeRasterizer(),
    });
    expect(trusted).toBe(EXIT_OK);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const trustedClient = () => connect({ home });
  const answerOf = <T>(result: { content: { type: string; text?: string }[] }): T =>
    JSON.parse(textOf(result)) as T;

  interface Written {
    written: boolean;
    path: string;
    change: string;
    sha256: string | null;
    diff: string;
  }

  it('are offered in a trusted workspace, and only there', async () => {
    const client = trustedClient();
    await client.start();
    const listed = await client.request('tools/list');
    const tools = listed.result?.['tools'] as {
      name: string;
      annotations?: { destructiveHint?: boolean };
    }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual(toolsFor('trusted').slice().sort());
    expect(tools.find((tool) => tool.name === 'write_brief')?.annotations?.destructiveHint).toBe(
      true,
    );
    await client.stop();
    for (const name of ['write_brief', 'new_delivery', 'export', 'run_recipe']) {
      expect(toolsFor('restricted')).not.toContain(name);
    }
  }, 30_000);

  it('write a new brief, show a replacement before making it, and refuse a stale one', async () => {
    const client = trustedClient();
    await client.start();
    const created = answerOf<Written>(
      await client.call('write_brief', { path: 'nova/a.brief', text: 'titulo: Um\n' }),
    );
    expect(created).toMatchObject({ written: true, change: 'create', diff: '+titulo: Um' });
    expect(await readFile(join(folder, 'nova', 'a.brief'), 'utf8')).toBe('titulo: Um\n');

    // Replacing needs the file's hash, which a dry run answers, writing nothing.
    const blind = await client.call('write_brief', {
      path: 'nova/a.brief',
      text: 'titulo: Dois\n',
    });
    expect(blind.isError).toBe(true);
    expect(textOf(blind)).toContain('dry_run');
    const planned = answerOf<Written>(
      await client.call('write_brief', {
        path: 'nova/a.brief',
        text: 'titulo: Dois\n',
        dry_run: true,
      }),
    );
    expect(planned).toMatchObject({
      written: false,
      change: 'replace',
      sha256: created.sha256,
      diff: '-titulo: Um\n+titulo: Dois',
    });
    expect(await readFile(join(folder, 'nova', 'a.brief'), 'utf8')).toBe('titulo: Um\n');

    // Someone changes the file after the dry run: the hash no longer matches.
    await writeFile(join(folder, 'nova', 'a.brief'), 'titulo: Outro\n');
    const stale = await client.call('write_brief', {
      path: 'nova/a.brief',
      text: 'titulo: Dois\n',
      replace: planned.sha256,
    });
    expect(stale.isError).toBe(true);
    expect(textOf(stale)).toMatch(/^stale:/u);
    expect(await readFile(join(folder, 'nova', 'a.brief'), 'utf8')).toBe('titulo: Outro\n');

    const again = answerOf<Written>(
      await client.call('write_brief', {
        path: 'nova/a.brief',
        text: 'titulo: Dois\n',
        dry_run: true,
      }),
    );
    const replaced = answerOf<Written>(
      await client.call('write_brief', {
        path: 'nova/a.brief',
        text: 'titulo: Dois\n',
        replace: again.sha256,
      }),
    );
    expect(replaced).toMatchObject({ written: true, change: 'replace' });
    expect(await readFile(join(folder, 'nova', 'a.brief'), 'utf8')).toBe('titulo: Dois\n');
    // Nothing left beside it from the temporary write.
    expect(await readdir(join(folder, 'nova'))).toEqual(['a.brief']);
    await client.stop();
  }, 30_000);

  it('write only a .brief, and only inside the folder, links included', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'tyto-mcp-write-out-'));
    try {
      await writeFile(join(outside, 'there.brief'), 'titulo: Fora\n');
      await symlink(
        outside,
        join(folder, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const client = trustedClient();
      await client.start();
      const escapes = [
        join('..', basename(outside), 'new.brief'),
        join(outside, 'new.brief'),
        join('linked', 'there.brief'),
        join('linked', 'new.brief'),
        join('linked', 'deeper', 'new.brief'),
      ];
      for (const path of ['.tyto/project.json', 'templates/cartaz/template.html', ...escapes]) {
        for (const dryRun of [true, false]) {
          const answer = await client.call('write_brief', {
            path,
            text: 'titulo: X\n',
            dry_run: dryRun,
          });
          expect(answer.isError, path).toBe(true);
          expect(textOf(answer), path).toContain(
            escapes.includes(path) ? 'is outside the folder' : 'writes only .brief',
          );
        }
      }
      await client.stop();
      expect(await readdir(outside)).toEqual(['there.brief']);
      expect(await readFile(join(outside, 'there.brief'), 'utf8')).toBe('titulo: Fora\n');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuse to replace a brief a window holds, and say what to do instead', async () => {
    await writeFile(join(folder, 'open.brief'), 'titulo: Aberto\n');
    const session = await openSession(
      {
        console: { out: () => undefined, err: () => undefined },
        version: '0.0.0-test',
        cwd: folder,
        home,
        rasterizer: () => fakeRasterizer(),
      },
      { heldOpen: () => Promise.resolve('a Tyto window has this brief open; propose the edit') },
    );
    try {
      const { sha256 } = await session.writeBrief({
        path: 'open.brief',
        text: 'titulo: Novo\n',
        dryRun: true,
      });
      await expect(
        session.writeBrief({ path: 'open.brief', text: 'titulo: Novo\n', replace: sha256 ?? '' }),
      ).rejects.toThrow('propose the edit');
      expect(await readFile(join(folder, 'open.brief'), 'utf8')).toBe('titulo: Aberto\n');
    } finally {
      await session.close();
    }
  }, 30_000);

  /** A live window's record: this test's own process id, so the pid is alive. */
  async function windowRecord(open: string | null): Promise<void> {
    await mkdir(join(home, 'windows'), { recursive: true });
    await writeFile(
      recordPath(home, process.pid, process.platform),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        endpoint: 'unused',
        folder: open,
        token: 'f'.repeat(32),
        startedAt: new Date().toISOString(),
      }),
    );
  }

  async function replaceWhileWindowHas(open: string | null): Promise<{
    replaced: { isError?: boolean; text: string };
    created: { isError?: boolean };
  }> {
    await writeFile(join(folder, 'open.brief'), 'titulo: Aberto\n');
    await windowRecord(open);
    const client = trustedClient();
    await client.start();
    const { sha256 } = answerOf<Written>(
      await client.call('write_brief', {
        path: 'open.brief',
        text: 'titulo: Novo\n',
        dry_run: true,
      }),
    );
    const replaced = await client.call('write_brief', {
      path: 'open.brief',
      text: 'titulo: Novo\n',
      replace: sha256,
    });
    const created = await client.call('write_brief', { path: 'fresh.brief', text: 'titulo: Um\n' });
    await client.stop();
    return { replaced: { ...replaced, text: textOf(replaced) }, created };
  }

  it('refuse to replace a brief in a folder a live window has open, and still create one', async () => {
    const { replaced, created } = await replaceWhileWindowHas(folder);
    expect(replaced.isError).toBe(true);
    expect(replaced.text).toContain('propose_edit');
    expect(await readFile(join(folder, 'open.brief'), 'utf8')).toBe('titulo: Aberto\n');
    expect(created.isError).toBeUndefined();
  }, 30_000);

  it('control: replace it when the live window has another folder open, or none', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'tyto-mcp-elsewhere-'));
    try {
      for (const open of [elsewhere, null]) {
        const { replaced } = await replaceWhileWindowHas(open);
        expect(replaced.isError, String(open)).toBeUndefined();
        expect(await readFile(join(folder, 'open.brief'), 'utf8')).toBe('titulo: Novo\n');
      }
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  }, 30_000);

  it("make a delivery from a template's skeleton, and never overwrite its brief", async () => {
    const client = trustedClient();
    await client.start();
    const planned = answerOf<{ made: boolean; brief: string; folders: string[] }>(
      await client.call('new_delivery', { name: 'TYTO-1', template: 'cartaz', dry_run: true }),
    );
    expect(planned.made).toBe(false);
    expect(planned.folders.length).toBeGreaterThan(0);
    await expect(readFile(join(folder, planned.brief), 'utf8')).rejects.toThrow();

    const made = answerOf<{ made: boolean; brief: string }>(
      await client.call('new_delivery', { name: 'TYTO-1', template: 'cartaz' }),
    );
    expect(made).toMatchObject({ made: true, brief: planned.brief });
    expect(await readFile(join(folder, made.brief), 'utf8')).toContain('template: cartaz');

    const twice = await client.call('new_delivery', { name: 'TYTO-1' });
    expect(twice.isError).toBe(true);
    await client.stop();
  }, 30_000);

  interface Exported {
    exported: boolean;
    folder: string;
    types: string[];
    files: string[];
  }

  it("export into the folder the workspace names, a preset's or the output, never the caller's", async () => {
    const client = trustedClient();
    await client.start();
    const dry = answerOf<Exported>(
      await client.call('export', { path: 'task/brief.brief', types: ['svg'], dry_run: true }),
    );
    expect(dry).toMatchObject({ exported: false, folder: 'exports', files: [] });
    await expect(readdir(join(folder, 'exports'))).rejects.toThrow();

    const toOutput = answerOf<Exported>(
      await client.call('export', { path: 'task/brief.brief', types: ['svg'] }),
    );
    expect(toOutput.exported).toBe(true);
    expect(toOutput.files).toHaveLength(2);
    for (const file of toOutput.files) await readFile(join(folder, 'exports', file));

    const toPreset = answerOf<Exported>(
      await client.call('export', { path: 'task/brief.brief', preset: 'redes' }),
    );
    expect(toPreset).toMatchObject({ exported: true, folder: 'entregas', types: ['svg'] });

    const mixed = await client.call('export', {
      path: 'task/brief.brief',
      preset: 'redes',
      types: ['png'],
    });
    expect(textOf(mixed)).toContain('decide their own');
    const unknown = await client.call('export', { path: 'task/brief.brief', preset: 'nope' });
    expect(textOf(unknown)).toContain('known: redes');
    const notDelivery = await client.call('export', { path: 'task/brief.brief', delivery: true });
    expect(textOf(notDelivery)).toContain('not the brief of a delivery');
    // A folder the caller names is not an argument the tool has: it is dropped.
    const named = await client.call('export', {
      path: 'task/brief.brief',
      types: ['svg'],
      out: 'elsewhere',
      dry_run: true,
    });
    expect(answerOf<Exported>(named).folder).toBe('exports');
    await client.stop();
  }, 30_000);

  /**
   * As `framesRastered` above, for an export to PNG in the output folder: three artworks, two
   * rastered at a time as `tyto render` does, so the third starts only if nobody cancelled.
   */
  async function framesExported(cancel: boolean): Promise<number> {
    await writeFile(
      join(folder, 'task', 'three.brief'),
      '---\ntemplate: cartaz\nformats: [feed]\n---\n::slide\n  Um\n::slide\n  Dois\n::slide\n  Tres\n',
    );
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rasterizer = fakeRasterizer(gate);
    const client = connect({ home, rasterizer: () => rasterizer });
    await client.start();
    const id = client.nextId();
    client.send({
      id,
      method: 'tools/call',
      params: {
        name: 'export',
        arguments: { path: 'task/three.brief', types: ['png'], formats: ['feed'] },
      },
    });
    await expect.poll(() => rasterizer.calls.length).toBe(2);
    if (cancel) client.send({ method: 'notifications/cancelled', params: { requestId: id } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const count = rasterizer.calls.length;
    await client.stop();
    return count;
  }

  it('stop exporting when the client cancels the call', async () => {
    expect(await framesExported(true)).toBe(2);
  }, 30_000);

  it('control: export every artwork when nobody cancels', async () => {
    expect(await framesExported(false)).toBe(3);
  }, 30_000);

  /**
   * `run_recipe` (ADR 0185, note of 2026-11-10). No generic verb starts a table, so the recipe
   * reads a neutral source, `demo.rows`, handed to the session as its recipe verbs; then
   * `compose` writes a column and `to-brief` plans one brief per row into the workspace
   * (ADR 0172), which only an apply writes.
   */
  const RECIPE = [
    'recipe lessons',
    // Applied on Run in the window; an agent's call only plans it (ADR 0170).
    'apply auto',
    'demo.rows',
    'compose title="Lesson {topic|trim}"',
    'to-brief template=cartaz into=../briefs name=key slots=slide:title',
    '',
  ].join('\n');

  const lesson = (key: string, topic: string) => ({
    key,
    values: { key, topic },
    provenance: { source: 'demo', id: key, fetchedAt: '2026-11-10T09:00:00.000Z' },
  });

  /** The neutral source, and every section a call of it was handed. */
  function demoVerbs() {
    const sections: unknown[] = [];
    const rows: RecipeVerbContribution = {
      id: 'demo.rows',
      kind: 'source',
      arguments: [],
      page: (request) => {
        sections.push(request.section);
        return Promise.resolve(
          ok({
            table: {
              columns: [
                { name: 'key', type: 'text', origin: 'demo' },
                { name: 'topic', type: 'text', origin: 'demo' },
              ],
              rows: [lesson('one', 'Openings'), lesson('two', 'Endings')],
            },
          }),
        );
      },
    };
    const contributions: RecipeContributions = {
      recipeVerbs: () => [rows],
      ownedRecipeVerbs: () => [{ plugin: 'someplugin', verb: rows }],
      recipeDerivations: () => [],
    };
    return { contributions, sections };
  }

  async function recipeWorkspace(): Promise<void> {
    // A section with a value no answer may carry (ADR 0179 decision 4).
    await writeFile(
      join(folder, '.tyto', 'project.json'),
      JSON.stringify({ output: 'exports', plugins: { someplugin: { token: SECRET } } }),
    );
    await mkdir(join(folder, 'recipes'), { recursive: true });
    await writeFile(join(folder, 'recipes', 'lessons.recipe'), RECIPE);
  }

  const recipeSession = (contributions: RecipeContributions) =>
    openSession(
      {
        console: { out: () => undefined, err: () => undefined },
        version: '0.0.0-test',
        cwd: folder,
        home,
        rasterizer: () => fakeRasterizer(),
      },
      { recipeContributions: contributions },
    );

  it('run a recipe and answer its table, writing nothing, and apply a plan only by the id the run showed', async () => {
    await recipeWorkspace();
    const demo = demoVerbs();
    const session = await recipeSession(demo.contributions);
    try {
      const ran = await session.runRecipe({ path: 'recipes/lessons.recipe' });
      if (!('cells' in ran)) throw new Error('a run answers its cells');
      // The source was handed its section, and no answer carries it.
      expect(demo.sections).toEqual([{ token: SECRET }]);
      expect(JSON.stringify(ran)).not.toContain(SECRET);
      expect(JSON.stringify(ran)).not.toContain('payload');
      expect(ran.applied).toBe(false);
      expect(ran.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok']);
      expect(ran.cells[1]?.table).toMatchObject({ total: 2, omitted: 0 });
      expect(ran.cells[1]?.table?.rows.map((row) => row.values['title'])).toEqual([
        'Lesson Openings',
        'Lesson Endings',
      ]);
      const plan = ran.cells[2]?.plan;
      expect(plan).toMatchObject({ applicable: true, count: 2 });
      expect(plan?.operations.map((operation) => operation.description)).toEqual([
        'briefs/one.brief: new',
        'briefs/two.brief: new',
      ]);
      const planId = plan?.id ?? -1;
      // The run planned the briefs and wrote none.
      await expect(readdir(join(folder, 'briefs'))).rejects.toThrow();

      // A plan id the run did not show is refused, and nothing is written.
      const wrong = await session.runRecipe({
        path: 'recipes/lessons.recipe',
        apply: { cell: 2, plan: planId + 100 },
      });
      expect(wrong).toMatchObject({ applied: false });
      await expect(readdir(join(folder, 'briefs'))).rejects.toThrow();

      const applied = await session.runRecipe({
        path: 'recipes/lessons.recipe',
        apply: { cell: 2, plan: planId },
      });
      expect(applied).toMatchObject({
        applied: true,
        cell: { applied: { operations: [{ status: 'applied' }, { status: 'applied' }] } },
      });
      expect((await readdir(join(folder, 'briefs'))).sort()).toEqual(['one.brief', 'two.brief']);

      // The same plan twice is refused: applied already.
      const again = await session.runRecipe({
        path: 'recipes/lessons.recipe',
        apply: { cell: 2, plan: planId },
      });
      expect(again).toMatchObject({ applied: false });
      expect(JSON.stringify(again)).toContain('applied already');
    } finally {
      await session.close();
    }
  }, 30_000);

  it('run only a .recipe inside the folder, and apply nothing no run of the session showed', async () => {
    await recipeWorkspace();
    const client = trustedClient();
    await client.start();
    const brief = await client.call('run_recipe', { path: 'task/brief.brief' });
    expect(brief.isError).toBe(true);
    expect(textOf(brief)).toContain('.recipe');
    const outside = await client.call('run_recipe', { path: '../elsewhere.recipe' });
    expect(outside.isError).toBe(true);
    const unseen = await client.call('run_recipe', {
      path: 'recipes/lessons.recipe',
      apply: { cell: 2, plan: 1 },
    });
    expect(unseen.isError).toBe(true);
    expect(textOf(unseen)).toBe(RECIPE_RUN_FIRST);
    // Over the protocol the verbs are the installed plugins', and none is installed here.
    const ran = await client.call('run_recipe', { path: 'recipes/lessons.recipe' });
    const unknown = JSON.parse(textOf(ran)) as { cells: { status: string }[] };
    expect(unknown.cells[0]?.status).toBe('failed');
    expect(textOf(ran)).toContain('demo.rows');
    await expect(readdir(join(folder, 'briefs'))).rejects.toThrow();
    await client.stop();
  }, 30_000);

  it('refuse to run a recipe in a folder nobody trusted, even when asked without the protocol', async () => {
    await recipeWorkspace();
    await run(['trust', 'remove', folder], {
      console: { out: () => undefined, err: () => undefined },
      version: '0.0.0-test',
      cwd: folder,
      home,
      confirm: () => Promise.resolve(true),
      rasterizer: () => fakeRasterizer(),
    });
    const demo = demoVerbs();
    const session = await recipeSession(demo.contributions);
    try {
      expect(session.trust).toBe('restricted');
      await expect(session.runRecipe({ path: 'recipes/lessons.recipe' })).rejects.toThrow(
        'trusted workspace',
      );
      expect(demo.sections).toEqual([]);
    } finally {
      await session.close();
    }
  }, 30_000);

  /**
   * TYTO-671, ADR 0193 decision 8: `call` plans against the workspace's list and the credential
   * in the environment, and an agent's apply sends nothing (ADR 0185).
   */
  it('plan a call against the list and the environment, and send nothing on apply', async () => {
    const TOKEN = 'tok-mcp-never-shown';
    await writeFile(
      join(folder, '.tyto', 'project.json'),
      JSON.stringify({ recipes: { call: { hosts: ['hooks.example.com'] } } }),
    );
    await mkdir(join(folder, 'recipes'), { recursive: true });
    const recipe = (host: string, token: string) =>
      [
        'recipe dispatch',
        'demo.rows',
        `call url=https://${host}/run token=${token} body={"key": "{key|}"}`,
        '',
      ].join('\n');
    await writeFile(join(folder, 'recipes', 'ok.recipe'), recipe('hooks.example.com', 'routine'));
    await writeFile(join(folder, 'recipes', 'host.recipe'), recipe('evil.example.net', 'routine'));
    await writeFile(join(folder, 'recipes', 'token.recipe'), recipe('hooks.example.com', 'other'));
    const fetched: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      fetched.push(args[0]);
      return Promise.reject(new Error('no network in this test'));
    };
    const session = await openSession(
      {
        console: { out: () => undefined, err: () => undefined },
        version: '0.0.0-test',
        cwd: folder,
        home,
        variables: { TYTO_RECIPE_CREDENTIAL_ROUTINE: TOKEN },
        rasterizer: () => fakeRasterizer(),
      },
      { recipeContributions: demoVerbs().contributions },
    );
    try {
      const ran = await session.runRecipe({ path: 'recipes/ok.recipe' });
      if (!('cells' in ran)) throw new Error('a run answers its cells');
      const plan = ran.cells[1]?.plan;
      expect(plan).toMatchObject({
        count: 2,
        target: 'requests to hooks.example.com (this host sends none)',
      });
      expect(JSON.stringify(ran)).not.toContain(TOKEN);

      const applied = await session.runRecipe({
        path: 'recipes/ok.recipe',
        apply: { cell: 1, plan: plan?.id ?? -1 },
      });
      expect(applied).toMatchObject({ applied: false });
      expect(JSON.stringify(applied)).toContain('this host sends no requests');
      expect(fetched).toEqual([]);

      for (const [path, said] of [
        ['recipes/host.recipe', 'recipes.call.hosts'],
        ['recipes/token.recipe', "no credential named 'other'"],
      ] as const) {
        const refused = await session.runRecipe({ path });
        if (!('cells' in refused)) throw new Error('a run answers its cells');
        expect(refused.cells[1]?.diagnostics.map(({ code }) => code)).toEqual(['E_RECIPE_CALL']);
        expect(JSON.stringify(refused.cells[1]?.diagnostics)).toContain(said);
      }
    } finally {
      globalThis.fetch = realFetch;
      await session.close();
    }
  }, 30_000);
});

/**
 * A template's own guide and examples (ADR 0186), as resources and in the `model_brief` prompt:
 * served for a trusted workspace's templates and the built-in pack's, withheld for a restricted
 * folder's own.
 */
describe('the guidance a template ships', () => {
  const GUIDE = '# cartaz\n\nOne slide per line of the copy.\n';
  const EXAMPLE = '---\ntemplate: cartaz\n---\n::slide\n  One\n';

  beforeEach(async () => {
    const template = join(folder, 'templates', 'cartaz');
    await writeFile(join(template, 'guide.md'), GUIDE);
    await mkdir(join(template, 'examples'), { recursive: true });
    await writeFile(join(template, 'examples', 'one.brief'), EXAMPLE);
  });

  interface ResourceList {
    resources: { uri: string }[];
  }
  interface ResourceRead {
    contents: { uri: string; text: string }[];
  }
  interface PromptAnswer {
    messages: { role: string; content: { type: string; text: string } }[];
  }

  async function trustedHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'tyto-mcp-home-'));
    await mkdir(join(folder, '.tyto'), { recursive: true });
    await writeFile(join(folder, '.tyto', 'project.json'), '{}');
    const trusted = await run(['trust', 'add', folder], {
      console: { out: () => undefined, err: () => undefined },
      version: '0.0.0-test',
      cwd: folder,
      home,
      confirm: () => Promise.resolve(true),
      rasterizer: () => fakeRasterizer(),
    });
    expect(trusted).toBe(EXIT_OK);
    return home;
  }

  it('serves the guide and examples of a trusted folder’s template, and puts them in the prompt', async () => {
    const home = await trustedHome();
    try {
      const client = connect({ home });
      await client.start();

      const listed = (await client.request('resources/list')).result as unknown as ResourceList;
      const uris = listed.resources.map((resource) => resource.uri);
      expect(uris).toContain('tyto://template/cartaz/guide');
      expect(uris).toContain('tyto://template/cartaz/examples/one.brief');

      const guide = (
        await client.request('resources/read', {
          uri: 'tyto://template/cartaz/guide',
        })
      ).result as unknown as ResourceRead;
      expect(guide.contents[0]?.text).toBe(GUIDE);
      const example = (
        await client.request('resources/read', {
          uri: 'tyto://template/cartaz/examples/one.brief',
        })
      ).result as unknown as ResourceRead;
      expect(example.contents[0]?.text).toBe(EXAMPLE);

      const prompt = (
        await client.request('prompts/get', {
          name: 'model_brief',
          arguments: { copy: 'COPY-TO-SHAPE', template: 'cartaz' },
        })
      ).result as unknown as PromptAnswer;
      const text = prompt.messages[0]?.content.text ?? '';
      expect(text).toContain('One slide per line of the copy.');
      expect(text).toContain('::slide\n  One');
      expect(text).toContain('template: cartaz');
      expect(text).toContain('COPY-TO-SHAPE');
      await client.stop();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);

  it('withholds them for a restricted folder’s own template, and says why', async () => {
    await restrictedWorkspace();
    const client = connect();
    await client.start();

    const listed = (await client.request('resources/list')).result as unknown as ResourceList;
    const uris = listed.resources.map((resource) => resource.uri);
    expect(uris.filter((uri) => uri.startsWith('tyto://template/cartaz/'))).toEqual([]);
    // The built-in pack is no text this folder supplies: its examples are still served.
    expect(uris.some((uri) => /^tyto:\/\/template\/[^/]+\/examples\//u.test(uri))).toBe(true);

    const read = await client.request('resources/read', { uri: 'tyto://template/cartaz/guide' });
    expect(read.result).toBeUndefined();
    expect(JSON.stringify(read.error)).toContain('restricted folder');

    const prompt = (
      await client.request('prompts/get', {
        name: 'model_brief',
        arguments: { copy: 'COPY', template: 'cartaz' },
      })
    ).result as unknown as PromptAnswer;
    const text = prompt.messages[0]?.content.text ?? '';
    expect(text).toContain('Not served: this template comes from a restricted folder');
    expect(text).not.toContain('One slide per line');
    expect(client.lines.join('\n')).not.toContain('One slide per line');
    expect(client.lines.join('\n')).not.toContain(SECRET);
    await client.stop();
  }, 30_000);

  it('lists the templates to choose from when the prompt names none', async () => {
    const client = connect();
    await client.start();
    const prompt = (
      await client.request('prompts/get', {
        name: 'model_brief',
        arguments: { copy: 'COPY' },
      })
    ).result as unknown as PromptAnswer;
    expect(prompt.messages[0]?.content.text).toContain('- cartaz — A template with no text');
    await client.stop();
  }, 30_000);
});
