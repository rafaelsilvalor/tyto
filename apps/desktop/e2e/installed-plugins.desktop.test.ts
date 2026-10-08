import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Installed plugins in a running app, each in a process of its own on the bundled Node, under
 * its permission model (TYTO-48, TYTO-186).
 *
 * **What only a running app can say.** The unit suites activate plugins in process with a fake
 * channel; this one starts real processes from the built `out/guest/plugin-guest.js` on
 * `out/node/` and walks the doors a person uses — the kinds the dialog offers, an export, the
 * queue, the plugins screen after a plugin's process has died, and what the runtime refuses a
 * plugin that reaches outside its folder.
 *
 * `TYTO_HOME` is a folder this suite writes and `--user-data-dir` keeps settings out of the
 * real ones (TYTO-150), so nothing here touches the machine's own `~/.tyto`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Do plugin'].join('\n');

/** The pin this app's Node is fetched from (`scripts/fetch-node.ts`, ADR 0050). */
const PINNED = (
  JSON.parse(readFileSync(join(here, '..', 'bundled-node.json'), 'utf8')) as { version: string }
).version;
const BUNDLED_NODE = join(
  here,
  '..',
  'out',
  'node',
  process.platform === 'win32' ? 'node.exe' : 'node',
);

let scratch: string;
let home: string;
let queueFolder: string;
let app: ElectronApplication;
let page: Page;

/** A plugin folder, installed and enabled, whose one exporter's frame is `body`. */
function install(
  name: string,
  id: string,
  kind: string,
  body: string,
  permissions: readonly string[] = [],
): void {
  const folder = join(home, 'plugins', name);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions,
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerExporter({
    id: ${JSON.stringify(id)}, mime: 'text/plain', extension: ${JSON.stringify(kind)},
    kinds: [${JSON.stringify(kind)}], rasterized: false,
    exportFrame: (scene, artwork, frame) => { ${body} },
  });
}
`,
  );
}

function writeHome(): void {
  install(
    'texto',
    'texto',
    'txt',
    `return { ok: true, value: artwork.id + ' ' + frame.format, diagnostics: [] };`,
  );
  // Registers a second `svg`, so it is refused wherever it is activated — which is how the
  // queue's host is seen to have activated it.
  install('vetor', 'svg', 'svg', `return { ok: true, value: '<svg/>', diagnostics: [] };`);
  // Ends its own process the first time it is asked for a frame.
  install('quebra', 'quebra', 'boom', 'process.exit(3);');
  // Tries to read a file beside the plugins folder, and says which Node it ran on.
  const secret = join(scratch, 'secret.txt');
  writeFileSync(secret, "not the plugin's");
  install(
    'espia',
    'espia',
    'spy',
    `return import('node:fs').then((fs) => { try { fs.readFileSync(${JSON.stringify(secret)}); return 'read'; } catch (cause) { return cause.code; } })` +
      `.then((code) => ({ ok: true, value: [process.version, process.execPath, code].join('|'), diagnostics: [] }));`,
  );
  // Writes what `host.credentials` answered — the value, or the refusal's code (TYTO-187).
  install(
    'chave',
    'chave',
    'key',
    `return host.credentials('api-token').then((value) => 'value:' + value, (cause) => 'refused:' + (cause.code ?? cause.message))` +
      `.then((value) => ({ ok: true, value, diagnostics: [] }));`,
    ['credentials:api-token'],
  );
  const entry = { enabled: true, permissions: [], source: '.' };
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({
      plugins: {
        texto: entry,
        vetor: entry,
        quebra: entry,
        espia: entry,
        chave: { ...entry, permissions: ['credentials:api-token'] },
      },
    }),
  );
}

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

/** A channel, called from the page through the preload — the renderer's own door. */
function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

interface Progress {
  readonly progress?: {
    readonly status: string;
    readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
    readonly failure?: string;
  };
}

/** Starts an export of `kind` into `directory` and waits for it to be over. */
async function exported(
  kind: string,
  directory: string,
): Promise<NonNullable<Progress['progress']>> {
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'e2e',
    brief: BRIEF,
    directory,
    outputs: [{ kind }],
  });
  const started = Date.now();
  for (;;) {
    const { progress } = await call<Progress>('export:progress', { exportId });
    if (progress !== undefined && progress.status !== 'running') return progress;
    if (Date.now() - started > 60_000) throw new Error(`export of ${kind} never finished`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-installed-plugins-'));
  home = join(scratch, 'tyto-home');
  queueFolder = join(scratch, 'fila');
  mkdirSync(queueFolder);
  writeHome();

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('installed plugins in the window', () => {
  it("offers an installed exporter's kind beside Tyto's", async () => {
    const { kinds } = await call<{ kinds: { kind: string }[] }>('export:kinds', {});
    expect(kinds.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['png', 'jpeg', 'webp', 'svg', 'txt', 'boom']),
    );
  });

  it('exports that kind from the window, drawn in the plugin’s own process', async () => {
    const out = join(scratch, 'export-txt');
    const progress = await exported('txt', out);

    expect(progress.failure).toBeUndefined();
    const texts = readdirSync(out).filter((name) => name.endsWith('.txt'));
    expect(texts.length).toBeGreaterThan(0);
    expect(readFileSync(join(out, texts[0]!), 'utf8')).toMatch(/^\S+ \S+$/u);
    // The impostor was activated too, and refused by name.
    expect(progress.diagnostics.map((item) => item.code)).toContain('W_PLUGIN_SKIPPED');
  }, 90_000);

  it("activates them in the queue's host: the refused one is named in the task's result", async () => {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, queueFolder);
    mkdirSync(join(queueFolder, 'inbox', 'tarefa'), { recursive: true });
    writeFileSync(join(queueFolder, 'inbox', 'tarefa', 'brief.brief'), BRIEF, 'utf8');
    await call('queue:set-folder', { choose: true });
    await call('queue:run', { taskId: 'tarefa' });

    const result = join(queueFolder, 'outbox', 'tarefa', 'out', 'result.json');
    const started = Date.now();
    while (!existsSync(result)) {
      if (Date.now() - started > 60_000) throw new Error(`${result} never appeared`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const document = JSON.parse(readFileSync(result, 'utf8')) as {
      diagnostics: { code: string; message: string }[];
    };
    // PNG only, by decision (ADR 0044, TYTO-188); what proves the activation is the refusal.
    expect(document.diagnostics.filter((item) => item.code === 'W_PLUGIN_SKIPPED')).toEqual([
      expect.objectContaining({ message: expect.stringContaining("Plugin 'vetor'") as unknown }),
    ]);
  }, 90_000);

  it('survives a plugin that ends its process, and the plugins screen says it crashed', async () => {
    const progress = await exported('boom', join(scratch, 'export-boom'));
    expect(progress.diagnostics.map((item) => item.code)).toContain('E_PLUGIN_CRASHED');

    // The window is still answering, and a kind from another plugin still exports.
    const again = await exported('txt', join(scratch, 'export-again'));
    expect(again.failure).toBeUndefined();

    const { plugins } = await call<{ plugins: { name: string; status: string }[] }>(
      'plugins:list',
      {},
    );
    expect(plugins.find((row) => row.name === 'quebra')?.status).toBe('crashed');
    expect(plugins.find((row) => row.name === 'texto')?.status).toBe('enabled');
  }, 120_000);
});

/**
 * A plugin's credential, typed into the plugins screen and read by the plugin (TYTO-187).
 *
 * The value is a test fixture's dummy and nothing else. What is measured is the route a person
 * takes — the File menu, the field, Save, Clear — and that the plugin's own process is what
 * reads it back, while the window only ever learns whether the key is set.
 */
describe('a credential set from the plugins screen', () => {
  const DUMMY = 'dummy-not-a-real-key-187';
  const line = '[data-plugin="chave"] .plugins__credential[data-key="api-token"]';

  /** What the plugin's exporter wrote: `value:<secret>` or `refused:<code>`. */
  async function answered(name: string): Promise<string> {
    const out = join(scratch, name);
    const progress = await exported('key', out);
    expect(progress.failure).toBeUndefined();
    const [file] = readdirSync(out).filter((entry) => entry.endsWith('.key'));
    return readFileSync(join(out, file!), 'utf8');
  }

  it('is read by the plugin once saved, never shown again, and missing once cleared', async () => {
    expect(await answered('key-before')).toBe('refused:E_CREDENTIAL_MISSING');

    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('plugins.show')?.click();
    });
    await page.waitForSelector(`${line}[data-set="false"]`);
    // Measured, not assumed: a machine with no keychain (a Linux runner with no session
    // keyring) has nothing to encrypt with, and there the app refuses rather than storing
    // plaintext (`credentials.ts`). That machine proves the refusal; one with a keychain proves
    // the whole route.
    const keychain = await app.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os',
    }));
    process.stdout.write(
      `[TYTO-187] safeStorage available=${String(keychain.available)} backend=${keychain.backend}\n`,
    );
    const file = join(
      scratch,
      'user-data',
      'credentials',
      `${encodeURIComponent('plugin:chave:api-token')}.bin`,
    );

    await page.fill(`${line} .plugins__credential-field`, DUMMY);
    await page.click(`${line} .plugins__credential-save`);

    if (!keychain.available) {
      await page.waitForSelector(`${line} .plugins__credential-failed`);
      expect(await page.getAttribute(line, 'data-set')).toBe('false');
      expect(existsSync(file)).toBe(false);
      expect(await answered('key-no-keychain')).toBe('refused:E_CREDENTIAL_MISSING');
      await page.click('.plugins__close');
      return;
    }
    await page.waitForSelector(`${line}[data-set="true"]`);

    // The window holds no copy: not in the field, not anywhere in the page, not in the list.
    expect(await page.inputValue(`${line} .plugins__credential-field`)).toBe('');
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(DUMMY);
    const listed = await call<unknown>('plugins:list', {});
    expect(JSON.stringify(listed)).not.toContain(DUMMY);
    // And the disk holds ciphertext, under the plugin's account.
    expect(readFileSync(file).toString('utf8')).not.toContain(DUMMY);

    expect(await answered('key-set')).toBe(`value:${DUMMY}`);

    await page.click(`${line} .plugins__credential-clear`);
    await page.waitForSelector(`${line}[data-set="false"]`);
    expect(await answered('key-cleared')).toBe('refused:E_CREDENTIAL_MISSING');
    await page.click('.plugins__close');
  }, 180_000);

  it('refuses, from the page, a key no installed plugin declares', async () => {
    const refusal = await page.evaluate(async () => {
      const bridge = (window as unknown as { tyto: Bridge }).tyto;
      try {
        await bridge['credentials:set']!({ plugin: 'texto', key: 'api-token', secret: 'x' });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(refusal).toContain("No installed plugin 'texto' declares credentials:api-token");
  });
});

describe('the Node installed plugins run on (ADR 0050)', () => {
  it('is pinned to exactly the Node this Electron embeds, and the binary is that version', async () => {
    // The drift test. Dependabot bumps Electron and never sees `bundled-node.json`; a bump
    // whose Node differs from the pin turns this red until the pin is moved with it.
    const embedded = await app.evaluate(() => process.versions.node);
    expect(PINNED).toBe(embedded);
    expect(execFileSync(BUNDLED_NODE, ['--version'], { encoding: 'utf8' }).trim()).toBe(
      `v${PINNED}`,
    );
  });

  it('confines a plugin to its own folder: a read outside it is refused by the runtime', async () => {
    const out = join(scratch, 'export-spy');
    const progress = await exported('spy', out);
    expect(progress.failure).toBeUndefined();
    const [file] = readdirSync(out).filter((name) => name.endsWith('.spy'));
    const [version, execPath, code] = readFileSync(join(out, file!), 'utf8').split('|');

    expect(version).toBe(`v${PINNED}`);
    expect(execPath).toBe(BUNDLED_NODE);
    expect(code).toBe('ERR_ACCESS_DENIED');
    process.stdout.write(
      `[TYTO-186] window guest on bundled node ${String(version)}: read outside grant → ${String(code)}\n`,
    );
  }, 90_000);
});
