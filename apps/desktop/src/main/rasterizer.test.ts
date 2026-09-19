import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CAPTURE_DEADLINE_MS, type CaptureWindow, createDebuggerRasterizer } from './rasterizer.js';

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

/**
 * A step that is started and never answers — the shape TYTO-148 measured in the packaged app,
 * and the one thing a fake can reproduce that a real Electron cannot be asked for on demand.
 */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* deliberately never settles */
  });
}

/** Which awaited step a recorder refuses to answer, for the deadline tests. */
type Stall =
  | 'loadFile'
  | 'executeJavaScript'
  | 'Page.enable'
  | 'Emulation.setDeviceMetricsOverride'
  | 'Page.captureScreenshot';

interface RecorderOptions {
  readonly pixels?: string;
  readonly attachThrows?: Error;
  /** The step this window starts and never finishes. */
  readonly stall?: Stall;
  /** How long `Page.captureScreenshot` takes to answer — slow but real, for the deadline tests. */
  readonly captureDelayMs?: number;
  readonly detachThrows?: Error;
}

/** A `CaptureWindow` that answers `Page.captureScreenshot` with `pixels` and records the rest. */
function recorder(options: RecorderOptions = {}): Recorder {
  const calls: Call[] = [];
  const loaded: string[] = [];
  const evaluated: string[] = [];
  const state = { attaches: 0, detaches: 0, destroys: 0 };

  const window: CaptureWindow = {
    loadFile: async (file) => {
      loaded.push(file);
      if (options.stall === 'loadFile') return never<void>();
      return undefined;
    },
    executeJavaScript: async (code) => {
      evaluated.push(code);
      if (options.stall === 'executeJavaScript') return never<unknown>();
      return true;
    },
    attachDebugger: () => {
      if (options.attachThrows) throw options.attachThrows;
      state.attaches += 1;
    },
    sendCommand: async (method, parameters) => {
      calls.push({ method, parameters });
      if (options.stall === method) return never<unknown>();
      if (method === 'Page.captureScreenshot') {
        if (options.captureDelayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, options.captureDelayMs));
        }
        return { data: options.pixels ?? Buffer.from('bytes').toString('base64') };
      }
      return {};
    },
    detachDebugger: () => {
      state.detaches += 1;
      if (options.detachThrows) throw options.detachThrows;
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

/**
 * A `createWindow` that hands out the given recorders in order and counts how many were asked
 * for, so a test can say what the retry did rather than infer it from a destroy count.
 */
function windowsFor(recorders: readonly Recorder[]): {
  readonly createWindow: () => Promise<CaptureWindow>;
  readonly created: () => number;
} {
  let created = 0;
  return {
    createWindow: async () => {
      const next = recorders[Math.min(created, recorders.length - 1)];
      if (!next) throw new Error('windowsFor was given no recorders');
      created += 1;
      return next.window;
    },
    created: () => created,
  };
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

/**
 * The deadline, the retry, and what survives both (TYTO-148, ADR 0030).
 *
 * The shape under test is a step that is **started and never answers** — measured in the
 * packaged app, where 15 of 80 captures never got a reply to `Page.captureScreenshot` at any
 * length of wait, against 0 of 20 in the dev build. A real Electron cannot be asked to do that
 * on demand, which is why these run against the {@link CaptureWindow} seam and why the deadline
 * is an option: every test here sets it in the tens of milliseconds, so the file stays fast.
 */
describe('createDebuggerRasterizer, when a step never answers', () => {
  it('abandons the capture and names the step and the deadline', async () => {
    const stalled = [
      recorder({ stall: 'Page.captureScreenshot' }),
      recorder({ stall: 'Page.captureScreenshot' }),
    ];
    const windows = windowsFor(stalled);

    await expect(
      createDebuggerRasterizer({
        createWindow: windows.createWindow,
        scratchDirectory: scratch,
        captureDeadlineMs: 25,
      }).raster('<!doctype html>', { width: 10, height: 10 }),
    ).rejects.toThrow(/did not answer Page\.captureScreenshot within 25 ms/);

    // The message is the whole diagnostic: it becomes `E_RENDER_FAILED`'s `{problem}` and the
    // export dialog shows it verbatim, so the step's name is the one thing a reader gets.
    //
    // Two attempts and no more — a second deadline is a failed frame, not a third window.
    expect(windows.created()).toBe(2);
    // Both windows reclaimed. A hang used to leak the window *and* the temp folder, because
    // both cleanups sit in `finally` blocks a never-settling await never reaches.
    expect(stalled.map((recorded) => recorded.destroys)).toEqual([1, 1]);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it('deadlines loadFile too, not only the step that was measured to hang', async () => {
    // `Page.captureScreenshot` is what hung on win32. The card's title is that *nothing* in the
    // path has a deadline, and one platform's measurement is not a reason to guard one step.
    const stalled = [recorder({ stall: 'loadFile' }), recorder({ stall: 'loadFile' })];
    const windows = windowsFor(stalled);

    await expect(
      createDebuggerRasterizer({
        createWindow: windows.createWindow,
        scratchDirectory: scratch,
        captureDeadlineMs: 25,
      }).raster('<!doctype html>', { width: 10, height: 10 }),
    ).rejects.toThrow(/did not answer loadFile within 25 ms/);

    expect(stalled.map((recorded) => recorded.detaches)).toEqual([0, 0]);
    expect(stalled.map((recorded) => recorded.destroys)).toEqual([1, 1]);
  });

  it('deadlines the fonts wait under the name a reader would look for', async () => {
    const stalled = [
      recorder({ stall: 'executeJavaScript' }),
      recorder({ stall: 'executeJavaScript' }),
    ];

    await expect(
      createDebuggerRasterizer({
        createWindow: windowsFor(stalled).createWindow,
        scratchDirectory: scratch,
        captureDeadlineMs: 25,
      }).raster('<!doctype html>', { width: 10, height: 10 }),
    ).rejects.toThrow(/did not answer document\.fonts\.ready within 25 ms/);
  });

  it('does not abort a capture that is slow but real', async () => {
    // The measured spread of a capture that *does* answer is 39–1 075 ms, and the packaged
    // build's slow mode sits near the top of it. This is the test that stops a future
    // "tighten the deadline" from quietly throwing away work that was on its way.
    const recorded = recorder({
      pixels: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
      captureDelayMs: 40,
    });
    const windows = windowsFor([recorded]);

    const bytes = await createDebuggerRasterizer({
      createWindow: windows.createWindow,
      scratchDirectory: scratch,
      captureDeadlineMs: 500,
    }).raster('<!doctype html>', { width: 10, height: 10 });

    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(windows.created()).toBe(1);
  });

  it('keeps the deadline as the reported error when detaching throws on the way out', async () => {
    // Detaching from a target that stopped answering is exactly the case this runs in. An
    // unguarded throw here would replace the error that says what went wrong *and* skip
    // `destroy()` — leaking the window the deadline exists to reclaim.
    const stalled = [
      recorder({ stall: 'Page.captureScreenshot', detachThrows: new Error('target closed') }),
      recorder({ stall: 'Page.captureScreenshot', detachThrows: new Error('target closed') }),
    ];

    const failure: unknown = await createDebuggerRasterizer({
      createWindow: windowsFor(stalled).createWindow,
      scratchDirectory: scratch,
      captureDeadlineMs: 25,
    })
      .raster('<!doctype html>', { width: 10, height: 10 })
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('did not answer Page.captureScreenshot');
    expect((failure as Error).message).not.toContain('target closed');
    expect(stalled.map((recorded) => recorded.destroys)).toEqual([1, 1]);
  });

  it('retries once on a fresh window, which is containment and not a cure', async () => {
    // Measured: retrying a hung capture recovered 9 of 15. Six hung again, which is why the
    // test above exists and why this one is not called "recovers".
    const first = recorder({ stall: 'Page.captureScreenshot' });
    const second = recorder({ pixels: Buffer.from([0x89, 0x50]).toString('base64') });
    const windows = windowsFor([first, second]);

    const bytes = await createDebuggerRasterizer({
      createWindow: windows.createWindow,
      scratchDirectory: scratch,
      captureDeadlineMs: 25,
    }).raster('<!doctype html>', { width: 10, height: 10 });

    expect(Array.from(bytes)).toEqual([0x89, 0x50]);
    expect(windows.created()).toBe(2);
    expect([first.destroys, second.destroys]).toEqual([1, 1]);
  });

  it('does not retry a rejection that is not a deadline', async () => {
    // A protocol error is a real answer. Asking twice would turn one genuine failure into two
    // of it, a little later, and would double the wait on a document that is simply broken.
    const base = recorder();
    const exploding: CaptureWindow = {
      ...base.window,
      sendCommand: async (method) => {
        if (method === 'Page.captureScreenshot') throw new Error('Protocol error: no such target');
        return {};
      },
    };
    let created = 0;

    await expect(
      createDebuggerRasterizer({
        createWindow: async () => {
          created += 1;
          return exploding;
        },
        scratchDirectory: scratch,
        captureDeadlineMs: 25,
      }).raster('<!doctype html>', { width: 10, height: 10 }),
    ).rejects.toThrow('Protocol error: no such target');

    expect(created).toBe(1);
  });

  it('defaults to CAPTURE_DEADLINE_MS when the caller names no deadline', async () => {
    // The shipped adapter is constructed with no options at all (`src/main/plugins.ts`), so
    // the default is the number that actually runs. Fake timers rather than a 30 s wait; only
    // the timer functions are faked, so the real file writes this path does still complete.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const stalled = [
        recorder({ stall: 'Page.captureScreenshot' }),
        recorder({ stall: 'Page.captureScreenshot' }),
      ];
      const failure = createDebuggerRasterizer({
        createWindow: windowsFor(stalled).createWindow,
        scratchDirectory: scratch,
      })
        .raster('<!doctype html>', { width: 10, height: 10 })
        .catch((cause: unknown) => cause);

      // The temp folder and the document are real I/O, so the timer cannot be advanced until
      // the capture has actually reached the step that stalls.
      while (stalled[0]?.calls.length !== 3) {
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
      }

      await vi.advanceTimersByTimeAsync(CAPTURE_DEADLINE_MS);
      await vi.advanceTimersByTimeAsync(CAPTURE_DEADLINE_MS);

      expect((await failure) as Error).toHaveProperty(
        'message',
        expect.stringContaining(`within ${CAPTURE_DEADLINE_MS} ms`),
      );
      expect(CAPTURE_DEADLINE_MS).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
