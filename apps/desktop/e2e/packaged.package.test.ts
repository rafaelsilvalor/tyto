import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * The installer's app, launched.
 *
 * `window.desktop.test.ts` launches the folder this repository has on disk, which answers
 * every question about the app except the one an installer raises: whether what
 * `electron-builder` put inside `app.asar` is enough to start. Those are different programs.
 * The one on disk reaches a `node_modules` with 472 packages in it; the packaged one reaches
 * whatever the `files` list in `electron-builder.yml` chose to carry, and everything else
 * comes out of a bundle.
 *
 * **The gap is not theoretical and its symptom is silence.** `activateBuiltIns` resolves the
 * built-in template pack with `createRequire(...).resolve('@tyto/templates/package.json')` —
 * a resolver call, which a bundle cannot answer. Built without the two lines that re-include
 * that package, this app opens **no window at all**: the resolve throws inside the promise
 * `app.whenReady().then(start)` returns. Measured that way, and this is the measurement kept.
 *
 * The sentence that used to end there — *"nothing is listening for the rejection, and the
 * process sits there having logged nothing"* — was true when this file was written and stopped
 * being true twice since. TYTO-132 gave the rejection a listener that writes a line, and
 * TYTO-140 gave it a `.catch` that puts an error box on screen naming the folder that line is
 * in. **The observable this suite asserts has not changed**: no window is still no window, and
 * that is what makes the two re-included lines worth a packaged launch to prove. What changed
 * is that the failure is no longer silent.
 *
 * **Not part of `pnpm check`**, and not part of `test:desktop` either. It runs
 * `electron-builder --dir` first — a full package, ~23 s once the Electron zip is cached and
 * a ~100 MB download before that — so it sits behind `pnpm --filter @tyto/desktop
 * test:package`, the same arrangement `packages/raster` makes for its visual suite.
 *
 * `--dir` and not a real installer: an `.exe`, a `.dmg` and an `.AppImage` differ from the
 * unpacked folder only in how the same `app.asar` is wrapped for delivery, and installing
 * one is not something a test can undo.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(here, '..');
const built = join(projectDirectory, 'out', 'main', 'index.js');

/**
 * Where `--dir` leaves the runnable app, per platform.
 *
 * The folder carries the architecture on macOS (`mac-arm64`) and not on the others, and the
 * binary is named after `productName` everywhere except Linux, where `electron-builder.yml`
 * has to set `executableName` because the packager would otherwise use the npm package name.
 */
function packagedExecutable(): string {
  const release = join(projectDirectory, 'release');

  if (process.platform === 'win32') return join(release, 'win-unpacked', 'Tyto.exe');
  if (process.platform === 'linux') return join(release, 'linux-unpacked', 'tyto');

  const macDirectory = readdirSync(release).find((entry) => entry.startsWith('mac'));
  if (macDirectory === undefined) {
    throw new Error(
      `no mac* folder under ${release}; electron-builder left ${readdirSync(release)}`,
    );
  }
  return join(release, macDirectory, 'Tyto.app', 'Contents', 'MacOS', 'Tyto');
}

let app: ElectronApplication;
let page: Page;
let scratch: string;

/**
 * One installed plugin in a `TYTO_HOME` of this suite's own, **outside `app.asar`** (TYTO-48).
 *
 * The case only a packaged build can answer: the guest `plugin-guest.js` is inside the asar,
 * and the plugin's module is a plain file on the disk beside nothing of Tyto's. Both have to
 * load in one process on the bundled Node for the export to produce a `.txt`.
 */
function writeHome(home: string): void {
  const folder = join(home, 'plugins', 'texto');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'texto',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'texto', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerExporter({
    id: 'texto', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false,
    exportFrame: (scene, artwork, frame) => ({ ok: true, value: artwork.id + ' ' + frame.format, diagnostics: [] }),
  });
}
`,
  );
  writeCodeTemplate(home);
  writeSpy(home);
  const entry = { enabled: true, permissions: [], source: '.' };
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { texto: entry, cartaz: entry, espia: entry } }),
  );
}

/**
 * A plugin that tries to read a file beside the plugins folder, and says which Node it ran on
 * and what the read answered (TYTO-186, ADR 0050).
 */
function writeSpy(home: string): void {
  const secret = join(dirname(home), 'secret.txt');
  writeFileSync(secret, "not the plugin's");
  const folder = join(home, 'plugins', 'espia');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'espia',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'espia', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerExporter({
    id: 'espia', mime: 'text/plain', extension: 'spy', kinds: ['spy'], rasterized: false,
    exportFrame: () => import('node:fs').then((fs) => {
      try { fs.readFileSync(${JSON.stringify(secret)}); return 'read'; } catch (cause) { return cause.code; }
    }).then((code) => ({ ok: true, value: [process.version, process.execPath, code].join('|'), diagnostics: [] })),
  });
}
`,
  );
}

/**
 * An installed code template, outside `app.asar` too (TYTO-189, ADR 0048): its rect is 777
 * wide when it is built off Electron, on the bundled Node (ADR 0050), and 111 in Electron, so
 * the preview says where the packaged app ran it.
 */
function writeCodeTemplate(home: string): void {
  const folder = join(home, 'plugins', 'cartaz');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  mkdirSync(join(folder, 'templates', 'cartaz'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'cartaz',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'cartaz', type: 'module' }));
  writeFileSync(
    join(folder, 'templates', 'cartaz', 'manifest.yaml'),
    'name: cartaz\nversion: 1.0.0\nformats: [grid-1x1]\nslots: {}\n',
  );
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerTemplatePack({
    id: 'cartaz', templates: [], directory: 'templates',
    build: (template, context) => ({
      format: context.format,
      size: context.size,
      children: [{
        id: context.idPrefix + '.onde', kind: 'rect',
        size: { w: process.versions.electron === undefined ? 777 : 111, h: 10 }, radius: [0, 0, 0, 0],
        fill: { kind: 'solid', color: { r: 255, g: 89, b: 0, a: 1 } },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
        opacity: 1, blend: 'normal', visible: true, clip: false, effects: [],
      }],
    }),
  });
}
`,
  );
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:package\``,
    );
  }

  // Cleared rather than reused. An interrupted pack leaves `release/win-unpacked.tmp`
  // behind, and the next run dies renaming over it — `EPERM: operation not permitted,
  // rename '…win-unpacked.tmp' -> '…win-unpacked'`, observed once on Windows. A tag build
  // starts from a fresh checkout and never meets that; a developer running this twice does.
  rmSync(join(projectDirectory, 'release'), { recursive: true, force: true });

  // The CLI rather than the `build()` export, because the CLI is what `desktop.yml` runs and
  // the two do not take the same path: invoked as a program electron-builder reads pnpm out
  // of the environment, and called as a function it detects npm and walks the whole
  // dependency tree instead. Same `app.asar` either way, measured — but a test of what CI
  // does should run what CI runs.
  const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
  execFileSync(process.execPath, [cli, '--dir', '--publish', 'never'], {
    cwd: projectDirectory,
    stdio: 'inherit',
  });

  scratch = mkdtempSync(join(tmpdir(), 'tyto-packaged-'));
  writeHome(join(scratch, 'tyto-home'));

  app = await _electron.launch({
    executablePath: packagedExecutable(),
    // Its own data folder and its own `TYTO_HOME`, so the packaged app neither reads nor
    // writes the machine's (TYTO-150, TYTO-48).
    args: [`--user-data-dir=${join(scratch, 'user-data')}`],
    // The same flag `window.desktop.test.ts` uses.
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await app.firstWindow();
  // The editor and not the bridge (TYTO-175, TYTO-154's rule). `window.tyto` is put on the page
  // by the preload, before a line of the renderer has run, so waiting for it answered _is the
  // preload there_ and then handed a half-loaded window to `afterAll`, which quits it. That
  // quit reaching a page with no listener is a product question and ADR 0039 settled it; this
  // wait is what keeps the suite from asking it by accident. Measured on CI with the renderer
  // slowed by 2.5 s between the exit listener and the editor mount: see the PR for TYTO-175.
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the packaged app', () => {
  it('opens a window at all', () => {
    // Deliberately its own assertion rather than something the next test implies. This is
    // the shape the packaging failure takes: not a wrong answer, an app that never gets far
    // enough to be asked. Reading it as "no first window" instead of as a timeout inside a
    // longer test is the difference between a diagnosis and a flake.
    expect(app.windows()).toHaveLength(1);
  });

  it('finds the built-in template pack through the asar', async () => {
    // The same assertion `window.desktop.test.ts` makes about the unpackaged app, against
    // the medium that can break it. `builtInTemplatesDirectory()` resolves
    // `@tyto/templates/package.json` and the registry then reads `templates/` off the same
    // folder; inside `app.asar` both go through Electron's patched resolver and patched
    // `fs`, which is the arrangement `plugins.ts` says it is built for and which nothing
    // else measures.
    const info = await page.evaluate(() =>
      (
        globalThis as never as {
          tyto: { 'app:info': (request: object) => Promise<{ templates: string[] }> };
        }
      ).tyto['app:info']({}),
    );

    expect(info.templates).toEqual([
      'agenda-semana',
      'aprovados',
      'carrossel-lista',
      'promo-curso',
      'simulados-semana-ec',
      'simulados-semana-ecj',
      'simulados-semana-oab',
      'tabela-ec',
    ]);
  });

  it('reports its own version, which is the one the tag has to name', async () => {
    // `desktop.yml` refuses a `desktop-v*` tag that does not match this string, so a build
    // whose `app.getVersion()` had fallen back to Electron's would be published under a tag
    // claiming otherwise. It fell back once already, before `package.json` had a `version`.
    const info = await page.evaluate(() =>
      (
        globalThis as never as {
          tyto: { 'app:info': (request: object) => Promise<{ version: string }> };
        }
      ).tyto['app:info']({}),
    );

    const packaged = createRequire(import.meta.url)('../package.json') as { version: string };
    expect(info.version).toBe(packaged.version);
  });

  it('runs an installed plugin that lives outside the asar, on the bundled Node', async () => {
    type Bridge = Record<string, (request: unknown) => Promise<unknown>>;
    const call = <T>(channel: string, request: unknown): Promise<T> =>
      page.evaluate(
        ([name, body]) => (globalThis as never as { tyto: Bridge }).tyto[name as string]!(body),
        [channel, request] as const,
      ) as Promise<T>;

    const { kinds } = await call<{ kinds: { kind: string }[] }>('export:kinds', {});
    expect(kinds.map((item) => item.kind)).toContain('txt');

    const out = join(scratch, 'out');
    const { exportId } = await call<{ exportId: string }>('export:start', {
      documentId: 'packaged',
      brief: ['---', 'template: promo-curso', '---', '::titulo Empacotado'].join('\n'),
      directory: out,
      outputs: [{ kind: 'txt' }],
    });
    const started = Date.now();
    for (;;) {
      const { progress } = await call<{ progress?: { status: string; failure?: string } }>(
        'export:progress',
        { exportId },
      );
      if (progress !== undefined && progress.status !== 'running') {
        expect(progress.failure).toBeUndefined();
        break;
      }
      if (Date.now() - started > 60_000) throw new Error('the packaged export never finished');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const texts = readdirSync(out).filter((name) => name.endsWith('.txt'));
    expect(texts.length).toBeGreaterThan(0);
    // Written straight to stdout, because the default reporter hides a passing test's
    // console, and this line is what a reviewer reads in `desktop`'s test:package step.
    process.stdout.write(
      `[TYTO-48] packaged app activated the installed plugin 'texto' from outside app.asar ` +
        `and exported ${String(texts.length)} .txt file(s)\n`,
    );
    expect(readFileSync(join(out, texts[0]!), 'utf8')).toMatch(/^\S+ \S+$/u);
  }, 120_000);

  it("renders an installed code template in its plugin's process on the bundled Node", async () => {
    type Bridge = Record<string, (request: unknown) => Promise<unknown>>;
    const preview = (): Promise<{ frames: { html: string }[]; diagnostics: unknown[] }> =>
      page.evaluate(
        (brief) =>
          (globalThis as never as { tyto: Bridge }).tyto['brief:preview']!({
            requestId: 1,
            documentId: 'packaged',
            brief,
          }) as Promise<{ frames: { html: string }[]; diagnostics: unknown[] }>,
        ['---', 'template: cartaz', 'formats: [grid-1x1]', '---', ''].join('\n'),
      );

    // The plugins start after the window opens (ADR 0044); until they have, `cartaz` is a
    // name nobody knows, so the preview is asked again until it draws.
    const started = Date.now();
    let answer = await preview();
    while (answer.frames.length === 0) {
      if (Date.now() - started > 60_000) {
        throw new Error(`cartaz never previewed: ${JSON.stringify(answer.diagnostics)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      answer = await preview();
    }

    const html = answer.frames[0]?.html ?? '';
    const width = html.includes('777') ? '777' : html.includes('111') ? '111' : 'neither';
    process.stdout.write(
      `[TYTO-189] packaged app rendered code template 'cartaz' through its plugin: ${width}\n`,
    );
    expect(answer.diagnostics).toEqual([]);
    expect(width).toBe('777');
  }, 120_000);

  it('confines a plugin to its folder, on the Node the package carries (ADR 0050)', async () => {
    type Bridge = Record<string, (request: unknown) => Promise<unknown>>;
    const call = <T>(channel: string, request: unknown): Promise<T> =>
      page.evaluate(
        ([name, body]) => (globalThis as never as { tyto: Bridge }).tyto[name as string]!(body),
        [channel, request] as const,
      ) as Promise<T>;

    const out = join(scratch, 'spy');
    const { exportId } = await call<{ exportId: string }>('export:start', {
      documentId: 'packaged',
      brief: ['---', 'template: promo-curso', '---', '::titulo Espia'].join('\n'),
      directory: out,
      outputs: [{ kind: 'spy' }],
    });
    const started = Date.now();
    for (;;) {
      const { progress } = await call<{ progress?: { status: string; failure?: string } }>(
        'export:progress',
        { exportId },
      );
      if (progress !== undefined && progress.status !== 'running') {
        expect(progress.failure).toBeUndefined();
        break;
      }
      if (Date.now() - started > 60_000) throw new Error('the spy export never finished');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [file] = readdirSync(out).filter((name) => name.endsWith('.spy'));
    const [version, execPath, code] = readFileSync(join(out, file!), 'utf8').split('|');
    const binary = process.platform === 'win32' ? 'node.exe' : 'node';
    process.stdout.write(
      `[TYTO-186] packaged guest on bundled node ${String(version)} at ${String(execPath)}: ` +
        `read outside grant → ${String(code)}\n`,
    );
    expect(code).toBe('ERR_ACCESS_DENIED');
    expect(execPath?.endsWith(join('resources', 'node', binary))).toBe(true);
  }, 120_000);
});
