import { execFileSync } from 'node:child_process';
import {
  cpSync,
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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readPackedFile, swapWhitespaceByte } from './asar-patch.js';
import {
  type CdpApp,
  closeOverCdp,
  launchOverCdp,
  requestQuit,
  survivorsOf,
  waitForExit,
  windowPages,
} from './cdp-app.js';
import { probeLaunch } from './launch-probe.js';
import { killTree, probeRunAsNode } from './run-as-node-probe.js';

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
 * The folder carries the architecture on macOS (`mac-universal`) and not on the others, and the
 * binary is named after `productName` everywhere except Linux, where `electron-builder.yml`
 * has to set `executableName` because the packager would otherwise use the npm package name.
 */
function packagedExecutable(release = join(projectDirectory, 'release')): string {
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

let app: CdpApp | undefined;
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
  //
  // `--universal` on macOS because `--dir` alone ignores the `arch` the configuration gives the
  // `dmg`: electron-builder's `normalizeOptions` turns a bare `--dir` into one target for
  // `process.arch`, so without it this suite would test an arm64 app while the release ships a
  // universal one (TYTO-146). With it, the app launched below is the one the `dmg` carries,
  // and on an Intel runner the slice that starts is the x64 one.
  const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
  const architecture = process.platform === 'darwin' ? ['--universal'] : [];
  execFileSync(process.execPath, [cli, '--dir', ...architecture, '--publish', 'never'], {
    cwd: projectDirectory,
    stdio: 'inherit',
  });

  scratch = mkdtempSync(join(tmpdir(), 'tyto-packaged-'));
  writeHome(join(scratch, 'tyto-home'));

  // Over CDP and not `_electron.launch`, which needs the inspect fuse this build switches off
  // (TYTO-249, ADR 0067). Its own data folder and its own `TYTO_HOME`, so the packaged app
  // neither reads nor writes the machine's (TYTO-150, TYTO-48).
  app = await launchOverCdp(packagedExecutable(), {
    userData: join(scratch, 'user-data'),
    home: join(scratch, 'tyto-home'),
  });
  page = app.page;
  // `launchOverCdp` waits for the editor and not the bridge (TYTO-175, TYTO-154's rule).
  // `window.tyto` is put on the page by the preload, before a line of the renderer has run, so waiting for it answered _is the
  // preload there_ and then handed a half-loaded window to `afterAll`, which quits it. That
  // quit reaching a page with no listener is a product question and ADR 0039 settled it; this
  // wait is what keeps the suite from asking it by accident. Measured on CI with the renderer
  // slowed by 2.5 s between the exit listener and the editor mount: see the PR for TYTO-175.
});

afterAll(async () => {
  // Through the quit guard, which a dirty tab is shown to hold below; a clean window answers it
  // at once. `closeOverCdp` says why if it does not (TYTO-249).
  const ending = await closeOverCdp(app);
  if (app !== undefined) {
    process.stdout.write(
      `[TYTO-249] packaged app quit through Browser.close and the quit guard: ` +
        `${ending.ended}, code ${String(ending.ended === 'exited' ? ending.code : null)}, ` +
        `in ${String(ending.ms)} ms\n`,
    );
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe('the packaged app', () => {
  it('opens a window at all', () => {
    // Deliberately its own assertion rather than something the next test implies. This is
    // the shape the packaging failure takes: not a wrong answer, an app that never gets far
    // enough to be asked. Reading it as "no first window" instead of as a timeout inside a
    // longer test is the difference between a diagnosis and a flake.
    expect(windowPages(app!.browser)).toHaveLength(1);
  });

  it('carries both Mac architectures in the app and in its Node (TYTO-146)', () => {
    // **Read off the two Mach-O files the release depends on, on the machine that just opened
    // the app.** The app's own executable is what an Intel Mac starts; `resources/node/node`
    // is what runs its plugins, and the one file `@electron/universal` cannot join by itself.
    // `uname -m` says which slice the window above came from: `x86_64` on the Intel leg of
    // `desktop.yml`, `arm64` on the other. Printed on the other platforms too, so a log that
    // lacks the line is a suite that did not run rather than a platform that has no answer.
    if (process.platform !== 'darwin') {
      process.stdout.write(`[TYTO-146] ${process.platform}: one architecture, nothing to read\n`);
      return;
    }
    const executable = packagedExecutable();
    const node = join(dirname(dirname(executable)), 'Resources', 'node', 'node');
    const archs = (file: string): string =>
      execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim();
    const machine = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim();
    const appArchs = archs(executable);
    const nodeArchs = archs(node);
    process.stdout.write(
      `[TYTO-146] uname -m ${machine}; lipo -archs Tyto → "${appArchs}"; ` +
        `lipo -archs resources/node/node → "${nodeArchs}"\n`,
    );

    // Compared as sets: `lipo` lists slices in the order they were joined, which is not a fact
    // about what the file can run.
    const slices = (listed: string): string[] => listed.split(/\s+/u).sort();
    expect(slices(appArchs)).toEqual(['arm64', 'x86_64']);
    expect(slices(nodeArchs)).toEqual(['arm64', 'x86_64']);
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
      'banner-roxo',
      'carrossel-lista',
      'promo-curso',
      'simulados-semana-ocre',
      'simulados-semana-roxo',
      'simulados-semana-vinho',
      'tabela-roxo',
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
    // `Tyto.app/Contents/Resources` on macOS, capitalised; `resources` beside the binary on the
    // other two. Found by the first macOS run of this suite, the release gate's (TYTO-95).
    const resources = process.platform === 'darwin' ? 'Resources' : 'resources';
    expect(
      execPath?.endsWith(join(resources, 'node', binary)),
      `the guest ran on ${String(execPath)}, not on the Node the package carries`,
    ).toBe(true);
  }, 120_000);

  it('cannot be run as Node, and the probe that says so can see a Node (TYTO-193)', async () => {
    // **Three facts, and the packaged one alone would prove nothing.** A probe whose stdout was
    // never captured also prints no `1`. So the same `probeRunAsNode` first runs the Electron in
    // `node_modules`, which no fuse has touched and which must print `1`; the wire is then read
    // out of the packaged executable; and only then is the packaged answer worth reading.
    const control = await probeRunAsNode(createRequire(import.meta.url)('electron') as string, {
      userData: undefined,
      home: join(scratch, 'tyto-home'),
      deadlineMs: 15_000,
    });
    process.stdout.write(
      `[TYTO-193] control: unfused node_modules Electron run as Node printed 1 → ` +
        `${String(control.printedOne)} (${control.ended}, code ${String(control.code)})\n`,
    );

    const wire = await getCurrentFuseWire(packagedExecutable());
    const state = (fuse: FuseV1Options): string => {
      const value = wire[fuse] as unknown as number | undefined;
      return value === 48 ? 'off' : value === 49 ? 'on' : `0x${(value ?? 0).toString(16)}`;
    };
    // Every position the wire has, named where `@electron/fuses` knows the name: Electron 44's
    // wire is one longer than the eight it names, and a fuse nobody printed is one nobody reads.
    const named = Object.keys(wire)
      .filter((key) => key !== 'version')
      .map((key) => {
        const fuse = Number(key) as FuseV1Options;
        return `${FuseV1Options[fuse] ?? `fuse${key}`}=${state(fuse)}`;
      });
    process.stdout.write(`[TYTO-193] packaged fuse wire: ${named.join(' ')}\n`);

    // The wire decides which program is about to start, and so whether it gets the app's
    // isolating switches (see `appSwitches`). A wire that still says `on` gets none, so the
    // probe can print `1` and the assertion below says so, instead of a Node refusing a switch.
    //
    // A booted app never exits on its own, so the deadline is the whole cost of this line: short,
    // and the tree is killed at it.
    const packaged = await probeRunAsNode(packagedExecutable(), {
      userData:
        state(FuseV1Options.RunAsNode) === 'off' ? join(scratch, 'probe-packaged-data') : undefined,
      home: join(scratch, 'tyto-home'),
      deadlineMs: 15_000,
    });
    process.stdout.write(
      `[TYTO-193] ELECTRON_RUN_AS_NODE=1 <packaged exe> -e "console.log(1)" printed 1 → ` +
        `${String(packaged.printedOne)} (${packaged.ended}, code ${String(packaged.code)}, ` +
        `${String(packaged.stdoutBytes)} stdout bytes)\n`,
    );

    expect(control.printedOne).toBe(true);
    expect(state(FuseV1Options.RunAsNode)).toBe('off');
    expect(state(FuseV1Options.EnableNodeOptionsEnvironmentVariable)).toBe('off');
    // Off since TYTO-249: the suite drives the app over CDP, and the TYTO-249 test below shows
    // the switch it gated is ignored.
    expect(state(FuseV1Options.EnableNodeCliInspectArguments)).toBe('off');
    expect(packaged.printedOne).toBe(false);
    // Still running at the deadline means it booted as the app. A Node exits at once, with or
    // without its `1`, so this is what tells "ignored the variable" from "never got to answer".
    expect(packaged.ended).toBe('killed');
  }, 60_000);

  it('carries the GitHub update feed and no local one (TYTO-131, ADR 0069)', () => {
    // **What `desktop.yml` packs is what this packs**: the same CLI over the same `out/`, with
    // no `extraMetadata`. `e2e/update.package.test.ts` bakes a loopback feed into its own two
    // builds through `extraMetadata.tytoUpdateFeed`, which lands in the packaged
    // `package.json` and nowhere else; so the field's absence here is the proof that an
    // ordinary build cannot carry one, and the URL in the bundle is the proof of where it
    // looks instead.
    const executable = packagedExecutable();
    const archive = readFileSync(
      process.platform === 'darwin'
        ? join(dirname(executable), '..', 'Resources', 'app.asar')
        : join(dirname(executable), 'resources', 'app.asar'),
    );
    const manifest = JSON.parse(readPackedFile(archive, 'package.json').toString('utf8')) as Record<
      string,
      unknown
    >;
    const bundle = readPackedFile(archive, 'out/main/index.js').toString('utf8');
    const feed = 'https://api.github.com/repos/rafaelsilvalor/tyto/releases?per_page=100';
    process.stdout.write(
      `[TYTO-131] packaged package.json tytoUpdateFeed=${JSON.stringify(manifest['tytoUpdateFeed'])}; ` +
        `main bundle names ${feed} → ${String(bundle.includes(feed))}
`,
    );

    expect(manifest).not.toHaveProperty('tytoUpdateFeed');
    expect(bundle).toContain(feed);
  });

  it('refuses a modified app.asar wherever electron-builder wrote its hash (TYTO-241)', async () => {
    // **The two fuses this card switched on, read off the wire first.** `OnlyLoadAppFromAsar`
    // has no test of its own: every test above ran with it on, and the TYTO-48, TYTO-189 and
    // TYTO-186 lines are what it could have broken, since `asarUnpack`, `extraResources` and
    // the bundled Node all sit outside the archive.
    const wire = await getCurrentFuseWire(packagedExecutable());
    const state = (fuse: FuseV1Options): string =>
      (wire[fuse] as unknown as number | undefined) === 49 ? 'on' : 'off';
    const integrity = state(FuseV1Options.EnableEmbeddedAsarIntegrityValidation);
    const asarOnly = state(FuseV1Options.OnlyLoadAppFromAsar);

    // **A copy, so the build the other tests use is never the one patched.** The app from
    // `beforeAll` still has the original archive open, and Windows will not always let it be
    // written; patching a copy also means nothing has to be put back for a later test.
    const release = join(projectDirectory, 'release');
    const copy = join(scratch, 'release-copy');
    cpSync(release, copy, { recursive: true, verbatimSymlinks: true });
    const executable = packagedExecutable(copy);
    const archive =
      process.platform === 'darwin'
        ? join(dirname(executable), '..', 'Resources', 'app.asar')
        : join(dirname(executable), 'resources', 'app.asar');

    // The positive control: the intact copy boots, so a refusal below is the patch's doing and
    // not the copy's.
    const intact = await probeLaunch(executable, {
      userData: join(scratch, 'integrity-intact-data'),
      home: join(scratch, 'tyto-home'),
      deadlineMs: 15_000,
    });

    const unpatched = readFileSync(archive);
    const patch = swapWhitespaceByte(unpatched, 'out/main/index.js');
    writeFileSync(archive, patch.bytes);
    const patched = await probeLaunch(executable, {
      userData: join(scratch, 'integrity-patched-data'),
      home: join(scratch, 'tyto-home'),
      deadlineMs: 15_000,
    });

    // Said rather than assumed: the archive the other tests launched is still byte for byte the
    // one electron-builder wrote.
    const untouched = readFileSync(join(release, relative(copy, archive))).equals(unpatched);
    process.stdout.write(
      `[TYTO-241] packaged fuses on ${process.platform}: ` +
        `EnableEmbeddedAsarIntegrityValidation=${integrity} OnlyLoadAppFromAsar=${asarOnly}\n` +
        `[TYTO-241] asar integrity on ${process.platform}: intact copy → ${intact.ended} ` +
        `(code ${String(intact.code)}); 1 whitespace byte of out/main/index.js swapped at ` +
        `archive offset ${String(patch.archiveOffset)} → ${patched.ended} ` +
        `(code ${String(patched.code)}, signal ${String(patched.signal)}); ` +
        `original release archive untouched → ${String(untouched)}\n` +
        `[TYTO-241] patched stderr tail: ${JSON.stringify(patched.stderrTail.slice(-400))}\n`,
    );

    expect(integrity).toBe('on');
    expect(asarOnly).toBe('on');
    expect(untouched).toBe(true);
    expect(intact.ended).toBe('killed');
    // **Linux is measured and printed, not asserted.** electron-builder 26 writes the hash
    // into the Windows executable's resources and the macOS `Info.plist`, and nowhere on
    // Linux, so there is nothing for Electron to check the archive against (ADR 0067).
    if (process.platform !== 'linux') {
      expect(patched.ended).toBe('exited');
      expect(patched.code).not.toBe(0);
    }
  }, 120_000);

  it('quits through the quit guard when the harness closes it over CDP (TYTO-249)', async () => {
    // **The harness's own quit, held by a dirty tab.** `afterAll` quits with this same
    // `requestQuit`, and a clean window lets it through at once. Without this test that exit
    // would prove nothing about the guard: a close that skipped it ends the app the same way.
    // A page's `window.close()` was measured to do exactly that. A second launch, so the app
    // the other tests use is never left holding a question.
    const dirty = await launchOverCdp(packagedExecutable(), {
      userData: join(scratch, 'guard-data'),
      home: join(scratch, 'tyto-home'),
    });
    let ending: Awaited<ReturnType<typeof waitForExit>>;
    let markers: number;
    try {
      await dirty.page.click('#editor .cm-content');
      await dirty.page.keyboard.type('sujo');
      await dirty.page.waitForSelector('.tabs__dirty');
      markers = await dirty.page.locator('.tabs__dirty').count();
      await requestQuit(dirty);
      ending = await waitForExit(dirty, 5_000);
    } finally {
      // The box is up, in front of nobody: the process tree is ended here, and checked.
      killTree(dirty.child.pid);
      await dirty.browser.close().catch(() => {});
    }
    await dirty.exited;
    const left = await survivorsOf(dirty.child.pid);
    process.stdout.write(
      `[TYTO-249] packaged app, ${String(markers)} unsaved tab(s), Browser.close → ` +
        `${ending.ended} at ${String(ending.ms)} ms` +
        `${ending.ended === 'exited' ? ` (code ${String(ending.code)})` : ''}; ` +
        `process group after the kill → ${JSON.stringify(left ?? 'not measured')}\n`,
    );

    expect(markers).toBe(1);
    expect(ending.ended).toBe('still running');
    if (left !== undefined) expect(left).toEqual([]);
  }, 120_000);

  it('ignores --inspect, and the probe that says so sees a debugger elsewhere (TYTO-249)', async () => {
    // **The positive control first, through the same probe.** The Electron in `node_modules`,
    // which no fuse has touched, started as this app with `--inspect=0`, must print Node's
    // `Debugger listening on`. Without that, a missing line in the packaged run below could be
    // a probe that never read stderr.
    const control = await probeLaunch(createRequire(import.meta.url)('electron') as string, {
      userData: join(scratch, 'inspect-control-data'),
      home: join(scratch, 'tyto-home'),
      deadlineMs: 15_000,
      before: ['--inspect=0'],
      after: [projectDirectory],
    });
    const packaged = await probeLaunch(packagedExecutable(), {
      userData: join(scratch, 'inspect-packaged-data'),
      home: join(scratch, 'tyto-home'),
      deadlineMs: 15_000,
      before: ['--inspect=0'],
    });

    const wire = await getCurrentFuseWire(packagedExecutable());
    const inspect =
      (wire[FuseV1Options.EnableNodeCliInspectArguments] as unknown as number) === 49
        ? 'on'
        : 'off';
    process.stdout.write(
      `[TYTO-249] packaged fuse EnableNodeCliInspectArguments=${inspect}\n` +
        `[TYTO-249] control: unfused node_modules Electron --inspect=0 printed "Debugger ` +
        `listening" → ${String(control.debuggerListening)} (${control.ended})\n` +
        `[TYTO-249] <packaged exe> --inspect=0 printed "Debugger listening" → ` +
        `${String(packaged.debuggerListening)} (${packaged.ended}, code ${String(packaged.code)})\n`,
    );

    expect(control.debuggerListening).toBe(true);
    expect(inspect).toBe('off');
    expect(packaged.debuggerListening).toBe(false);
    // Still running at the deadline: it booted as the app and ignored the switch, rather than
    // refusing to start, which would also print no line.
    expect(packaged.ended).toBe('killed');
  }, 120_000);
});
