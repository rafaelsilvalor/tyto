import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  app = await _electron.launch({
    executablePath: packagedExecutable(),
    // The same flag `window.desktop.test.ts` uses, and the only thing either suite changes
    // about the app it is testing.
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => (globalThis as Record<string, unknown>)['tyto'] !== undefined);
});

afterAll(async () => {
  await closeApp(app);
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

    expect(info.templates).toEqual(['agenda-semana', 'carrossel-lista', 'promo-curso']);
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
});
