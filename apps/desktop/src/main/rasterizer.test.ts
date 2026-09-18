import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CaptureWindow, createDebuggerRasterizer } from './rasterizer.js';

/**
 * The adapter's arithmetic and its window lifecycle, without an Electron.
 *
 * What this file can prove is everything between `raster(html, options)` and the protocol
 * commands: the order they go out in, the numbers in them, and that the window is torn down
 * on every path. What it cannot prove is that Chromium answers them with the right pixels —
 * that is `e2e/raster.desktop.test.ts`, which launches a real one. The seam between the two
 * is {@link CaptureWindow}, declared by the adapter for exactly this reason.
 */

interface Call {
  readonly method: string;
  readonly parameters: Record<string, unknown> | undefined;
}

interface Recorder {
  readonly window: CaptureWindow;
  readonly calls: Call[];
  readonly loaded: string[];
  readonly evaluated: string[];
  attaches: number;
  detaches: number;
  destroys: number;
}

/** A `CaptureWindow` that answers `Page.captureScreenshot` with `pixels` and records the rest. */
function recorder(
  options: { readonly pixels?: string; readonly attachThrows?: Error } = {},
): Recorder {
  const calls: Call[] = [];
  const loaded: string[] = [];
  const evaluated: string[] = [];
  const state = { attaches: 0, detaches: 0, destroys: 0 };

  const window: CaptureWindow = {
    loadFile: async (file) => {
      loaded.push(file);
    },
    executeJavaScript: async (code) => {
      evaluated.push(code);
      return true;
    },
    attachDebugger: () => {
      if (options.attachThrows) throw options.attachThrows;
      state.attaches += 1;
    },
    sendCommand: async (method, parameters) => {
      calls.push({ method, parameters });
      if (method === 'Page.captureScreenshot') {
        return { data: options.pixels ?? Buffer.from('bytes').toString('base64') };
      }
      return {};
    },
    detachDebugger: () => {
      state.detaches += 1;
    },
    destroy: () => {
      state.destroys += 1;
    },
  };

  return {
    window,
    calls,
    loaded,
    evaluated,
    get attaches() {
      return state.attaches;
    },
    get detaches() {
      return state.detaches;
    },
    get destroys() {
      return state.destroys;
    },
  } as Recorder;
}

function parametersOf(calls: readonly Call[], method: string): Record<string, unknown> {
  const call = calls.find((candidate) => candidate.method === method);
  if (!call) throw new Error(`no ${method} was sent; got ${calls.map((c) => c.method).join(', ')}`);
  return call.parameters ?? {};
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-raster-test-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('createDebuggerRasterizer', () => {
  it('sends the document through a file and waits for its fonts before capturing', async () => {
    const recorded = recorder();
    const rasterizer = createDebuggerRasterizer({
      createWindow: async () => recorded.window,
      scratchDirectory: scratch,
    });

    await rasterizer.raster('<!doctype html><title>frame</title>', { width: 1080, height: 1080 });

    expect(recorded.loaded).toHaveLength(1);
    expect(recorded.loaded[0]).toMatch(/frame\.html$/);
    // The fonts are awaited before the debugger is even attached, so no ordering between
    // them can put a capture in front of a face that has not decoded.
    expect(recorded.evaluated).toEqual(['document.fonts.ready.then(() => true)']);
    expect(recorded.calls.map((call) => call.method)).toEqual([
      'Page.enable',
      'Emulation.setDeviceMetricsOverride',
      'Page.captureScreenshot',
    ]);
  });

  it('returns the bytes the protocol answered with, decoded', async () => {
    const recorded = recorder({ pixels: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') });
    const rasterizer = createDebuggerRasterizer({
      createWindow: async () => recorded.window,
      scratchDirectory: scratch,
    });

    const bytes = await rasterizer.raster('<!doctype html>', { width: 10, height: 10 });

    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('puts scale in deviceScaleFactor and leaves clip.scale at 1', async () => {
    // ADR 0027 measured the trap: the two multiply, so a `scale: 2` that also reached
    // `clip.scale` would come back 4320×7680 instead of 2160×3840.
    const recorded = recorder();
    const rasterizer = createDebuggerRasterizer({
      createWindow: async () => recorded.window,
      scratchDirectory: scratch,
    });

    await rasterizer.raster('<!doctype html>', { width: 1080, height: 1920, scale: 2 });

    expect(parametersOf(recorded.calls, 'Emulation.setDeviceMetricsOverride')).toMatchObject({
      width: 1080,
      height: 1920,
      deviceScaleFactor: 2,
      mobile: false,
    });
    expect(parametersOf(recorded.calls, 'Page.captureScreenshot')['clip']).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      scale: 1,
    });
  });

  it('passes the format and its quality straight through', async () => {
    const forJpeg = recorder();
    await createDebuggerRasterizer({
      createWindow: async () => forJpeg.window,
      scratchDirectory: scratch,
    }).raster('<!doctype html>', { width: 10, height: 10, format: 'jpeg', quality: 80 });

    expect(parametersOf(forJpeg.calls, 'Page.captureScreenshot')).toMatchObject({
      format: 'jpeg',
      quality: 80,
      captureBeyondViewport: true,
    });

    // **Nothing here asserts a background override, and that is the point.** An earlier draft
    // sent `Emulation.setDefaultBackgroundColorOverride` on every non-JPEG capture and this
    // test asserted it. Perturbation found the assertion was guarding a command that changed
    // no byte — `alpha.square` came back 0.0000% against the Playwright reference with the
    // command, without it, and with the window opaque. The command went; so did the
    // assertion, because a unit test that pins a protocol call nobody can observe the effect
    // of is what let it look load-bearing in the first place. Transparency is proved in
    // `e2e/raster.desktop.test.ts`, against a reference that is 11 200 transparent pixels.
    const forWebp = recorder();
    await createDebuggerRasterizer({
      createWindow: async () => forWebp.window,
      scratchDirectory: scratch,
    }).raster('<!doctype html>', { width: 10, height: 10, format: 'webp', quality: 90 });

    expect(forWebp.calls.map((call) => call.method)).toEqual([
      'Page.enable',
      'Emulation.setDeviceMetricsOverride',
      'Page.captureScreenshot',
    ]);
  });

  it('omits quality entirely when none was asked for', async () => {
    const recorded = recorder();
    await createDebuggerRasterizer({
      createWindow: async () => recorded.window,
      scratchDirectory: scratch,
    }).raster('<!doctype html>', { width: 10, height: 10 });

    expect(parametersOf(recorded.calls, 'Page.captureScreenshot')).not.toHaveProperty('quality');
  });

  it('detaches and destroys the window after a capture', async () => {
    const recorded = recorder();
    await createDebuggerRasterizer({
      createWindow: async () => recorded.window,
      scratchDirectory: scratch,
    }).raster('<!doctype html>', { width: 10, height: 10 });

    expect([recorded.attaches, recorded.detaches, recorded.destroys]).toEqual([1, 1, 1]);
  });

  it('does not detach a session it never attached', async () => {
    // The measured reason this is a local boolean and not `debugger.isAttached()`: after a
    // second attach throws, `isAttached()` still reports the FIRST session — live, and
    // somebody else's. Detaching it here would break a capture this call has no part in.
    const recorded = recorder({ attachThrows: new Error('Debugger is already attached') });

    await expect(
      createDebuggerRasterizer({
        createWindow: async () => recorded.window,
        scratchDirectory: scratch,
      }).raster('<!doctype html>', { width: 10, height: 10 }),
    ).rejects.toThrow('Debugger is already attached');

    expect(recorded.detaches).toBe(0);
    // Destroyed all the same — the window is this call's whether the attach worked or not.
    expect(recorded.destroys).toBe(1);
  });

  it('removes the temporary document, including when the capture threw', async () => {
    const exploding: CaptureWindow = {
      ...recorder().window,
      sendCommand: async () => {
        throw new Error('Page.captureScreenshot failed');
      },
    };

    await expect(
      createDebuggerRasterizer({
        createWindow: async () => exploding,
        scratchDirectory: scratch,
      }).raster('<!doctype html>', { width: 10, height: 10 }),
    ).rejects.toThrow('Page.captureScreenshot failed');

    expect(readdirSync(scratch)).toEqual([]);
  });

  it('rejects a bad option before it opens anything', async () => {
    // `resolveRasterOptions` throws for what is wrong in the arguments alone. A window
    // created first would be a window leaked on a typo.
    let created = 0;
    const rasterizer = createDebuggerRasterizer({
      createWindow: async () => {
        created += 1;
        return recorder().window;
      },
      scratchDirectory: scratch,
    });

    await expect(rasterizer.raster('<!doctype html>', { width: 0, height: 10 })).rejects.toThrow(
      TypeError,
    );
    await expect(
      rasterizer.raster('<!doctype html>', { width: 10, height: 10, quality: 80 }),
    ).rejects.toThrow('does not apply to png');

    expect(created).toBe(0);
    expect(readdirSync(scratch)).toEqual([]);
  });
});
