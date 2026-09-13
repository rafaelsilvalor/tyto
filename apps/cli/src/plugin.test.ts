import { htmlExporterManifest, htmlExporterPlugin } from '@tyto/export-html';
import { svgExporterManifest, svgExporterPlugin } from '@tyto/export-svg';
import { validatePluginManifest } from '@tyto/plugin-api';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { BUILT_IN_MANIFESTS } from './plugins/index.js';
import { sinkPlugin, sourcePlugin } from './plugins/queue.js';
import { rasterizerPlugin } from './plugins/rasterizer.js';
import { templatePackPlugin } from './plugins/templates.js';
import { run } from './program.js';

/**
 * `tyto plugin list` and the catalog it reads (TYTO-35).
 *
 * The acceptance criterion is *"shows all built-ins with correct contributes"*, and the
 * word doing the work is **correct**: a listing that prints whatever a file claims has
 * shown something, not verified it. So there are two halves here — what the command
 * prints, and whether the catalog it prints from is still the same set of manifests the
 * plugins themselves ship.
 */

const TYTO_VERSION = '0.0.0-test';

let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: TYTO_VERSION,
    cwd: process.cwd(),
    rasterizer: () => {
      throw new Error('plugin list must not need a rasterizer');
    },
  };
}

beforeEach(() => {
  out = [];
  errors = [];
});

describe('tyto plugin list', () => {
  it('lists every built-in, with its version, origin and contributes', async () => {
    const code = await run(['plugin', 'list'], environment());

    expect(code).toBe(EXIT_OK);
    expect(out.join('')).toMatchInlineSnapshot(`
      "html                0.4.2  built-in  exporter
      svg                 1.0.2  built-in  exporter
      built-in-templates  0.1.0  built-in  template-pack
      chromium            0.1.0  built-in  rasterizer
      fs-inbox            1.0.3  built-in  source
      fs-outbox           1.0.3  built-in  sink
      "
    `);
  });

  it('prints a machine-readable document under --json', async () => {
    const code = await run(['plugin', 'list', '--json'], environment());
    const document = JSON.parse(out.join('')) as {
      status: string;
      plugins: { name: string; contributes: string[]; origin: string }[];
    };

    expect(code).toBe(EXIT_OK);
    expect(document.status).toBe('ok');
    expect(document.plugins.map((plugin) => [plugin.name, plugin.contributes.join()])).toEqual([
      ['html', 'exporter'],
      ['svg', 'exporter'],
      ['built-in-templates', 'template-pack'],
      ['chromium', 'rasterizer'],
      ['fs-inbox', 'source'],
      ['fs-outbox', 'sink'],
    ]);
    expect(document.plugins.every((plugin) => plugin.origin === 'built-in')).toBe(true);
  });

  it('needs no browser, which is why it reads manifests instead of activating', async () => {
    // `environment().rasterizer` throws. Listing what is installed must not be the command
    // that launches Chromium to find out that Chromium is installed.
    await expect(run(['plugin', 'list'], environment())).resolves.toBe(EXIT_OK);
    expect(errors).toEqual([]);
  });
});

describe('the catalog the listing reads', () => {
  it('holds the very manifest each plugin ships, not a copy of it', () => {
    // Identity, not equality. Two objects that happen to match today are two objects that
    // can stop matching tomorrow; this fails the moment a plugin's manifest and the
    // catalog's entry stop being the same file.
    const shipped = [
      htmlExporterManifest,
      svgExporterManifest,
      templatePackPlugin().manifest,
      rasterizerPlugin({ raster: () => Promise.resolve(new Uint8Array()) }).manifest,
      sourcePlugin({ pull: () => Promise.resolve([]), ack: () => Promise.resolve() }).manifest,
      sinkPlugin({ open: () => Promise.reject(new Error('not opened')) }).manifest,
    ];

    for (const manifest of shipped) expect(BUILT_IN_MANIFESTS).toContain(manifest);
    expect(BUILT_IN_MANIFESTS).toHaveLength(shipped.length);
  });

  it('holds a manifest whose name is the plugin id, for every built-in', () => {
    // The host throws on a disagreement at activation; this catches the same thing without
    // activating, which is the only way the two queue plugins get checked at all — nothing
    // in a render wires them.
    const named = [
      htmlExporterPlugin(),
      svgExporterPlugin(),
      templatePackPlugin(),
      rasterizerPlugin({ raster: () => Promise.resolve(new Uint8Array()) }),
      sourcePlugin({ pull: () => Promise.resolve([]), ack: () => Promise.resolve() }),
      sinkPlugin({ open: () => Promise.reject(new Error('not opened')) }),
    ];

    for (const plugin of named) {
      const validated = validatePluginManifest(plugin.manifest);
      expect(validated.ok, `${plugin.id} ships a manifest that does not validate`).toBe(true);
      expect(validated.ok && validated.value.name).toBe(plugin.id);
    }
  });
});
