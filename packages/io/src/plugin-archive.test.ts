import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readZip } from './plugin-archive.js';
import { type ArchiveDownload, syncPluginFolder } from './plugin-files.js';

/**
 * Archive sources (ADR 0197): a `.zip` over https or on this machine, without `git`. Every
 * archive is written here byte by byte, and https is a download injected through the sync's
 * seam, so nothing reaches the network.
 */

interface ZipEntry {
  readonly name: string;
  readonly text?: string;
  /** A Unix mode for the entry, as a link is marked. */
  readonly mode?: number;
}

/** A `.zip` as a repository host writes a tag archive: deflated, Unix modes, one top folder. */
function zip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.text ?? '', 'utf8');
    const packed = entry.name.endsWith('/') ? data : deflateRawSync(data);
    const method = entry.name.endsWith('/') ? 0 : 8;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const manifest = (version: string): string =>
  JSON.stringify({
    name: 'fixture',
    version,
    engine: '>=0.1.0',
    contributes: ['template-pack'],
    permissions: [],
  });

/** A plugin's tag archive, its files under `fixture-<tag>/`. */
const pluginArchive = (tag: string, extra: readonly ZipEntry[] = []): Uint8Array =>
  zip([
    { name: `fixture-${tag}/`, mode: 0o040755 },
    { name: `fixture-${tag}/tyto-plugin.json`, text: manifest(tag.replace(/^v/u, '')) },
    { name: `fixture-${tag}/templates/a/template.html`, text: '<p>a</p>' },
    ...extra,
  ]);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('reading a .zip', () => {
  it('drops the single top folder a tag archive puts everything under', () => {
    const read = readZip(pluginArchive('v1.0.0'));

    expect(read.ok && read.value.map((file) => file.path)).toEqual([
      'tyto-plugin.json',
      'templates/a/template.html',
    ]);
    expect(read.ok && new TextDecoder().decode(read.value[1]?.bytes)).toBe('<p>a</p>');
  });

  it('keeps the paths as they are when there is no single top folder', () => {
    const read = readZip(zip([{ name: 'tyto-plugin.json', text: '{}' }, { name: 'a/b.txt' }]));

    expect(read.ok && read.value.map((file) => file.path)).toEqual(['tyto-plugin.json', 'a/b.txt']);
  });

  it.each([
    ['a name that climbs out', [{ name: 'top/../../evil.txt', text: 'x' }]],
    ['an absolute name', [{ name: '/etc/evil', text: 'x' }]],
    ['a drive letter', [{ name: 'C:/evil', text: 'x' }]],
    ['a backslash', [{ name: 'top\\evil', text: 'x' }]],
    ['a link', [{ name: 'top/link', text: '/etc/passwd', mode: 0o120777 }]],
    ['two names Windows reads as one', [{ name: 'A.txt' }, { name: 'a.txt' }]],
  ])('refuses %s', (_, entries) => {
    expect(readZip(zip(entries)).ok).toBe(false);
  });

  it('refuses bytes that are no .zip', () => {
    const read = readZip(new TextEncoder().encode('<html>not found</html>'));

    expect(read).toEqual({ ok: false, error: 'it is not a .zip' });
  });
});

let root: string;
let home: string;
let folder: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-plugin-archive-'));
  home = join(root, 'home');
  folder = join(root, 'plugin-files');
  await mkdir(folder, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const URL_TEMPLATE = 'https://example.test/fixture/archive/refs/tags/{ref}.zip';

async function archiveFile(archive: string, ref: string): Promise<void> {
  await writeFile(
    join(folder, 'pack.yaml'),
    `version: 1\nplugin:\n  source: { archive: '${archive}', ref: '${ref}' }\n`,
    'utf8',
  );
}

/** A download that serves `served` by URL and records every URL it was asked. */
function server(served: Map<string, Uint8Array>): { download: ArchiveDownload; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    download: async (url) => {
      asked.push(url);
      const bytes = served.get(url);
      if (bytes === undefined) throw new Error('the server answered 404');
      return bytes;
    },
  };
}

const sync = (download: ArchiveDownload, update = false) =>
  syncPluginFolder({
    home,
    directory: folder,
    shown: (path) => path,
    update,
    fetches: true,
    download,
  });

async function lockOf(): Promise<unknown> {
  return JSON.parse(await readFile(join(folder, 'plugin-files.lock.json'), 'utf8'));
}

describe('an archive source', () => {
  it('downloads the ref the file names over https, without git, and pins its sha256', async () => {
    const bytes = pluginArchive('v1.0.0');
    const { download, asked } = server(
      new Map([['https://example.test/fixture/archive/refs/tags/v1.0.0.zip', bytes]]),
    );
    await archiveFile(URL_TEMPLATE, 'v1.0.0');

    const synced = await sync(download);

    expect(synced.diagnostics).toEqual([]);
    expect(asked).toEqual(['https://example.test/fixture/archive/refs/tags/v1.0.0.zip']);
    expect(synced.copies.map((copy) => [copy.plugin, copy.pin])).toEqual([
      ['fixture', sha256(bytes)],
    ]);
    const directory = synced.copies[0]?.directory ?? '';
    // No deeper than a commit's copy, so TYTO-470's longest path still holds.
    expect(basename(directory)).toBe(sha256(bytes).slice(0, 40));
    expect(await readFile(join(directory, 'templates', 'a', 'template.html'), 'utf8')).toBe(
      '<p>a</p>',
    );
    expect(await lockOf()).toEqual({
      version: 1,
      sources: [{ archive: URL_TEMPLATE, ref: 'v1.0.0', sha256: sha256(bytes), plugin: 'fixture' }],
    });
  });

  it('reads a .zip on this machine, relative to the plugin file', async () => {
    const bytes = pluginArchive('v2.0.0');
    await writeFile(join(folder, 'fixture-v2.0.0.zip'), bytes);
    await archiveFile('./fixture-{ref}.zip', 'v2.0.0');
    const { download, asked } = server(new Map());

    const synced = await sync(download);

    expect(synced.diagnostics).toEqual([]);
    expect(asked).toEqual([]);
    expect(synced.copies.map((copy) => copy.pin)).toEqual([sha256(bytes)]);
  });

  it('loads a pinned archive from the cache and asks nothing', async () => {
    const bytes = pluginArchive('v1.0.0');
    const first = server(new Map([[URL_TEMPLATE.replace('{ref}', 'v1.0.0'), bytes]]));
    await archiveFile(URL_TEMPLATE, 'v1.0.0');
    await sync(first.download);
    const second = server(new Map());

    const synced = await sync(second.download);

    expect(second.asked).toEqual([]);
    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.pin)).toEqual([sha256(bytes)]);
  });

  it('refuses a pinned archive whose bytes changed, and loads nothing from the new ones', async () => {
    const url = URL_TEMPLATE.replace('{ref}', 'v1.0.0');
    const original = pluginArchive('v1.0.0');
    await archiveFile(URL_TEMPLATE, 'v1.0.0');
    await sync(server(new Map([[url, original]])).download);
    // The cache is gone, so the pinned source must be fetched again, and the server now serves
    // other bytes under the same tag.
    await rm(join(home, 'cache'), { recursive: true, force: true });
    const swapped = pluginArchive('v1.0.0', [{ name: 'fixture-v1.0.0/evil.js', text: 'x' }]);

    const synced = await sync(server(new Map([[url, swapped]])).download);

    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics.map((item) => item.code)).toEqual(['W_PLUGIN_FILE_FETCH']);
    expect(synced.diagnostics[0]?.message).toContain(
      'its bytes changed since the lock pinned them',
    );
    expect(await lockOf()).toEqual({
      version: 1,
      sources: [
        { archive: URL_TEMPLATE, ref: 'v1.0.0', sha256: sha256(original), plugin: 'fixture' },
      ],
    });
  });

  it('takes the new bytes on the explicit update', async () => {
    const url = URL_TEMPLATE.replace('{ref}', 'v1.0.0');
    await archiveFile(URL_TEMPLATE, 'v1.0.0');
    await sync(server(new Map([[url, pluginArchive('v1.0.0')]])).download);
    const swapped = pluginArchive('v1.0.0', [{ name: 'fixture-v1.0.0/more.txt', text: 'x' }]);

    const synced = await sync(server(new Map([[url, swapped]])).download, true);

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.pin)).toEqual([sha256(swapped)]);
  });

  it('refuses an archive that holds no plugin, and says which', async () => {
    const url = URL_TEMPLATE.replace('{ref}', 'v1.0.0');
    await archiveFile(URL_TEMPLATE, 'v1.0.0');
    const empty = zip([
      { name: 'top/', mode: 0o040755 },
      { name: 'top/readme.txt', text: 'x' },
    ]);

    const synced = await sync(server(new Map([[url, empty]])).download);

    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics.map((item) => item.code)).toEqual(['E_PLUGIN_FILE_SOURCE_REFUSED']);
    expect(synced.diagnostics[0]?.message).toContain(`archive sha256 ${sha256(empty)}`);
  });

  it('downloads nothing into a home too deep for its copies (TYTO-470)', async () => {
    await archiveFile(URL_TEMPLATE, 'v1.0.0');
    const { download, asked } = server(
      new Map([[URL_TEMPLATE.replace('{ref}', 'v1.0.0'), pluginArchive('v1.0.0')]]),
    );

    const synced = await syncPluginFolder({
      home,
      directory: folder,
      shown: (path) => path,
      update: false,
      fetches: true,
      download,
      homePath: { limit: 10 },
    });

    expect(asked).toEqual([]);
    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics.map((item) => item.code)).toEqual(['E_TYTO_HOME_PATH_TOO_LONG']);
  });

  it('says what the server answered when the download fails', async () => {
    await archiveFile(URL_TEMPLATE, 'v9.9.9');

    const synced = await sync(server(new Map()).download);

    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics[0]?.message).toContain('the server answered 404');
  });
});
