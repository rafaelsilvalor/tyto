import type { BrowserType } from 'playwright';
import { describe, expect, it } from 'vitest';

import { createPlaywrightRasterizer } from './playwright.js';

/**
 * How many browsers the adapter launches, and whether the ones it launched got closed.
 *
 * The rest of the adapter's browser work is checked through Chromium in
 * `raster.visual.test.ts`, because pixels are the only thing that proves a render. This is
 * the half a browser cannot answer. Through a real Chromium the count is observable only as
 * a process that never exits, which is how TYTO-88 stayed hidden: no test rendered a PNG
 * through the CLI, and nothing anywhere counted launches.
 *
 * The double goes in through `browserType` rather than through a module mock. That was
 * measured, not assumed: `vi.mock('playwright', …)` reached the adapter in a file with one
 * test and let a real Chromium through in this one, with Playwright's own call log in the
 * failure. A seam the adapter declares cannot half-apply.
 */

interface Spy {
  readonly browserType: BrowserType;
  /** How many browsers were launched, in order. */
  readonly launches: () => number;
  /** How many were closed through `Browser.close`. */
  readonly closes: () => number;
  /** Live state per launched browser, so a test can kill one and watch the replacement. */
  readonly connected: () => readonly boolean[];
  /** Kills the browser at `index` the way a crash would, without telling the adapter. */
  readonly kill: (index: number) => void;
}

function spyBrowserType(): Spy {
  const connected: boolean[] = [];
  let closes = 0;

  const page = {
    setContent: async () => undefined,
    evaluate: async () => undefined,
    // The four bytes a PNG opens with, so a caller that checks the shape of what came back
    // is not looking at an empty buffer.
    screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };

  const browserType = {
    launch: async () => {
      const index = connected.length;
      connected.push(true);

      return {
        isConnected: () => connected[index] === true,
        newContext: async () => ({
          newPage: async () => page,
          close: async () => undefined,
        }),
        close: async () => {
          // A second close on the same browser is a no-op in Playwright too, and counting
          // it would make `closes` a count of calls rather than of browsers shut down.
          if (connected[index] === true) closes += 1;
          connected[index] = false;
        },
      };
    },
  };

  return {
    // The double answers the one method the adapter calls. Cast rather than implemented,
    // because `BrowserType` also declares `connect`, `launchServer` and `name`, and a stub
    // of those would be three lies instead of zero.
    browserType: browserType as unknown as BrowserType,
    launches: () => connected.length,
    closes: () => closes,
    connected: () => [...connected],
    kill: (index) => {
      connected[index] = false;
    },
  };
}

const PAGE = { width: 100, height: 100 } as const;

function rasterizerWith(spy: Spy) {
  return createPlaywrightRasterizer({ browserType: spy.browserType });
}

describe('one rasterizer, one browser', () => {
  it('launches once for two rasters in flight, not once each', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);

    // The shape that was broken: both callers reach the launch bookkeeping before either
    // launch has resolved. `await launching` yielded even with nothing to await, so both
    // resumed with `undefined`, both fell through the guard, and both launched. The second
    // assignment won, so `close` closed the second and the first stayed alive.
    await Promise.all([rasterizer.raster('<p>a</p>', PAGE), rasterizer.raster('<p>b</p>', PAGE)]);

    expect(spy.launches()).toBe(1);

    await rasterizer.close();

    expect(spy.closes()).toBe(1);
    // The claim the CLI actually depends on: nothing left running. A browser the rasterizer
    // no longer holds is a child process that keeps Node alive forever.
    expect(spy.connected()).toEqual([false]);
  });

  it('launches once for six, which is past any concurrency the CLI offers', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);

    await Promise.all(
      Array.from({ length: 6 }, (_, index) => rasterizer.raster(`<p>${index}</p>`, PAGE)),
    );

    expect(spy.launches()).toBe(1);

    await rasterizer.close();
    expect(spy.connected()).toEqual([false]);
  });

  it('reuses the browser across rasters that do not overlap', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);

    await rasterizer.raster('<p>a</p>', PAGE);
    await rasterizer.raster('<p>b</p>', PAGE);

    expect(spy.launches()).toBe(1);
    await rasterizer.close();
  });

  it('launches nothing for a rasterizer nobody rastered with', async () => {
    const spy = spyBrowserType();

    await rasterizerWith(spy).close();

    expect(spy.launches()).toBe(0);
  });
});

describe('a browser that died', () => {
  it('is replaced once, even by callers that arrive together', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);
    await rasterizer.raster('<p>a</p>', PAGE);

    // Crashed, or killed with the terminal it was started from.
    spy.kill(0);

    await Promise.all([rasterizer.raster('<p>b</p>', PAGE), rasterizer.raster('<p>c</p>', PAGE)]);

    // Two in total — the dead one and its single replacement. Three would mean the
    // replacement path still had the bug the launch path just lost.
    expect(spy.launches()).toBe(2);

    await rasterizer.close();
    expect(spy.connected()).toEqual([false, false]);
  });

  it('is not an error the next render inherits', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);
    await rasterizer.raster('<p>a</p>', PAGE);
    spy.kill(0);

    await expect(rasterizer.raster('<p>b</p>', PAGE)).resolves.toBeInstanceOf(Uint8Array);
    await rasterizer.close();
  });
});

describe('close', () => {
  it('closes the browser it launched, and stays idempotent', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);
    await rasterizer.raster('<p>a</p>', PAGE);

    await rasterizer.close();
    await rasterizer.close();

    expect(spy.closes()).toBe(1);
  });

  it('lets a later raster launch a new browser, for a process that renders between jobs', async () => {
    const spy = spyBrowserType();
    const rasterizer = rasterizerWith(spy);
    await rasterizer.raster('<p>a</p>', PAGE);
    await rasterizer.close();

    await rasterizer.raster('<p>b</p>', PAGE);

    expect(spy.launches()).toBe(2);

    await rasterizer.close();
    expect(spy.closes()).toBe(2);
  });
});
