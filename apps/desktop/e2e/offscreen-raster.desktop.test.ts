import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseScene } from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { bundledFont } from '@tyto/fonts';
import { DETERMINISM_ARGS } from '@tyto/raster';
import { PNG } from 'pngjs';
import { type ElectronApplication, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import sceneFixture from './__fixtures__/offscreen.scene.json';

/**
 * **Can an offscreen `BrowserWindow` produce a finished picture on Linux?** TYTO-30's first
 * deliverable, and deliberately the only one in this file: the adapter is not written here.
 *
 * The card was probed twice on the maintainer's Windows box and the two probes disagree
 * with each other and with ADR 0002. `capturePage` on a hidden window — **the mechanism
 * ADR 0002 and `docs/architecture.md` line 70 both name** — fails there with
 * `UnknownVizError`. The `paint` event of an offscreen window works, at production size,
 * with the bundled face embedded. Both of those are one machine's answer, and an adapter
 * written against one machine is how a platform-conditional code path gets built by
 * accident. This suite asks the question on the other platform, in the job `desktop-e2e.yml`
 * already runs on `ubuntu-latest` for every pull request touching `apps/desktop/**`.
 *
 * ## The instrument lied first, and that is why the assertions look the way they do
 *
 * The first probe finished on the first `paint` whose `toPNG()` was non-empty and reported
 * `pngBytes: 6995` for an image that is **blank**. A frame arrives before layout and before
 * the faces are decoded, so an adapter that takes it ships empty artwork past every
 * byte-count assertion there is.
 *
 * Perturbed here — `last = image` becomes `last ??= image`, so the capture keeps the **first
 * usable** frame rather than the settled one — five runs on win32, against six unperturbed:
 *
 * ```
 *                        runs   frames   emptyFrames   pngBytes   paintedShare   whitePixels   suite
 * first usable frame      2/5      3           0        288 539        100.00%             0   red
 * first usable frame      3/5      2           1        355 227        100.00%        22 410   green
 * settled (last frame)    6/6     2–3         0–1       355 227        100.00%        22 410   green
 * ```
 *
 * **The red row is what a byte count cannot see.** 288 539 bytes, the full 1080×1080, the
 * gradient painted across 100% of the frame — and the headline is not in it. `paintedShare`
 * passes it, the size passes it, a `pngBytes > 0` assertion passes it; `whitePixels` is the
 * only one of the four that catches it, and it caught it 2 times out of 2.
 *
 * The other half of the same lesson is one layer down, in the `paint` listener: the first
 * frame is frequently an **empty** `NativeImage` — 0×0, `toPNG()` of zero bytes — which is
 * the card's own `pngBytes=0` from 2026-09-14, explained. There was never a blank picture to
 * look at.
 *
 * ## What this file does *not* claim
 *
 * It is not the acceptance criterion. *Same fixture set within the visual tolerance of the
 * Playwright reference PNGs* needs a reference recorded per platform the way
 * `packages/raster/src/raster.visual.test.ts` keys `text.feed` on `process.platform`, and
 * that suite is still part of TYTO-30. `whitePixels > 0` says text was drawn; it does not
 * say which face drew it.
 *
 * It also does not decide anything. Whether ADR 0002 gets an amendment for `paint` against
 * `capturePage`, how the adapter refuses `webp` (Electron's `NativeImage` encodes `png` and
 * `jpeg` and nothing else), and whether the shipped app applies {@link DETERMINISM_ARGS} at
 * startup are three open decisions this file only measures around. The switches come in on
 * the **command line** here — Electron forwards unrecognised arguments to Chromium — so the
 * app under test is the shipped one, unmodified, exactly as `TYTO_HEADLESS` is the only
 * other thing this suite changes about it.
 *
 * **Not part of `pnpm check`**: it opens an Electron. `pnpm build` then
 * `pnpm --filter @tyto/desktop test:desktop`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

/** The one frame the fixture declares, at the size a feed post actually is. */
const FRAME = { width: 1080, height: 1080 } as const;

/**
 * How long the capture waits for the frames to stop arriving, and how long it waits at all.
 *
 * Quiet-then-take rather than take-the-nth: how many frames a page produces is Chromium's
 * business and it varies between runs of this very fixture — **2 and 3 both occur on win32
 * for byte-identical output**. What an adapter can ask for is *no more damage for a while*,
 * which is the same question `paint` answers repeatedly.
 */
const QUIET_MS = 300;
const SETTLE_TIMEOUT_MS = 30_000;

/**
 * How often to ask for damage again while **nothing at all** has arrived.
 *
 * One `invalidate` is a request, not a guarantee. Two runs on the maintainer's machine ended
 * the 20 s wait with nothing usable — one with **no frame at all**, one with **a single empty
 * one** — against 2 or 3 usable frames inside a second on every other run. The empty-frame
 * case is understood and is handled in the listener below; the no-frame case is not, so this
 * is a mitigation and is labelled one: ask again, on a schedule, until something paints.
 */
const NUDGE_MS = 1_000;

/**
 * Of the frame, how much must be painted before it counts as a picture.
 *
 * The fixture's background is a gradient across the whole 1080×1080, so a settled frame is
 * near 100% and a blank one is 0%. The floor is not a tolerance — there is no reference to
 * be tolerant of — it is the line between an image and an empty buffer, and it is set well
 * below the measurement rather than just under it so that a one-element change cannot
 * redden the suite for a reason that has nothing to do with the route.
 */
const PAINTED_FLOOR = 0.9;

interface Capture {
  readonly frames: number;
  /** Of those, how many carried an empty `NativeImage` and were thrown away. */
  readonly emptyFrames: number;
  /** Base64, because this crosses Playwright's protocol as JSON. Empty if nothing painted. */
  readonly png: string;
  readonly width: number;
  readonly height: number;
  /**
   * What the window said about itself when the wait ended.
   *
   * Carried back so that a red run on a platform nobody can attach a debugger to says
   * *which* of the two things went wrong — a window that was never offscreen, or an
   * offscreen window that was not painting. `expected 1080, got 0` says neither.
   */
  readonly offscreen: boolean;
  readonly painting: boolean;
  /** How many times damage was asked for, the first request included. */
  readonly invalidations: number;
}

let scratch: string;
let documentFile: string;
let app: ElectronApplication;

/**
 * The self-contained document, built by the real exporter rather than written by hand.
 *
 * `exportHtml` embeds the faces as base64 (ADR 0018), which is what makes this ~1 MB and
 * what makes waiting for `document.fonts.ready` mean something. A hand-written page with a
 * system font would prove the route and prove nothing about the documents it will carry.
 */
function documentHtml(): string {
  const scene = parseScene(sceneFixture);
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));

  const exported = exportHtml(scene.value, {
    resources: { font: bundledFont },
  });
  if (!exported.ok) throw new Error(exported.error.map((item) => item.message).join('; '));

  const frame = exported.value[0];
  if (frame === undefined) throw new Error('The fixture exported no frames.');
  return frame.html;
}

/**
 * One offscreen capture, run in the app's own main process.
 *
 * `loadFile` and not a `data:` URL: the second probe measured `ERR_INVALID_URL (-300)` on a
 * ~3 MB document, and a self-contained export is routinely past that. A temp file is the
 * cheapest of the three routes the card names, and it is the one being exercised here —
 * whether the adapter ships that or a `protocol.handle` scheme is still open.
 */
async function capture(): Promise<Capture> {
  return app.evaluate(
    async ({ BrowserWindow }, options) => {
      const window = new BrowserWindow({
        show: false,
        width: options.width,
        height: options.height,
        // The width and height above are the *document's*, not the window frame's. Without
        // this the chrome comes out of the picture and the capture is short by whatever the
        // platform's borders happen to be — which is a different number per platform.
        useContentSize: true,
        frame: false,
        transparent: true,
        webPreferences: {
          // `useSharedTexture: false` is the software path, which is the one that emits a
          // `NativeImage` on `paint`. With a shared texture the frame is a GPU handle and
          // `toPNG()` has nothing to encode.
          offscreen: { useSharedTexture: false },
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const contents = window.webContents;
      let frames = 0;
      let emptyFrames = 0;
      let last: Electron.NativeImage | undefined;
      let lastPaintAt = 0;

      contents.on('paint', (_details, _dirty, image) => {
        frames += 1;
        lastPaintAt = Date.now();
        // **An empty `NativeImage` is a frame too, and it is the one that has to be thrown
        // away rather than waited past.** The first `paint` of this document is 0×0 — zero
        // bytes out of `toPNG()` — on 3 runs of 6 here, and on the run where it was the
        // *only* frame that ever arrived, a wait that merely keeps the last one kept that
        // and the suite reported a 0×0 capture. So the frame is filtered where it lands, and
        // the loop below goes on asking for damage until a real one turns up.
        if (image.isEmpty()) {
          emptyFrames += 1;
          return;
        }
        last = image;
      });

      let invalidations = 0;
      const invalidate = (): void => {
        invalidations += 1;
        contents.invalidate();
      };

      try {
        if (!contents.isPainting()) contents.startPainting();
        await window.loadFile(options.file);
        // The faces, decoded. `loadFile` resolves when the document loaded, which is before
        // `@font-face` has finished with the bytes that are inside it.
        await contents.executeJavaScript('document.fonts.ready.then(() => true)');
        // Damage the whole surface, so a page that finished settling before the listener was
        // attached still produces one frame to take.
        invalidate();

        const deadline = Date.now() + options.timeoutMs;
        let nudgedAt = Date.now();
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (last !== undefined && Date.now() - lastPaintAt >= options.quietMs) break;
          // Only while no usable frame has arrived. Once they are coming, asking again would
          // keep damaging the surface and the quiet this loop waits for would never happen.
          if (last === undefined && Date.now() - nudgedAt >= options.nudgeMs) {
            invalidate();
            nudgedAt = Date.now();
          }
        }

        const size = last?.getSize() ?? { width: 0, height: 0 };
        return {
          frames,
          emptyFrames,
          png: last === undefined ? '' : last.toPNG().toString('base64'),
          width: size.width,
          height: size.height,
          offscreen: contents.isOffscreen(),
          painting: contents.isPainting(),
          invalidations,
        };
      } finally {
        window.destroy();
      }
    },
    {
      file: documentFile,
      width: FRAME.width,
      height: FRAME.height,
      quietMs: QUIET_MS,
      timeoutMs: SETTLE_TIMEOUT_MS,
      nudgeMs: NUDGE_MS,
    },
  );
}

interface Coverage {
  /** Pixels that are neither transparent nor pure white, over the whole frame. */
  readonly paintedShare: number;
  /** Pure opaque white, which in this fixture is the headline and nothing else. */
  readonly whitePixels: number;
}

function coverageOf(png: string): Coverage {
  const image = PNG.sync.read(Buffer.from(png, 'base64'));
  let painted = 0;
  let white = 0;

  for (let index = 0; index < image.data.length; index += 4) {
    const [red, green, blue, alpha] = [
      image.data[index] ?? 0,
      image.data[index + 1] ?? 0,
      image.data[index + 2] ?? 0,
      image.data[index + 3] ?? 0,
    ];
    if (alpha === 0) continue;
    if (red === 255 && green === 255 && blue === 255) {
      white += 1;
      painted += 1;
      continue;
    }
    painted += 1;
  }

  return { paintedShare: painted / (image.width * image.height), whitePixels: white };
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-offscreen-'));
  documentFile = join(scratch, 'frame.html');
  // `utf8` and a real file on disk, because `loadFile` is what the window is handed. The
  // document declares its own charset, so nothing here depends on the platform's.
  writeFileSync(documentFile, documentHtml(), 'utf8');

  app = await _electron.launch({
    // The five flags that take the host's opinions out of the picture, applied to this
    // Electron and not to the shipped app. `--user-data-dir` keeps `layout.json` out of the
    // folder the other suites share (TYTO-117).
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, ...DETERMINISM_ARGS],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
});

afterAll(async () => {
  await app?.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe('an offscreen BrowserWindow, through the paint event', () => {
  it('hands back a frame the size the document asked for, with a picture in it', async () => {
    const captured = await capture();

    const coverage = captured.png === '' ? undefined : coverageOf(captured.png);
    const measurement =
      `[TYTO-30] platform=${process.platform} frames=${String(captured.frames)} ` +
      `emptyFrames=${String(captured.emptyFrames)} ` +
      `invalidations=${String(captured.invalidations)} ` +
      `offscreen=${String(captured.offscreen)} painting=${String(captured.painting)} ` +
      `size=${String(captured.width)}x${String(captured.height)} ` +
      `pngBytes=${String(Buffer.from(captured.png, 'base64').byteLength)} ` +
      `paintedShare=${((coverage?.paintedShare ?? 0) * 100).toFixed(2)}% ` +
      `whitePixels=${String(coverage?.whitePixels ?? 0)}`;
    // **`process.stdout` and not `console.log`, because a green run has to carry the number.**
    // Measured rather than assumed: under the reporter `desktop-e2e.yml` actually runs — the
    // default one — a passing test's `console.log` is captured and never printed. `grep -c
    // TYTO-30` on that log returns 0, and this suite's whole product is the number. Writing to
    // the process's own stdout goes straight into the job log either way.
    process.stdout.write(`${measurement}\n`);

    // The measurement rides along on every assertion too, so a red run names it where a reader
    // of a failure looks first rather than fifty lines up.
    expect(captured.frames, measurement).toBeGreaterThan(0);
    expect({ width: captured.width, height: captured.height }, measurement).toEqual({
      width: FRAME.width,
      height: FRAME.height,
    });

    // Not a byte count. A blank first frame encodes to ~7 KB and would pass one.
    expect(coverage?.paintedShare ?? 0, measurement).toBeGreaterThan(PAINTED_FLOOR);
    // Layout ran and the text was drawn. Which face drew it is the visual half of TYTO-30
    // and is not answered here.
    expect(coverage?.whitePixels ?? 0, measurement).toBeGreaterThan(0);
  });

  it('gives the same bytes twice, so the settle is a rule rather than a race', async () => {
    // The property the adapter needs and the one a quiet-then-take rule could plausibly not
    // have: if the capture returned whichever frame the timer happened to land on, two runs
    // of the same document would differ. Determinism *across* machines is the visual suite's
    // question; this is determinism on one.
    const first = await capture();
    const second = await capture();

    expect(first.png).not.toBe('');
    expect(second.png).toBe(first.png);
  });
});
