import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Size, Trust } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workspaceDeliveryPorts } from './workspace-deliveries.js';

/**
 * `to-delivery`'s workspace ports (ADR 0210) on a real folder: the layout read from the project
 * file on every call, the folders made, and the refusals the verb cannot make lexically — a link
 * out of the workspace, `.tyto`, and a folder restricted since the plan.
 */

let scratch: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-workspace-deliveries-')));
  workspace = join(scratch, 'campanha');
  outside = join(scratch, 'elsewhere');
  await mkdir(join(workspace, '.tyto'), { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function project(delivery: unknown): Promise<void> {
  await writeFile(join(workspace, '.tyto', 'project.json'), JSON.stringify({ delivery }), 'utf8');
}

function ports(
  trust: () => Trust = () => 'trusted',
  inWorkspace = true,
  formatSizes?: () => Promise<Readonly<Record<string, Size>>>,
) {
  return workspaceDeliveryPorts({
    workspaceFolder: inWorkspace ? workspace : undefined,
    trust,
    home: join(scratch, 'home'),
    ...(formatSizes === undefined ? {} : { formatSizes }),
  });
}

/** A PNG header that states `width` by `height`: all `imageSize` reads. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89_50_4e_47, 0);
  bytes.writeUInt32BE(0x0d_0a_1a_0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/**
 * A JPEG whose frame header comes after `metadata` bytes of APP1 segments, as a camera's or an
 * editor's long metadata puts it: past the head the port reads first.
 */
function jpeg(width: number, height: number, metadata: number): Buffer {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (let left = metadata; left > 0; left -= 60_000) {
    const length = Math.min(left, 60_000);
    const segment = Buffer.alloc(4 + length);
    segment.writeUInt16BE(0xff_e1, 0);
    segment.writeUInt16BE(length + 2, 2);
    parts.push(segment);
  }
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(0xff_c0, 0);
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  parts.push(frame);
  return Buffer.concat(parts);
}

describe('workspaceDeliveryPorts', () => {
  it('reads delivery.parent and folders from the project file, again on every call', async () => {
    const lent = ports();
    const built = await lent.layout();
    expect(built.ok && built.value).toEqual({
      parent: '',
      folders: ['assets', 'editaveis'],
      exports: '.',
      sizes: {},
    });

    await project({ parent: 'entregas', folders: ['assets', 'editaveis', 'refs'] });
    const read = await lent.layout();
    expect(read.ok && read.value).toEqual({
      parent: 'entregas',
      folders: ['assets', 'editaveis', 'refs'],
      exports: '.',
      sizes: {},
    });
  });

  it("lays delivery.sizes over the host's format catalogue, name by name (ADR 0215)", async () => {
    await project({ exports: 'final', sizes: { feed: '1080x1350' } });
    const lent = ports(undefined, true, () =>
      Promise.resolve({ feed: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } }),
    );
    const read = await lent.layout();
    expect(read.ok && read.value).toMatchObject({
      exports: 'final',
      sizes: { feed: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } },
    });
  });

  it("lists each record's exported images by header size and its editables (ADR 0215)", async () => {
    const delivery = join(workspace, 'entregas', 'mca-1');
    await mkdir(join(delivery, 'editaveis'), { recursive: true });
    await mkdir(join(delivery, 'final', 'old'), { recursive: true });
    await writeFile(join(delivery, 'editaveis', 'delivery.json'), '{"version":1,"key":"T-1"}');
    await writeFile(join(delivery, 'editaveis', 'arte.psd'), 'psd');
    await writeFile(join(delivery, 'final', 'feed.PNG'), png(1080, 1350));
    await writeFile(join(delivery, 'final', 'story.jpg'), jpeg(1080, 1920, 300_000));
    await writeFile(join(delivery, 'final', 'broken.png'), 'not a png');
    await writeFile(join(delivery, 'final', 'notes.txt'), 'not an image');
    await writeFile(join(delivery, 'final', '.hidden.png'), png(1, 1));
    await writeFile(join(delivery, 'final', 'old', 'nested.png'), png(1, 1));
    await mkdir(join(workspace, 'entregas', 'rascunho', 'final'), { recursive: true });
    await writeFile(join(workspace, 'entregas', 'rascunho', 'final', 'x.png'), png(1, 1));

    const listed = await ports().list('entregas', 'final');
    expect(listed.ok && listed.value).toEqual([
      {
        name: 'mca-1',
        path: 'entregas/mca-1',
        record: '{"version":1,"key":"T-1"}',
        images: [
          { name: 'broken.png' },
          { name: 'feed.PNG', size: { w: 1080, h: 1350 } },
          { name: 'story.jpg', size: { w: 1080, h: 1920 } },
        ],
        editables: 1,
      },
      { name: 'rascunho', path: 'entregas/rascunho' },
    ]);
    const unasked = await ports().list('entregas');
    expect(unasked.ok && unasked.value[0]).toEqual({
      name: 'mca-1',
      path: 'entregas/mca-1',
      record: '{"version":1,"key":"T-1"}',
    });
  });

  it('reads no image through a link out of the workspace', async () => {
    const delivery = join(workspace, 'entregas', 'mca-1');
    await mkdir(join(delivery, 'editaveis'), { recursive: true });
    await writeFile(join(delivery, 'editaveis', 'delivery.json'), '{"version":1,"key":"T-1"}');
    await writeFile(join(outside, 'feed.png'), png(1080, 1350));
    await symlink(outside, join(delivery, 'final'), 'junction');
    const listed = await ports().list('entregas', 'final');
    expect(listed.ok && listed.value[0]?.images).toEqual([]);
    expect(listed.ok && listed.value[0]?.editables).toBe(0);
  });

  it('makes folders, writes, reads back and digests a record', async () => {
    const lent = ports();
    const path = 'entregas/mca-1/editaveis/delivery.json';
    expect(await lent.stat(path)).toMatchObject({ ok: true, value: undefined });
    expect((await lent.make('entregas/mca-1/assets')).ok).toBe(true);
    expect((await lent.make('entregas/mca-1/editaveis')).ok).toBe(true);
    expect((await stat(join(workspace, 'entregas', 'mca-1', 'assets'))).isDirectory()).toBe(true);
    expect((await lent.write(path, '{"version":1,"key":"T-1"}\n')).ok).toBe(true);
    expect(await readFile(join(workspace, path), 'utf8')).toBe('{"version":1,"key":"T-1"}\n');
    expect(await lent.read(path)).toMatchObject({ ok: true, value: '{"version":1,"key":"T-1"}\n' });
    const digest = await lent.stat(path);
    expect(digest.ok && digest.value).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('digests a text as stat digests the file holding it, accents included (ADR 0217)', async () => {
    const lent = ports();
    const path = 'entregas/mca-1/editaveis/copy.md';
    const text = 'Source: https://docs.example/d/1\n\nLançamento: três peças\n';
    expect((await lent.make('entregas/mca-1/editaveis')).ok).toBe(true);
    expect((await lent.write(path, text)).ok).toBe(true);
    const onDisk = await lent.stat(path);
    expect(onDisk.ok && onDisk.value).toBe(lent.digest?.(text));
    expect(lent.digest?.(`${text} `)).not.toBe(lent.digest?.(text));
  });

  it('refuses a path into .tyto, out of the workspace, or through a link that leads out', async () => {
    const lent = ports();
    const tyto = await lent.write('.tyto/delivery.json', '{}');
    expect(tyto.ok ? '' : tyto.error[0]?.message).toContain('inside .tyto/');
    const climbed = await lent.make('../elsewhere/x');
    expect(climbed.ok ? '' : climbed.error[0]?.message).toContain('outside the workspace');

    await symlink(
      outside,
      join(workspace, 'entregas'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const linked = await lent.stat('entregas/mca-1/editaveis/delivery.json');
    expect(linked.ok ? '' : linked.error[0]?.message).toContain('through a link');
  });

  it('writes nothing once the folder is restricted, and is nowhere outside a workspace', async () => {
    let trust: Trust = 'trusted';
    const lent = ports(() => trust);
    expect(lent.folder()).toEqual({ restricted: false });
    trust = 'restricted';
    expect(lent.folder()).toEqual({ restricted: true });
    const refused = await lent.make('entregas/mca-1');
    expect(refused.ok ? '' : refused.error[0]?.message).toContain('restricted folder');
    await expect(stat(join(workspace, 'entregas'))).rejects.toThrow();

    expect(ports(() => 'trusted', false).folder()).toBeUndefined();
  });

  it('lists the folders under a parent with their records, each confined on its own', async () => {
    const record = '{"version":1,"key":"T-1"}\n';
    await mkdir(join(workspace, 'entregas', 'mca-1', 'editaveis'), { recursive: true });
    await writeFile(join(workspace, 'entregas', 'mca-1', 'editaveis', 'delivery.json'), record);
    await mkdir(join(workspace, 'entregas', 'rascunho'), { recursive: true });
    await mkdir(join(workspace, 'entregas', '.oculta', 'editaveis'), { recursive: true });
    await writeFile(join(workspace, 'entregas', 'solto.txt'), 'not a folder');
    await mkdir(join(outside, 'editaveis'), { recursive: true });
    await writeFile(join(outside, 'editaveis', 'delivery.json'), record);
    await symlink(
      outside,
      join(workspace, 'entregas', 'fora'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const listed = await ports().list('entregas');
    expect(listed.ok && listed.value).toEqual([
      {
        name: 'fora',
        path: 'entregas/fora',
        problem: 'it leads out of the workspace through a link',
      },
      { name: 'mca-1', path: 'entregas/mca-1', record },
      { name: 'rascunho', path: 'entregas/rascunho' },
    ]);
    expect(await ports().list('nada')).toMatchObject({ ok: true, value: [] });
  });

  it('lists nothing in a restricted folder, and never out of the workspace', async () => {
    await mkdir(join(workspace, 'entregas', 'mca-1'), { recursive: true });
    const restricted = await ports(() => 'restricted').list('entregas');
    expect(restricted.ok ? '' : restricted.error[0]?.message).toContain('restricted folder');
    const climbed = await ports().list('../elsewhere');
    expect(climbed.ok ? '' : climbed.error[0]?.message).toContain('outside the workspace');
  });

  it('refuses to make a folder where a file is', async () => {
    await writeFile(join(workspace, 'entregas'), 'a file', 'utf8');
    const made = await ports().make('entregas');
    expect(made.ok ? '' : made.error[0]?.message).toContain('a file is there');
  });
});
