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
 *
 * **Except when it does not resolve at all, which is what TYTO-148 measured and ADR 0030
 * records.** In the packaged app 15 of 80 captures never answered `Page.captureScreenshot` inside
 * the probe's 8 s cap; the dev build answered 20 of 20. So every step here has a deadline
 * ({@link CAPTURE_DEADLINE_MS}), a capture that misses it is tried once more on a fresh window,
 * and a frame that fails twice is reported as a failed frame rather than stalling the export.
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
 *
 * TYTO-148 put a number beside that, and the denominator is smaller than the card's headline one.
 * Only the per-step probe ever timed this wait — packaged 0.2.0, a 15 s cap on each step — and
 * there it settled in **0–2 ms on every capture**, the ones that then timed out on
 * `Page.captureScreenshot` included. The 100 captures quoted elsewhere in this card did not time
 * it; they awaited it without a clock, which is weaker evidence of the same thing — a wait that
 * never settled would have hung the probe, and none of the 100 did. So the line is cheap, and it
 * is not where an export stalls, which is worth writing down because the fonts wait was the first
 * suspect and it was wrong.
 */
const FONTS_READY = 'document.fonts.ready.then(() => true)';

/**
 * What **one step** of a capture is given before the capture is abandoned (TYTO-148, ADR 0030).
 *
 * **Per step and not per capture, because the message is the diagnostic.** A capture that misses
 * this becomes `E_RENDER_FAILED`'s `{problem}` verbatim, and the only thing that report can say
 * which nothing else in the run knows is *which* protocol command stopped answering. A single
 * budget around the whole of {@link captureThroughDebugger} would name the capture and lose the
 * step, and the step is the one fact a follow-up investigation starts from. The cost is stated
 * rather than hidden: five steps each with their own budget means a pathological capture where
 * every step crawls can take 5 × this before it gives up. Nothing measured comes near that —
 * the only step ever seen to exceed a second is the last one, and when it goes it never answers
 * at all.
 *
 * **30 s is ~28× the slowest capture ever measured here.** Across 100 captures on win32 in
 * TYTO-148 — 20 in the dev build, 80 across four packaged shapes — every capture that answered
 * answered in **39–1 075 ms**, and 15 of the 80 packaged ones did not answer inside the probe's
 * 8 s cap. Nothing here waited 30 s, so the number this file ships was never itself measured:
 * what the 19% belongs to is an 8 s deadline, and a capture that would have answered between 8 s
 * and 30 s is excluded by nothing. What is measured is the bound the number has to clear, and it
 * clears it 28× over. It is also Playwright's own default action timeout, which is the number the
 * other `Rasterizer` in this repo already lives under (`packages/raster/src/playwright.ts`) — two
 * adapters disagreeing about how long patience lasts would be a difference nobody asked for.
 * That parity is partial, and the gap is on this card's own subject: `setContent` and `screenshot`
 * carry Playwright's default, while the `page.evaluate` that waits for the fonts there carries no
 * clock at all.
 *
 * Exported so the tests assert against the constant instead of retyping the number.
 */
export const CAPTURE_DEADLINE_MS = 30_000;

/**
 * How many times one frame's capture is attempted before the frame is reported failed.
 *
 * **Two, and it is containment rather than a cure — the measurement says so.** In the packaged
 * app 15 of 80 captures hung past the probe's 8 s cap (19%); retrying each of those once on a
 * fresh window recovered **9 of 15**, and the other 6 hung again. So after the deadline and this
 * retry roughly **7% of packaged captures still fail** (6 of 80) — a residual that belongs to the
 * probe's 8 s cap, since nothing measured here ever waited the 30 s that ships. They fail as a
 * `frame-failed` event with the other frames written — which is the whole of what this card buys. The dev build hung 0 of 20,
 * so on that shape the retry never fires.
 *
 * Why the packaged build differs from the dev build at all is **not** answered here and is not
 * explained by the deadline: not the fonts wait (see {@link FONTS_READY} for what was and was not
 * timed there), not asar packing, not the GPU, and not a 0.2.0 → 0.3.0 regression. It is a
 * Chromium-level question with its own card.
 */
const CAPTURE_ATTEMPTS = 2;

/**
 * A step that ran out of its deadline, tagged as a class so the retry can recognise it.
 *
 * A class and not a string match on the message: the retry must fire for this and for nothing
 * else — a protocol error or a `TypeError` from the arguments is a real answer, and answering
 * it twice would only produce two of the same error a little later.
 *
 * **The "this is known" half of the message is attached only to the step it is true of.** The
 * whole message becomes `E_RENDER_FAILED`'s `{problem}` and a beta tester reads it verbatim;
 * `Page.captureScreenshot` is the one step TYTO-148 measured never answering, so naming it to
 * somebody whose `loadFile` stalled would point them away from what actually happened — which
 * is the opposite of why the deadline is budgeted per step in the first place.
 */
class CaptureDeadlineError extends Error {
  constructor(step: string, ms: number) {
    const known =
      step === 'Page.captureScreenshot'
        ? ' This has been seen in the packaged app, where that command sometimes never answers.'
        : '';
    super(
      `The capture did not answer ${step} within ${ms} ms, so the frame was abandoned.${known} ` +
        `The frame is reported failed and the rest of the export continues.`,
    );
    this.name = 'CaptureDeadlineError';
  }
}

/**
 * Races `work` against the clock and rejects with a {@link CaptureDeadlineError} if it loses.
 *
 * **A lost race leaves `work` pending forever, and that is safe here for a reason worth naming.**
 * `Promise.race` subscribes to `work`, so a `sendCommand` that rejects long after the window was
 * destroyed is already a *handled* rejection — it reaches a race that has settled and is dropped
 * there. Without that, it would be an unhandled rejection, and TYTO-140 installed a handler that
 * puts an error box on screen for one of those: the fix for a silent hang would have shipped a
 * dialog. Anybody replacing the race with an `await` plus a flag has to attach that handler by
 * hand.
 *
 * The timer is cleared on the settled path so a finished export does not hold the loop open, and
 * `unref`ed so that even an uncleared one could not keep the process alive. **Neither of those two
 * is caught by a test, and that is stated rather than left to be discovered**, the way the
 * {@link FONTS_READY} comment states its own: deleting the `clearTimeout` or the `unref` leaves
 * the suite green, because an unref'd stray timer changes nothing this file can observe. They are
 * hygiene, not a guard, and a green run is not permission to drop them.
 */
async function withDeadline<T>(step: string, work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new CaptureDeadlineError(step, ms));
    }, ms);
    timer.unref();
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  /**
   * What one step of a capture is given before the frame is abandoned. Defaults to
   * {@link CAPTURE_DEADLINE_MS}; the unit tests set it to tens of milliseconds so a suite does
   * not wait out a real one.
   *
   * It is an option here and **not** a setting, and not an argument the composition root passes:
   * a number a person cannot reason about does not belong in front of a beta tester, and the
   * only caller that needs another one is a test.
   */
  readonly captureDeadlineMs?: number;
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
 *
 * **Every awaited step carries a deadline, not only the one measured to stall.** TYTO-148 found
 * `Page.captureScreenshot` and nothing else past 1.1 s — on one machine, on one platform. The
 * card's title is that nothing in this path has a deadline, and wrapping only the step that
 * happened to hang on win32 would leave the same hole open for whichever step hangs elsewhere.
 */
async function captureThroughDebugger(
  window: CaptureWindow,
  file: string,
  resolved: ResolvedRasterOptions,
  deadlineMs: number,
): Promise<Uint8Array> {
  let attached = false;
  try {
    await withDeadline('loadFile', window.loadFile(file), deadlineMs);
    await withDeadline('document.fonts.ready', window.executeJavaScript(FONTS_READY), deadlineMs);

    window.attachDebugger('1.3');
    attached = true;
    await withDeadline('Page.enable', window.sendCommand('Page.enable'), deadlineMs);

    // `deviceScaleFactor` is what `RasterOptions.scale` means: the same design at more
    // resolution. ADR 0027 measured the trap next to it — combining this with `clip.scale`
    // multiplies, so `scale: 2` would come back 4× too large. `clip.scale` stays 1.
    await withDeadline(
      'Emulation.setDeviceMetricsOverride',
      window.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: resolved.width,
        height: resolved.height,
        deviceScaleFactor: resolved.scale,
        mobile: false,
      }),
      deadlineMs,
    );

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
    const shot = (await withDeadline(
      'Page.captureScreenshot',
      window.sendCommand('Page.captureScreenshot', {
        format: resolved.format,
        ...(resolved.quality === undefined ? {} : { quality: resolved.quality }),
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: resolved.width, height: resolved.height, scale: 1 },
      }),
      deadlineMs,
    )) as { data: string };

    // Base64 because the protocol is JSON. `Buffer` is Node's and this is the main process.
    return new Uint8Array(Buffer.from(shot.data, 'base64'));
  } finally {
    // **The detach is allowed to fail and the deadline's error is the one that wins.** Detaching
    // from a target that stopped answering is exactly the case this `finally` now runs in, and as
    // written before TYTO-148 a throwing `detachDebugger` did two harmful things at once: it
    // replaced the error that says what actually went wrong, and it skipped `destroy()` — leaking
    // the window the deadline exists to reclaim. Destroying is what is left to do either way.
    try {
      if (attached) window.detachDebugger();
    } catch {
      // Deliberately swallowed; see above. The window is going regardless.
    }
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
  const deadlineMs = options.captureDeadlineMs ?? CAPTURE_DEADLINE_MS;

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

        // **A capture that ran out its deadline is tried once more, on a fresh window, and the
        // document is deliberately not rewritten** — the same bytes loaded again is the only
        // thing a second `writeFile` would prove. `captureThroughDebugger` destroys the window
        // it was given on every path, so the next attempt starts from nothing carried over.
        //
        // Only a deadline is retried. A protocol error, a `TypeError` from the options or
        // anything else is a real answer, and asking twice would produce two of it.
        for (let attempt = 1; ; attempt += 1) {
          const window = await createWindow(CREATED_SIZE);
          try {
            return await captureThroughDebugger(window, file, resolved, deadlineMs);
          } catch (cause) {
            if (attempt >= CAPTURE_ATTEMPTS || !(cause instanceof CaptureDeadlineError))
              throw cause;
          }
        }
      } finally {
        // **`maxRetries` because this `finally` is newly reachable while the window is still
        // letting go.** Before TYTO-148 a hang meant this block was never reached at all; now it
        // runs immediately after `window.destroy()`, and Windows releases the loaded document's
        // handle asynchronously. An `EBUSY` rejecting out of a `finally` would replace the
        // capture error, which is the whole diagnostic. Not measured — the path is new.
        await rm(directory, { recursive: true, force: true, maxRetries: 3 });
      }
    },
  };
}
