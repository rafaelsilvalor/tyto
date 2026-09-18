import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `import type`, for the reason `ipc.ts` states at its own first line: under
// `verbatimModuleSyntax` an inline `{ type … }` still emits `import {} from 'electron'`,
// and this module has unit tests that run outside a running Electron.
import type { BrowserWindow } from 'electron';

import {
  type RasterOptions,
  type Rasterizer,
  type ResolvedRasterOptions,
  resolveRasterOptions,
} from '@tyto/raster';

/**
 * The desktop's `Rasterizer`: a hidden `BrowserWindow` captured through `webContents.debugger`
 * (ADR 0027, E5.4).
 *
 * **Why this adapter lives in `apps/desktop` while the Playwright one lives in
 * `packages/raster`.** The asymmetry is deliberate and it is about what each dependency is.
 * `playwright` is an optional peer a Node process may install anywhere, so a package can
 * offer it without forcing it. `electron` is not a dependency a package can carry: it only
 * exists inside a running Electron, `@tyto/raster` has exactly one entry point — its
 * `exports` map is `{ ".": … }` and nothing else — and the CLI imports that same entry. An
 * Electron adapter re-exported from there would put an `electron` peer in front of a process
 * that will never be one. ADR 0010 permits it either way; the entry point is what decides.
 *
 * **No paint loop.** ADR 0027's Consequences: no `startPainting`, no `invalidate`, no
 * quiet-then-take, no empty-first-frame filter. `Page.captureScreenshot` resolves once with
 * the bytes, and the window it is taken on does not have to be offscreen.
 */

/** The 800×600 ADR 0027 measured from, and the size has no bearing on the picture. */
const CREATED_SIZE = { width: 800, height: 600 } as const;

/**
 * `document.fonts.ready` as a string, for the reason `packages/raster/src/playwright.ts`
 * gives: the expression runs in the page, and writing `document` as an identifier inside a
 * Node module is what `eslint.config.js`'s boundary rule rejects.
 *
 * **No test in this repository catches its removal, and that is stated rather than left to
 * be discovered.** Perturbed — the await replaced by nothing — and `text.feed` still came
 * back 0.0000% against its reference on win32. The faces are `data:` URIs that `export-html`
 * embedded, and on this machine they decode before `loadFile` resolves. It stays because the
 * Playwright adapter waits and the two are supposed to agree, and because "fast enough on the
 * maintainer's machine" is not a property a CI runner under `xvfb` inherits. Anybody deleting
 * it should expect a green suite and should not read that as permission.
 */
const FONTS_READY = 'document.fonts.ready.then(() => true)';

/**
 * The slice of a `BrowserWindow` this adapter uses, named so a test can supply one.
 *
 * **A declared seam rather than `vi.mock('electron')`**, which is the lesson TYTO-101 left:
 * mocking the module leaves the real one reachable through any path the mock does not cover,
 * and the failure shows up as a real browser nobody asked for. Everything this adapter does
 * to a window is on this interface, so a fake that implements it is a complete stand-in and
 * the compiler says so.
 */
export interface CaptureWindow {
  loadFile(file: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  /** Throws if something is already attached — see {@link captureThroughDebugger}. */
  attachDebugger(protocolVersion: string): void;
  sendCommand(method: string, parameters?: Record<string, unknown>): Promise<unknown>;
  detachDebugger(): void;
  destroy(): void;
}

export interface DebuggerRasterizerOptions {
  /**
   * Builds the window each capture runs on. Defaults to a real hidden `BrowserWindow`.
   *
   * The default is resolved with a dynamic `import('electron')` so that importing this
   * module outside Electron — which is what `pnpm check` does — costs nothing and fails
   * nothing.
   */
  readonly createWindow?: (size: { width: number; height: number }) => Promise<CaptureWindow>;
  /** Where the temporary document is written. Defaults to the OS temp folder. */
  readonly scratchDirectory?: string;
}

async function defaultWindow(size: { width: number; height: number }): Promise<CaptureWindow> {
  const { BrowserWindow } = await import('electron');
  const window: BrowserWindow = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    // From ADR 0027's decision snippet. It is *not* what carries alpha into the bytes —
    // perturbed to `false` and `alpha.square` still came back 0.0000% against the Playwright
    // reference, so `Page.captureScreenshot` is doing that on its own. Kept because the ADR
    // has it and an ADR is not reopened by a comment.
    transparent: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const { webContents } = window;
  return {
    loadFile: async (file) => window.loadFile(file),
    executeJavaScript: async (code) => webContents.executeJavaScript(code),
    attachDebugger: (protocolVersion) => {
      webContents.debugger.attach(protocolVersion);
    },
    sendCommand: async (method, parameters) => webContents.debugger.sendCommand(method, parameters),
    detachDebugger: () => {
      webContents.debugger.detach();
    },
    destroy: () => {
      window.destroy();
    },
  };
}

/**
 * The capture itself, on a window this function owns from creation to destruction.
 *
 * **`attached` is a local boolean and not `debugger.isAttached()`, and that is a measurement
 * rather than a preference.** Probed on win32, Electron 44.3.0, in this card:
 *
 * ```
 * [PROBE attach] { "firstAttachThrew": null,
 *                  "secondAttachThrew": "Debugger is already attached to the target",
 *                  "attachedAfterSecond": true,
 *                  "capturedBytesAfterSecondAttach": 353 }
 * ```
 *
 * After a second `attach` throws, `isAttached()` still reports `true` — it is reporting the
 * *first* session, which is still live and still capturing. So the obvious
 * `finally { if (isAttached()) detach() }` would tear down a session this code never opened.
 * The boolean detaches only what this call attached.
 *
 * ADR 0027 guessed that the collision was "only reachable by opening DevTools on it". The
 * same probe says otherwise: with DevTools open (`devToolsOpened: true`) the attach
 * succeeded and threw nothing. DevTools and the debugger API are separate sessions, so on a
 * window created and destroyed inside one capture the collision is not reachable at all.
 */
async function captureThroughDebugger(
  window: CaptureWindow,
  file: string,
  resolved: ResolvedRasterOptions,
): Promise<Uint8Array> {
  let attached = false;
  try {
    await window.loadFile(file);
    await window.executeJavaScript(FONTS_READY);

    window.attachDebugger('1.3');
    attached = true;
    await window.sendCommand('Page.enable');

    // `deviceScaleFactor` is what `RasterOptions.scale` means: the same design at more
    // resolution. ADR 0027 measured the trap next to it — combining this with `clip.scale`
    // multiplies, so `scale: 2` would come back 4× too large. `clip.scale` stays 1.
    await window.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: resolved.width,
      height: resolved.height,
      deviceScaleFactor: resolved.scale,
      mobile: false,
    });

    // **There is no `Emulation.setDefaultBackgroundColorOverride` here, and it was removed
    // rather than never written.** It looked like the counterpart to Playwright's
    // `omitBackground` and it is not needed: `Page.captureScreenshot` already returns the
    // document's own alpha. Measured by perturbation on the `alpha` fixture — a frame whose
    // reference is 11 200 fully transparent and 1 600 partially transparent pixels out of
    // 14 400 — against `packages/raster`'s Playwright reference:
    //
    //     adapter as written                       alpha.square  0.0000%
    //     without the background override          alpha.square  0.0000%
    //     with the window at `transparent: false`  alpha.square  0.0000%
    //
    // So neither the command nor the window's own transparency carries the alpha, and a line
    // that changes no byte is a line that will be read as load-bearing by the next person.
    // `transparent: true` stays on the window because ADR 0027's decision snippet has it;
    // this one was mine and the measurement says it did nothing.
    const shot = (await window.sendCommand('Page.captureScreenshot', {
      format: resolved.format,
      ...(resolved.quality === undefined ? {} : { quality: resolved.quality }),
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: resolved.width, height: resolved.height, scale: 1 },
    })) as { data: string };

    // Base64 because the protocol is JSON. `Buffer` is Node's and this is the main process.
    return new Uint8Array(Buffer.from(shot.data, 'base64'));
  } finally {
    if (attached) window.detachDebugger();
    window.destroy();
  }
}

/**
 * A `Rasterizer` backed by the Electron this app is already running in.
 *
 * No browser is launched and none is reused: a window is created per capture and destroyed
 * with it. That is the opposite of the Playwright adapter's one-browser-per-process, and it
 * is the right trade here because the engine is already running — what a reused window would
 * save is a few milliseconds, against carrying one page's state into the next render.
 *
 * **The document reaches the window as a file, not as a `data:` URL.** TYTO-30 measured the
 * alternative: `ERR_INVALID_URL (-300)` at ~3 MB, and `export-html` embeds its fonts, so
 * every real document is past that. The temp folder is created per capture and removed in a
 * `finally`, including when the capture threw.
 */
export function createDebuggerRasterizer(options: DebuggerRasterizerOptions = {}): Rasterizer {
  const createWindow = options.createWindow ?? defaultWindow;

  return {
    async raster(html: string, rasterOptions: RasterOptions): Promise<Uint8Array> {
      // Before anything is created: `resolveRasterOptions` throws `TypeError` for what is
      // wrong in the arguments alone, and a window opened first would be a window leaked on
      // a typo.
      const resolved = resolveRasterOptions(rasterOptions);

      const directory = await mkdtemp(join(options.scratchDirectory ?? tmpdir(), 'tyto-raster-'));
      try {
        const file = join(directory, 'frame.html');
        // `utf8` and a real file: the document declares its own charset, so nothing here
        // depends on the platform's.
        await writeFile(file, html, 'utf8');
        const window = await createWindow(CREATED_SIZE);
        return await captureThroughDebugger(window, file, resolved);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
