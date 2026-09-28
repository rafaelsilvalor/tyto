import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Plugin, createPluginHost } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installedPacks } from './installed-packs.js';

/**
 * `allowCode` (ADR 0048): an app runs an installed code template only when it says it can.
 *
 * The default is the refusal, so a caller with no isolated runner — the desktop until
 * TYTO-189's second pull request, or anything written later that forgets the option — gets
 * `E_PLUGIN_PACK_CODE` and never a template it would have to draw some other way.
 */

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tyto-installed-packs-'));
  const template = join(folder, 'templates', 'cartaz');
  await mkdir(template, { recursive: true });
  await writeFile(
    join(template, 'manifest.yaml'),
    'name: cartaz\nversion: 1.0.0\nformats: [feed]\nslots: {}\n',
  );
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** A plugin whose pack has one code template and a `build` for it. */
function codePack(): { plugin: Plugin; calls: string[] } {
  const calls: string[] = [];
  const plugin: Plugin = {
    id: 'cartaz',
    manifest: {
      name: 'cartaz',
      version: '1.0.0',
      engine: '>=0.1',
      contributes: ['template-pack'],
      permissions: [],
    },
    activate: (host) =>
      host.registerTemplatePack({
        id: 'cartaz',
        templates: [],
        directory: 'templates',
        build: (template) => {
          calls.push(template);
          throw new Error('not called by installedPacks');
        },
      }),
  };
  return { plugin, calls };
}

const loadedOf = (plugin: Plugin) => ({
  plugins: [plugin],
  warnings: [],
  close: async () => undefined,
});

describe('an installed pack with a code template', () => {
  it('is refused with E_PLUGIN_PACK_CODE unless the app says it runs code templates', async () => {
    const { plugin } = codePack();

    const packs = await installedPacks(createPluginHost(), loadedOf(plugin), () => folder);

    expect([...packs.refused]).toEqual(['cartaz']);
    expect(packs.code).toEqual([]);
    expect(packs.directories).toEqual([]);
    expect(packs.warnings.map((item) => item.message)).toEqual([
      "Plugin 'cartaz' was skipped: Plugin 'cartaz' contributes template 'cartaz', and it is a code template, which this app cannot run from a plugin yet.",
    ]);
  });

  it("is routed to the pack's build when the app runs code templates", async () => {
    const { plugin, calls } = codePack();

    const packs = await installedPacks(createPluginHost(), loadedOf(plugin), () => folder, {
      allowCode: true,
    });

    expect(packs.warnings).toEqual([]);
    expect(packs.refused.size).toBe(0);
    expect(packs.code.map((pack) => pack.plugin)).toEqual(['cartaz']);
    expect(packs.directories).toHaveLength(1);
    // Checked and handed over, not run: drawing is the template source's, per frame.
    expect(calls).toEqual([]);
  });
});
