import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scene } from '@tyto/core';
import { connectIsolatedPlugin, createPluginHost } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { pluginCapabilities } from './capabilities.js';
import { WINDOWS_REQUIRED_VARIABLES, pluginProcessLauncher } from './plugin-process.js';

/**
 * The child-process adapter, with real processes under Node's permission model (TYTO-48,
 * TYTO-186).
 *
 * The protocol's own rules are `@tyto/plugin-api`'s tests. What only a real process can say
 * is how it ends — an uncaught throw and an exit are crashes with a reason, and `close` is
 * not a crash at all — and what the runtime refuses it (ADR 0049).
 */

let root: string;
/** The plugin's folder: the one place its process may read. */
let folder: string;
/** A file beside the plugin's folder that its process must not be able to read. */
let secret: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-process-'));
  folder = join(root, 'texto');
  await mkdir(folder);
  secret = join(root, 'secret.txt');
  await writeFile(secret, "not the plugin's");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MANIFEST = {
  name: 'texto',
  version: '1.0.0',
  engine: '>=0.1',
  contributes: ['exporter'],
  permissions: [],
};

const SCENE: Scene = {
  version: 1,
  artworks: [{ id: 'capa', frames: [{ format: 'feed', size: { w: 1, h: 1 }, children: [] }] }],
  fonts: [],
  assets: [],
};

/** A plugin module on disk whose `exportFrame` body is `body`, after a `prelude` at the top. */
async function pluginWith(body: string, prelude = ''): Promise<string> {
  const entry = join(folder, 'index.js');
  await writeFile(
    entry,
    `${prelude}
export function activate(host) {
  host.registerExporter({
    id: 'texto', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false,
    exportFrame: (scene, artwork, frame) => { ${body} },
  });
}
`,
  );
  return entry;
}

interface ConnectOptions {
  readonly permissions?: readonly string[];
  readonly deadlineMs?: number;
  readonly prelude?: string;
  /** The folder the process is told it is in: {@link folder} unless a test links to it. */
  readonly directory?: string;
  readonly flags?: (grants: readonly string[]) => string[];
}

async function connecting(body: string, crashes: string[] = [], options: ConnectOptions = {}) {
  const entry = await pluginWith(body, options.prelude);
  const directory = options.directory ?? folder;
  const launch = pluginProcessLauncher({
    guest: inject('pluginGuest'),
    ...(options.flags === undefined ? {} : { flags: options.flags }),
  });
  return connectIsolatedPlugin({
    name: 'texto',
    manifest: { ...MANIFEST, permissions: options.permissions ?? [] },
    channel: launch({ name: 'texto', entry: join(directory, 'index.js'), directory }),
    requireSandbox: true,
    onCrash: (reason) => crashes.push(reason),
    capabilities: pluginCapabilities({ TYTO_PLUGIN_TEXTO_API_TOKEN: 's3cret' }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  }).then((connected) => ({ connected, entry }));
}

async function connect(body: string, crashes: string[] = [], options: ConnectOptions = {}) {
  const { connected } = await connecting(body, crashes, options);
  if (!connected.ok) throw new Error(connected.error[0]?.message);
  const host = createPluginHost();
  host.tryActivate(connected.value.plugin);
  const exporter = host.registry.exporters.forKind('txt');
  if (exporter === undefined) throw new Error('no txt exporter');
  return { isolated: connected.value, exporter };
}

const ARTWORK = SCENE.artworks[0]!;
const FRAME = ARTWORK.frames[0]!;

describe('a plugin in a child process', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('answers from the process', async () => {
    const { isolated, exporter } = await connect(
      "return { ok: true, value: artwork.id + ' ' + frame.format, diagnostics: [] };",
    );
    expect(await exporter.exportFrame(SCENE, ARTWORK, FRAME)).toEqual({
      ok: true,
      value: 'capa feed',
      diagnostics: [],
    });
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('crashes with the message of an uncaught throw, and the host keeps answering', async () => {
    const crashes: string[] = [];
    const { isolated, exporter } = await connect(
      "setTimeout(() => { throw new Error('the ink ran out'); }); return new Promise(() => {});",
      crashes,
    );

    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? '' : answer.error[0]?.message).toBe(
      "Plugin 'texto' stopped running: the ink ran out.",
    );
    // The process is gone and the host is not: the next call answers at once, as data.
    const after = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(after.ok ? '' : after.error[0]?.code).toBe('E_PLUGIN_CRASHED');
    expect(crashes).toEqual(['the ink ran out']);
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is not a crash when the host closes it', async () => {
    const crashes: string[] = [];
    const { isolated } = await connect('return new Promise(() => {});', crashes);
    await isolated.close();
    expect(crashes).toEqual([]);
    expect(isolated.crashed()).toBeUndefined();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('closes a process that already ended at once, without referencing it again', async () => {
    // TYTO-232 references the child before waiting for its exit; a child that is already gone
    // has no exit left to wait for, so close must neither throw nor wait.
    const crashes: string[] = [];
    const { isolated, exporter } = await connect(
      "setTimeout(() => { throw new Error('gone'); }); return new Promise(() => {});",
      crashes,
    );
    await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(crashes).toEqual(['gone']);

    const outcome = await Promise.race([
      isolated.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2_000)),
    ]);

    expect(outcome).toBe('closed');
  }, 60_000);
});

/** A frame whose text is what the promise `expression` resolves to, or the code it threw. */
const answering = (expression: string): string =>
  `return (${expression}).then(` +
  `(value) => ({ ok: true, value: String(value), diagnostics: [] }), ` +
  `(cause) => ({ ok: true, value: String(cause.code) + ' ' + cause.message, diagnostics: [] }));`;

describe("a plugin in a child process, asking for the host's capabilities", () => {
  let server: Server;
  let requests: number;
  let base: string;

  beforeEach(async () => {
    requests = 0;
    server = createServer((_request, response) => {
      requests += 1;
      response.end('from the server');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('reaches a declared host through host.fetch', async () => {
    const { isolated, exporter } = await connect(
      answering(`host.fetch('${base}/').then((response) => response.text())`),
      [],
      { permissions: ['net:127.0.0.1'] },
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('from the server');
    expect(requests).toBe(1);
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('gets E_PERMISSION for an undeclared host, and the server hears nothing', async () => {
    const other = base.replace('127.0.0.1', 'localhost');
    const { isolated, exporter } = await connect(answering(`host.fetch('${other}/')`), [], {
      permissions: ['net:127.0.0.1'],
    });
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toMatch(
      /^E_PERMISSION Plugin 'texto' called 'host\.fetch to localhost/u,
    );
    expect(requests).toBe(0);
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('finds no global fetch to go around host.fetch with', async () => {
    const { isolated, exporter } = await connect(answering('Promise.resolve(typeof fetch)'));
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('undefined');
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('reads a declared credential from the environment, and only that one', async () => {
    const { isolated, exporter } = await connect(
      answering(
        `host.credentials('api-token').then((token) => ` +
          `host.credentials('other').then(() => token, (cause) => token + ' ' + cause.code))`,
      ),
      [],
      { permissions: ['credentials:api-token'] },
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('s3cret E_PERMISSION');
    await isolated.close();
  }, 60_000);
});

describe('a plugin stuck in a loop', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is ended at its deadline, and the host answers the frame and every one after', async () => {
    const crashes: string[] = [];
    const { isolated, exporter } = await connect('while (true) {}', crashes, { deadlineMs: 1_000 });

    const started = Date.now();
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? '' : answer.error[0]?.message).toBe(
      "Plugin 'texto' did not answer within 1 s, so its process was ended.",
    );
    // The loop never yields; the host's own thread is what kept the clock.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(crashes).toEqual(['it did not answer within 1 s']);

    const after = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(after.ok ? '' : after.error[0]?.code).toBe('E_PLUGIN_CRASHED');
    await isolated.close();
  }, 60_000);
});

/**
 * What the runtime refuses the plugin, not what a convention asks of it (ADR 0049). Every
 * frame's text is what the plugin's own attempt resolved to, or the code it was refused with.
 */
describe('a plugin under the permission model', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('reads its own folder, and is refused a file beside it with ERR_ACCESS_DENIED', async () => {
    await writeFile(join(folder, 'own.txt'), 'its own');
    const read = (path: string) =>
      `import('node:fs').then((fs) => fs.readFileSync(${JSON.stringify(path)}, 'utf8'))`;
    const { isolated, exporter } = await connect(
      answering(
        `${read(join(folder, 'own.txt'))}.then((own) => ${read(secret)}.then(() => own + ' and the secret', (cause) => own + ', ' + cause.code))`,
      ),
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('its own, ERR_ACCESS_DENIED');
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is refused writing, even inside its own folder', async () => {
    const { isolated, exporter } = await connect(
      answering(
        `import('node:fs').then((fs) => fs.writeFileSync(${JSON.stringify(join(folder, 'written.txt'))}, 'x'))`,
      ),
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toMatch(/^ERR_ACCESS_DENIED /u);
    expect(await readdir(folder)).not.toContain('written.txt');
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is refused a child process and a worker thread', async () => {
    const { isolated, exporter } = await connect(
      answering(
        `import('node:child_process').then((cp) => { try { cp.execFileSync(process.execPath, ['-v']); return 'spawned'; } catch (cause) { return cause.code; } })` +
          `.then((spawn) => import('node:worker_threads').then((wt) => { try { new wt.Worker('1', { eval: true }); return spawn + ' worker'; } catch (cause) { return spawn + ' ' + cause.code; } }))`,
      ),
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('ERR_ACCESS_DENIED ERR_ACCESS_DENIED');
    await isolated.close();
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it("sees none of the CLI's environment, so no other plugin's credential", async () => {
    process.env['TYTO_PLUGIN_OTHER_API_TOKEN'] = 'not yours';
    try {
      const { isolated, exporter } = await connect(
        answering(
          `Promise.resolve(Object.keys(process.env).map((key) => key.toUpperCase()).sort().join(','))`,
        ),
      );
      const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
      const seen = answer.ok
        ? answer.value.split(',').filter((key) => key !== '')
        : ['(no answer)'];
      // Nothing of the CLI's: on POSIX nothing at all, and on Windows only what libuv copies back
      // from the parent's own, which is fewer of them when the parent lacks some (under Turbo).
      const allowed = process.platform === 'win32' ? WINDOWS_REQUIRED_VARIABLES : [];
      expect(seen.filter((key) => !allowed.includes(key))).toEqual([]);
      expect(seen).not.toContain('TYTO_PLUGIN_OTHER_API_TOKEN');
      await isolated.close();
    } finally {
      delete process.env['TYTO_PLUGIN_OTHER_API_TOKEN'];
    }
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('reaches the network itself only where this Node cannot confine it (advisory below 25)', async () => {
    const server = createServer((_request, response) => response.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const { isolated, exporter } = await connect(
        answering(
          `import('node:net').then((net) => new Promise((resolve, reject) => { const socket = net.connect(${String(port)}, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve('connected'); }); socket.on('error', reject); }))`,
        ),
      );
      const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
      // No `net:` permission is declared and none is granted. Node 25 added `--allow-net`,
      // and without it the socket is refused; 22 and 24 have no network permission at all,
      // which is the gap ADR 0049 states rather than hides.
      const confinesTheNetwork = process.allowedNodeEnvironmentFlags.has('--allow-net');
      expect(answer.ok && answer.value).toMatch(
        confinesTheNetwork ? /^ERR_ACCESS_DENIED /u : /^connected$/u,
      );
      await isolated.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is refused before its code is imported when the runtime does not confine it', async () => {
    const marker = join(root, 'imported.txt');
    const { connected } = await connecting('return { ok: true, value: "", diagnostics: [] };', [], {
      // A runtime without the permission model, as a worker thread and utilityProcess
      // behave: the process starts with no flags, and its canary reads the file.
      flags: () => [],
      prelude: `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported');`,
    });
    expect(connected.ok ? [] : connected.error.map((problem) => problem.code)).toEqual([
      'E_PLUGIN_SANDBOX',
    ]);
    expect(connected.ok ? '' : connected.error[0]?.message).toMatch(
      /^Plugin 'texto' was not run: its process on Node v\d+\.\d+\.\d+ is not confined to its folder \(it could read a file outside its folder: it read .+\)\.$/u,
    );
    expect(await readdir(root)).not.toContain('imported.txt');
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('runs from a folder reached through a link, because every grant is a real path', async () => {
    // The macOS case: its temporary folder is under /var, a link to /private/var, and a grant
    // on the linked path refused the process its own entry file (ADR 0049).
    const linked = join(root, 'linked');
    await symlink(folder, linked, 'junction');
    const { isolated, exporter } = await connect(
      answering(
        `import('node:fs').then((fs) => fs.readFileSync(${JSON.stringify(secret)}, 'utf8'), (cause) => cause.code)`,
      ),
      [],
      { directory: linked },
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe(
      'ERR_ACCESS_DENIED Access to this API has been restricted. Use --allow-fs-read to manage permissions.',
    );
    await isolated.close();
  }, 60_000);
});
