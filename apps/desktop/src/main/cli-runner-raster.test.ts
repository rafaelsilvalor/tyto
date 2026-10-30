import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Rasterizer } from '@tyto/raster';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CliStateChange, createCliRunner, registeredRasterizer } from './cli-runner.js';

/**
 * A `render --types png` run from the window rasters through the window's rasterizer, the
 * instance the export uses (ADR 0159 decision 3). The real `run` here, the CLI's own fixture
 * project, and a rasterizer that records each frame; the hidden window itself is the export's
 * suite, so nothing here needs one.
 */

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/command-line/src/__fixtures__',
);

/** A real 1×1 PNG: the fixture brief draws `./logo.png`. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'tyto-cli-raster-'));
  const template = join(work, 'templates', 'cartaz');
  mkdirSync(join(template, 'assets'), { recursive: true });
  mkdirSync(join(work, 'task', 'assets'), { recursive: true });
  const copy = (from: string, to: string): void => {
    writeFileSync(to, readFileSync(join(FIXTURES, from)));
  };
  copy('cartaz.manifest.yaml', join(template, 'manifest.yaml'));
  copy('cartaz.html', join(template, 'template.html'));
  copy('mark.svg', join(template, 'assets', 'mark.svg'));
  copy('formats.yaml', join(work, 'formats.yaml'));
  copy('cartaz.brief', join(work, 'task', 'brief.brief'));
  writeFileSync(join(work, 'task', 'assets', 'logo.png'), LOGO_PNG);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('a png render run from the window', () => {
  it("rasters every frame through the window's own rasterizer", async () => {
    const frames: number[] = [];
    const windowRasterizer: Rasterizer = {
      raster: (_html, options) => {
        frames.push(options.width);
        return Promise.resolve(new TextEncoder().encode('png'));
      },
    };
    // The registry the app's `chromium` built-in registered into, as index.ts reads it.
    const registry = {
      rasterizers: <T>() => [{ value: windowRasterizer as T }],
    };
    const fromRegistry = registeredRasterizer(registry);
    const ended: CliStateChange[] = [];
    const cli = createCliRunner({
      environment: () => ({
        version: '0.0.0-test',
        cwd: work,
        rasterizer: () => {
          if (fromRegistry === undefined) throw new Error('no rasterizer');
          return fromRegistry;
        },
      }),
      refuse: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
      output: () => {},
      state: (change) => ended.push(change),
    });

    cli.start(['render', 'task/brief.brief', '--out', 'out', '--types', 'png']);
    await expect
      .poll(() => ended.find((change) => change.state === 'finished'), { timeout: 20_000 })
      .toBeDefined();

    expect(fromRegistry).toBe(windowRasterizer);
    expect(ended.find((change) => change.state === 'finished')?.code).toBe(0);
    expect(frames).toHaveLength(2);
    expect(readdirSync(join(work, 'out')).sort()).toEqual([
      'feed-01.png',
      'feed-02.png',
      'result.json',
    ]);
  });
});
