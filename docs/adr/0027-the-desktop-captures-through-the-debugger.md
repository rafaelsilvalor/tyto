# 0027 — The desktop captures through the debugger, because a window's frame is clipped to the screen

Status: accepted · 2026-09-18 · TYTO-125 · amends the desktop half of ADR 0002

## Context

ADR 0002 named one mechanism for the desktop — `webContents.capturePage` on an offscreen `BrowserWindow` — and `docs/architecture.md` repeated it for a year. Neither half of that sentence survived being run. TYTO-30 measured both on both platforms (#177) and stopped there on purpose, because what it found is a decision rather than an implementation detail.

**Every route that reads the window's composited surface is clipped to the primary display's work area, and the crop is silent.** A story is 1080×1920 and no display this project runs on is 1920 tall; CI's `xvfb` is 1280×1024. Measured on win32, Electron 44.3.0 / Chromium 152.0.7977.78, `display=3072x1728 workArea=3072x1680 scaleFactor=1.25`, asking for 1080×1920 of a document that is 1080×1920:

```
variant                                 got         pngBytes   verdict
V1  offscreen window, paint event       1080x1680     376 106   clipped
V2  CDP on a hidden window              1080x1920     378 060   full size
V3  CDP on an offscreen window          1080x1920     377 799   full size
V4  offscreen, setContentSize after     1080x1920     377 799   full size
    startPainting
V5  offscreen 1080x960, zoomFactor 0.5  1080x960      145 404   a different picture
V6  capturePage on a hidden window      1350x2100     524 264   clipped
V7  beginFrameSubscription              1350x2100     524 264   clipped
```

**A byte count cannot tell those rows apart, and the largest image in the table is one of the broken ones.** The document used for the size question is synthetic and says so: 1080×1920, three opaque-white 1000×80 bars at y=40, y=1000 and y=1780, 80 000 pixels each. What each route returned, by third of the frame:

```
V1  whiteTop=80000  whiteMiddle=80000  whiteBottom=0        1080x1680
V2  whiteTop=80000  whiteMiddle=80000  whiteBottom=80000    1080x1920
V4  whiteTop=80000  whiteMiddle=80000  whiteBottom=80000    1080x1920
V6  whiteTop=125000 whiteMiddle=125000 whiteBottom=0        1350x2100
```

V6 is the trap in full. `capturePage` came back **bigger than asked** — 1350×2100 — and it is the same clipped frame upscaled by this display's 1.25 scale factor, with the bottom bar missing and 125 000 = 80 000 × 1.25². It also corrects the card that opened this decision: `capturePage` does not always throw. Without the five `DETERMINISM_ARGS` it fails verbatim with `UnknownVizError`; with `--disable-gpu` among them the no-argument form returns a real image, while `capturePage({x:0,y:0,width:1080,height:1920})` with an explicit rectangle throws `UnknownVizError` either way.

**Two escapes exist, and neither of them reads the window's surface at the window's size.** V4 grows the content surface after painting has started — the clamp is applied when the window is created and growing it afterwards is not re-clamped. V2 and V3 bypass the surface entirely: `webContents.debugger.attach('1.3')`, `Emulation.setDeviceMetricsOverride`, then `Page.captureScreenshot({ captureBeyondViewport: true, clip })` — the mechanism Puppeteer and Playwright use for a full-page screenshot, which the card did not list.

## Decision

**The desktop's `Rasterizer` captures through `webContents.debugger`, on a hidden window it creates for the capture and destroys after.** In full:

```js
const window = new BrowserWindow({ show: false, useContentSize: true, frame: false, transparent: true, … });
await window.loadFile(document);
await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
window.webContents.debugger.attach('1.3');
await window.webContents.debugger.sendCommand('Page.enable');
await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: scale, mobile: false,
});
const { data } = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
  format, quality, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 },
});
```

ADR 0002 is amended, not overturned: the engine is still Chromium, the port is still `Rasterizer`, and the CLI still uses Playwright. What changes is the desktop's capture call, and the window it is made on stops needing to be offscreen.

**The two things that decide it against V4 are the port's own contract, and neither is fidelity.** Fidelity is a tie, measured: at `scale: 2` both routes return 2160×3840 of the same document and the two PNGs are **byte-identical** at 32 293 bytes, with `innerWidth=1080 innerHeight=1920 dpr=2` inside the page — the same design at twice the resolution, which is what `RasterOptions.scale` promises. What the debugger has and the paint event does not:

- **`webp`.** The port declares `RasterFormat = 'png' | 'jpeg' | 'webp'` and Electron's `NativeImage` encodes two of the three. `Page.captureScreenshot({ format: 'webp', quality: 80 })` returned 5 308 bytes opening `52494646 … 57454250` — `RIFF`/`WEBP`, checked in the bytes rather than trusted from the call. `png` 10 518 B and `jpeg` 16 324 B (`ffd8ffe0…`) came back from the same document, the flat synthetic one; the suite asserts the same three containers on the real fixture, where the numbers are larger and the ordering between them is different. So the whole port is servable on the desktop, and the open question in `offscreen-raster.desktop.test.ts` about how the adapter refuses `webp` is closed by not having to refuse it.
- **The size, asked for once.** V4 needs a ritual — create small, `startPainting()`, `setContentSize`, invalidate, then take the settled frame — and the ritual has an undocumented floor. Created at 400×300 it returns **two pixels too tall**: 1919 → 1921, 1920 → 1922, 1921 → 1922. From 800×600 up it lands exactly. A window created at the final size and never resized is clipped outright (1080×1920 asked, 1080×1680 back, bottom bar gone), so it is the resize that carries and not the size. Nothing in Electron's documentation says any of that, and a two-pixel error passes every byte-count assertion there is.

Determinism holds on both: two runs of the same document in one launch are byte-identical through the debugger (10 518 B twice) and through the paint event (10 439 B twice). The debugger route had never been checked before this card.

## What was rejected, and what it would have cost

**Ship the clamp as a limit** — refuse a raster taller than the work area, loudly. Rejected because the format it refuses is the product's: a story is 1080×1920 and no machine in the fleet could export one, CI included. A limit that fires on the flagship format is a decision to not ship the feature.

**Drop the window and reuse the Playwright adapter**, which ADR 0002 avoided for a reason it remembered rather than measured. Measured now, on Windows x64: the packaged app's unpacked tree is 390 026 472 B, of which Tyto's own code is the 4 857 891 B `app.asar`. Playwright's Chromium beside it is 452 900 525 B, and the headless shell its default path actually launches is 283 239 610 B — **+72.6% on the smallest honest answer and +188.7% if both are carried**, to gain a second copy of an engine the app already ships. It is also the third instance of a bug this app has been bitten by twice: `PLAYWRIGHT_BROWSERS_PATH=0` resolves to `playwright-core`'s own folder, and `docs/architecture.md` already says _anything else that reads its own folder joins that list_ — worse here, because a browser inside an `app.asar` cannot be executed at all.

**Lift the clamp by rendering small and scaling up** — V5, `zoomFactor: 0.5` in a window half the size. It is not the same picture and the numbers say so: `innerWidth=2160 innerHeight=1920 devicePixelRatio=0.5`, the 1080-wide document occupying the left half of the frame at 540×540 device pixels, `paintedShare` 28.13% = 540·540/(1080·960) exactly. The honest form of the trade is half the linear resolution, which is not what `scale` means.

**`enableDeviceEmulation` no longer crashes, and it still does not help.** The card records it killing the main process on an offscreen window; on Electron 44.3.0 it survived two launches of its own. What it produces is a render at `dpr=2` resampled onto the window's own surface — a 400×302 window still paints 400×302 — so it lifts nothing. The stale claim is corrected in `apps/desktop/e2e/offscreen-raster.desktop.test.ts` in the same pull request.

## Consequences

The desktop adapter (TYTO-133) is a debugger session rather than a paint loop: no `startPainting`, no `invalidate`, no quiet-then-take, no empty-first-frame filter. `Page.captureScreenshot` resolves once with the bytes. `E5.4`'s acceptance criterion — same fixtures within the Playwright references' tolerance — is now reachable at every frame size, which it was not while the frame was the screen's.

**The failure mode moves to the debugger.** `webContents.debugger.attach` throws if something is already attached to that `webContents`, which for a window created and destroyed inside one capture is only reachable by opening DevTools on it. That is not measured, and it is the price of a protocol surface that is versioned against Chromium rather than against Electron.

`DETERMINISM_ARGS` still matter and still arrive on the command line; the third open question TYTO-30 recorded — whether the shipped app applies them at startup — is untouched by this ADR and belongs to TYTO-133. Reference PNGs are still keyed per platform, the way `packages/raster/src/raster.visual.test.ts` keys `text.feed` on `process.platform`.

**What this ADR does not decide:** whether the capture window is merely hidden or also offscreen. Both returned a full-size frame on win32 and the offscreen one produced bytes identical to the paint route's; the hidden window is the simpler of the two and is what the decision above names. `offscreen-raster.desktop.test.ts` takes the same measurement on `ubuntu-latest` on every desktop pull request, and it is that suite, not this file, that gets to change the answer.
