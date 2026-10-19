import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { type Server, createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CdpApp, closeOverCdp, launchOverCdp } from './cdp-app.js';
import { killTree } from './run-as-node-probe.js';

/**
 * An installed copy finds a newer version and replaces itself (TYTO-131, ADR 0069).
 *
 * The card's criterion is "measured on at least one platform end to end, rather than by reading
 * the library's README", and this is that platform: **Linux, AppImage**, on the runner that
 * already runs `test:package`. Two versions are packaged from the same `out/` — `9.0.0` and
 * `9.0.1`, through electron-builder's `extraMetadata` — and the newer one is served from a
 * folder on loopback. Nothing is published: the older build learns where to look from an
 * `extraMetadata.tytoUpdateFeed` that only these two builds carry, and that
 * `packaged.package.test.ts` proves an ordinary build does not.
 *
 * Every step is the shipped code's: the service in `src/main/updates.ts` hands the folder to
 * electron-updater's `generic` provider, electron-updater downloads `Tyto-9.0.1.AppImage` and
 * checks its sha512 against `latest-linux.yml`, the window paints the notice, and the quit —
 * through `Browser.close` and the quit guard, the way a person's quit goes — is what installs.
 * The proof is the relaunch: the same file, started again, says it is `9.0.1`.
 *
 * **Not on Windows or macOS.** Windows Smart App Control refuses a freshly packaged `Tyto.exe`
 * on the maintainer's machine, and macOS only links (ADR 0069). The Windows installer path is
 * held by `src/main/updates.test.ts` and `update-feed.test.ts`, which is reading, not running —
 * the ADR says so.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(here, '..');
const built = join(projectDirectory, 'out', 'main', 'index.js');
const OLD = '9.0.0';
const NEW = '9.0.1';

const sha512 = (file: string): string =>
  createHash('sha512').update(readFileSync(file)).digest('base64');

let scratch: string;
let server: Server;
let feedUrl: string;
const served: string[] = [];
let installed: string;
let app: CdpApp | undefined;
let before: string;

/**
 * How long one build may take before its whole process group is killed. Under the 600 s hook
 * budget, so a hung build fails naming its version instead of timing the hook out and outliving
 * the file — which is what an output folder under `/proc` did on CI: electron-builder never
 * exited, and was still running after afterAll (TYTO-326).
 */
const BUILD_DEADLINE_MS = 420_000;

/**
 * Packages one AppImage of `version` into its own folder, and resolves to that file. Async so
 * the two builds can run side by side; a failed build rejects naming its version and exit code.
 * It settles only once electron-builder has exited, so nothing is still writing afterwards.
 */
function packageAppImage(version: string, output: string, extra: string[] = []): Promise<string> {
  const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
  return new Promise((resolve, reject) => {
    let overran = false;
    // `detached` makes the build its own process group, so the deadline's kill reaches
    // app-builder and mksquashfs under it too.
    const child = spawn(
      process.execPath,
      [
        cli,
        '--linux',
        'AppImage',
        '--publish',
        'never',
        `-c.extraMetadata.version=${version}`,
        `-c.directories.output=${output}`,
        ...extra,
      ],
      { cwd: projectDirectory, stdio: 'inherit', detached: true },
    );
    const deadline = setTimeout(() => {
      overran = true;
      killTree(child.pid);
    }, BUILD_DEADLINE_MS);
    child.once('error', (cause) => {
      clearTimeout(deadline);
      reject(new Error(`electron-builder for ${version} did not start: ${String(cause)}`));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(deadline);
      if (overran) {
        reject(
          new Error(
            `electron-builder for ${version} did not finish within ${String(BUILD_DEADLINE_MS)} ms and was killed`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `electron-builder for ${version} exited with code ${String(code)}, signal ${String(signal)}`,
          ),
        );
        return;
      }
      const image = readdirSync(output).find((entry) => entry.endsWith('.AppImage'));
      if (image === undefined) {
        reject(new Error(`no AppImage in ${output}: ${readdirSync(output).join(', ')}`));
        return;
      }
      resolve(join(output, image));
    });
  });
}

/** Resolves to what `build` resolves to, and how many milliseconds it took. */
async function timed(build: () => Promise<string>): Promise<{ file: string; ms: number }> {
  const start = performance.now();
  const file = await build();
  return { file, ms: Math.round(performance.now() - start) };
}

const launch = (name: string): Promise<CdpApp> =>
  launchOverCdp(installed, {
    userData: join(scratch, `${name}-data`),
    home: join(scratch, 'tyto-home'),
  });

const version = async (running: CdpApp): Promise<string> =>
  (
    await running.page.evaluate(() =>
      (
        globalThis as never as {
          tyto: { 'app:info': (request: object) => Promise<{ version: string }> };
        }
      ).tyto['app:info']({}),
    )
  ).version;

describe.runIf(process.platform === 'linux')('an installed AppImage updating itself', () => {
  // **The two AppImages are built at the same time** (TYTO-326). The feed URL is known before
  // either starts, and they share nothing they write: each unzips Electron into its own
  // output's `linux-unpacked`, and app-builder-lib locks the download cache it extracts from.
  // What they do share is the CPU — `mksquashfs` takes all 4 vCPU — so this saves less than one
  // build. Measured on CI, 5 `package` runs each, this file's time: one after the other
  // 42.3/62.8/62.8/63.2/65.6 s (median 62.8, builds 24–27 s each on 4 of 5 runners), together
  // 50.9/51.1/51.2/51.7/51.8 s (median 51.2, both builds ~37.5 s), no lock or extract error.
  beforeAll(async () => {
    if (!existsSync(built)) {
      throw new Error(`${built} is missing — run \`pnpm build\` before \`test:package\``);
    }
    scratch = mkdtempSync(join(tmpdir(), 'tyto-update-'));
    mkdirSync(join(scratch, 'tyto-home'));

    // The feed first, because its port goes into the old build.
    const feed = join(scratch, 'feed');
    server = createServer((request, response) => {
      const name = decodeURIComponent((request.url ?? '/').split('?')[0]!.slice(1));
      served.push(name);
      const file = join(feed, name);
      if (name.includes('/') || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200);
      createReadStream(file).pipe(response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    feedUrl = `http://127.0.0.1:${String(address.port)}/`;

    // The newer build is the feed: electron-builder writes `latest-linux.yml` beside it. The
    // older build is the "installed" copy, and further down it gets a name with no version in
    // it, so electron-updater replaces that file rather than writing a second one beside it.
    // Both start together (see the note above `beforeAll`). `allSettled`, so a failed build
    // never leaves the other one still writing into `scratch` while afterAll removes it.
    const bothStart = performance.now();
    const builds = await Promise.allSettled([
      timed(() => packageAppImage(NEW, feed)),
      timed(() =>
        packageAppImage(OLD, join(scratch, 'old'), [`-c.extraMetadata.tytoUpdateFeed=${feedUrl}`]),
      ),
    ]);
    const bothMs = Math.round(performance.now() - bothStart);
    const msOf = (index: number): string => {
      const settled = builds[index];
      return settled?.status === 'fulfilled' ? `${String(settled.value.ms)} ms` : 'failed';
    };
    process.stdout.write(
      `[TYTO-326] build ${NEW} ${msOf(0)}, ${OLD} ${msOf(1)}, both ${String(bothMs)} ms\n`,
    );
    for (const settled of builds) {
      if (settled.status === 'rejected') throw settled.reason;
    }
    const old = (builds[1] as PromiseFulfilledResult<{ file: string; ms: number }>).value.file;
    process.stdout.write(
      `[TYTO-131] feed ${feedUrl} serves: ${readdirSync(feed).join(', ')}\n` +
        `[TYTO-131] latest-linux.yml:\n${readFileSync(join(feed, 'latest-linux.yml'), 'utf8')}`,
    );

    mkdirSync(join(scratch, 'installed'));
    installed = join(scratch, 'installed', 'Tyto.AppImage');
    copyFileSync(old, installed);
    chmodSync(installed, 0o755);
    before = sha512(installed);

    // The runner has no FUSE for a type-2 AppImage to mount itself with; extracting and
    // running is the runtime's own fallback, and it still sets `APPIMAGE` to this file.
    process.env['APPIMAGE_EXTRACT_AND_RUN'] = '1';
  });

  afterAll(async () => {
    if (app !== undefined) {
      await closeOverCdp(app).catch(() => {
        killTree(app?.child.pid);
      });
    }
    await new Promise((resolve) => server?.close(resolve));
    delete process.env['APPIMAGE_EXTRACT_AND_RUN'];
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  });

  it(`downloads ${NEW} in the background and says so in the footer`, async () => {
    app = await launch('old');
    expect(await version(app)).toBe(OLD);

    const notice = app.page.locator('#update-notice[data-update-state="ready"]');
    await notice.waitFor({ state: 'visible', timeout: 180_000 });
    const text = await notice.textContent();

    // A picture of the real window for the PR: `desktop-e2e.yml` uploads `e2e/__diff__/`.
    mkdirSync(join(here, '__diff__'), { recursive: true });
    // A hidden window may never compose a frame (ADR 0033); the picture is a courtesy, so it
    // is bounded and its absence is printed rather than failed on.
    await app.page
      .screenshot({ path: join(here, '__diff__', 'update-notice.png'), timeout: 15_000 })
      .catch((cause: unknown) => {
        process.stdout.write(`[TYTO-131] no screenshot of the hidden window: ${String(cause)}
`);
      });

    process.stdout.write(
      `[TYTO-131] ${OLD} asked the feed for: ${served.join(', ')}\n` +
        `[TYTO-131] footer notice: ${JSON.stringify(text)}\n`,
    );
    expect(served).toContain('latest-linux.yml');
    expect(served).toContain(`Tyto-${NEW}.AppImage`);
    expect(text).toContain(NEW);
  }, 240_000);

  it(`installs on quit, and the same file then starts as ${NEW}`, async () => {
    // A longer deadline than a plain quit: the install runs inside it, and on this runner that
    // is the new AppImage extracting itself once with `APPIMAGE_EXIT_AFTER_INSTALL`.
    const ending = await closeOverCdp(app, 120_000);
    app = undefined;
    const after = sha512(installed);
    process.stdout.write(
      `[TYTO-131] quit: ${ending.ended}, code ${String(ending.ended === 'exited' ? ending.code : null)}, ${String(ending.ms)} ms\n` +
        `[TYTO-131] installed file sha512 before ${before.slice(0, 16)}… after ${after.slice(0, 16)}…\n`,
    );
    expect(after).not.toBe(before);

    app = await launch('new');
    const now = await version(app);
    process.stdout.write(`[TYTO-131] relaunched ${installed}: app:info version ${now}\n`);
    expect(now).toBe(NEW);
  }, 240_000);
});

describe.runIf(process.platform !== 'linux')('an installed copy updating itself', () => {
  it('is measured on Linux only', () => {
    process.stdout.write(
      `[TYTO-131] update e2e skipped on ${process.platform}: it packages AppImages (ADR 0069)\n`,
    );
  });
});
