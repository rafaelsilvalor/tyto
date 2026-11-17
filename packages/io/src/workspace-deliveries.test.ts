import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Trust } from '@tyto/core';
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

function ports(trust: () => Trust = () => 'trusted', inWorkspace = true) {
  return workspaceDeliveryPorts({
    workspaceFolder: inWorkspace ? workspace : undefined,
    trust,
    home: join(scratch, 'home'),
  });
}

describe('workspaceDeliveryPorts', () => {
  it('reads delivery.parent and folders from the project file, again on every call', async () => {
    const lent = ports();
    const built = await lent.layout();
    expect(built.ok && built.value).toEqual({ parent: '', folders: ['assets', 'editaveis'] });

    await project({ parent: 'entregas', folders: ['assets', 'editaveis', 'refs'] });
    const read = await lent.layout();
    expect(read.ok && read.value).toEqual({
      parent: 'entregas',
      folders: ['assets', 'editaveis', 'refs'],
    });
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
