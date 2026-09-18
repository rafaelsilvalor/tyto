import { type DirectoryEntry, type FileSystem } from '@tyto/core';
import type { Rasterizer } from '@tyto/raster';
import { describe, expect, it } from 'vitest';

import { activateBuiltIns, builtInTemplatesDirectory } from './plugins.js';

/**
 * The composition root, without Electron.
 *
 * `plugins.ts` names no Electron API — it takes a `FileSystem` and hands back a host — so
 * what the desktop app wires can be asserted in `pnpm check` rather than only in a window.
 * The end-to-end suite then checks the other half: that what this registers is what the
 * window reports.
 */

const MANIFEST = (name: string): string =>
  [
    'name: ' + name,
    'version: 1.0.0',
    'formats: [feed]',
    'slots:',
    '  titulo: { type: rich-text }',
  ].join('\n');

/**
 * A disk with one template folder per name on it, and nothing else.
 *
 * The registry looks twice: once at the root for candidate folders, and once inside each
 * for a `manifest.yaml`. A fake that answered the first and not the second would produce an
 * empty pack and a test that passed for the wrong reason.
 */
const fakeFileSystem = (templates: readonly string[]): FileSystem => ({
  join: (...segments) => segments.join('/'),
  readDirectory: (path): Promise<readonly DirectoryEntry[]> =>
    Promise.resolve(
      templates.some((name) => path.endsWith(`/${name}`))
        ? [{ name: 'manifest.yaml', isDirectory: false }]
        : templates.map((name) => ({ name, isDirectory: true })),
    ),
  readFile: (path) => {
    const name = templates.find((template) => path.includes(template));
    if (name === undefined) return Promise.reject(new Error(`no such file: ${path}`));
    return Promise.resolve(MANIFEST(name));
  },
});

describe('activateBuiltIns', () => {
  it('registers the built-in pack through the extension point', async () => {
    const host = await activateBuiltIns({
      fileSystem: fakeFileSystem(['promo-curso', 'carrossel-lista']),
      directory: '/packs/built-in',
    });

    const packs = host.registry.templatePacks();

    expect(packs).toHaveLength(1);
    expect(packs[0]?.id).toBe('built-in-templates');
    expect(packs[0]?.directory).toBe('/packs/built-in');
  });

  it('carries the templates the registry read, so the app never reads them twice', async () => {
    const host = await activateBuiltIns({
      fileSystem: fakeFileSystem(['promo-curso', 'carrossel-lista']),
      directory: '/packs/built-in',
    });

    const names = host.registry
      .templatePacks()
      .flatMap((pack) => pack.templates.map((template) => template.name))
      .sort();

    expect(names).toEqual(['carrossel-lista', 'promo-curso']);
  });

  it('goes through the host’s door, which is what validates the manifest', async () => {
    const host = await activateBuiltIns({
      fileSystem: fakeFileSystem(['promo-curso']),
      directory: '/packs/built-in',
    });

    // `activate` records the plugin; `hostFor` would have registered the contribution and
    // left no trace. A plugins panel reads this list, and so does the check that a plugin
    // contributed only what its manifest declared.
    expect(host.registry.plugins().map((plugin) => plugin.manifest.name)).toEqual([
      'built-in-templates',
      'chromium',
    ]);
  });

  it('registers a rasterizer, and nothing below the root knows which one', async () => {
    // The swappability ADR 0010 asks for, proved rather than asserted: a fake goes in
    // through the same door the debugger-captured window uses, and what comes back out of
    // the registry is that fake. The app's own choice is made one line above, in
    // `activateBuiltIns`, and nowhere else.
    const captured: string[] = [];
    const fake = {
      raster: async (html: string): Promise<Uint8Array> => {
        captured.push(html);
        return new Uint8Array([1, 2, 3]);
      },
    };

    const host = await activateBuiltIns({
      fileSystem: fakeFileSystem(['promo-curso']),
      directory: '/packs/built-in',
      rasterizer: fake,
    });

    const registered = host.registry.rasterizers<Rasterizer>();

    expect(registered).toHaveLength(1);
    expect(registered[0]?.id).toBe('chromium');

    const bytes = await registered[0]?.value.raster('<!doctype html>', { width: 10, height: 10 });

    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
    expect(captured).toEqual(['<!doctype html>']);
  });

  it('still opens when the pack folder cannot be read, with an empty pack', async () => {
    const broken: FileSystem = {
      join: (...segments) => segments.join('/'),
      readDirectory: () => Promise.reject(new Error('EACCES')),
      readFile: () => Promise.reject(new Error('EACCES')),
    };

    const host = await activateBuiltIns({ fileSystem: broken, directory: '/packs/built-in' });

    // The desktop should open and say it has no templates rather than refuse to open. A
    // window that will not start is a worse answer to a permissions problem than an empty
    // picker with the folder named in it.
    expect(host.registry.templatePacks()).toHaveLength(1);
    expect(host.registry.templatePacks()[0]?.templates).toEqual([]);
  });
});

describe('builtInTemplatesDirectory', () => {
  it('resolves to a real folder inside the installed package', () => {
    // Resolved through `@tyto/templates/package.json` rather than assembled from a guess
    // about `node_modules`, which is the one form that survives a pnpm workspace, a
    // published install and an Electron `asar`.
    const directory = builtInTemplatesDirectory();

    expect(directory).toMatch(/templates$/u);
    expect(directory).toContain('templates');
  });
});
