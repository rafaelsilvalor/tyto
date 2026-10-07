import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fsDeliveryOutput, makeFolder } from './fs-outbox.js';

/**
 * TYTO-129: a file holding a name the delivery needs as a folder is the caller's to fix, and
 * is answered with `E_DELIVERY_FOLDER_BLOCKED`; a folder that refuses the write is still a
 * throw, because that is the exit 2 the render contract says is worth retrying.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-io-blocked-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const BRIEF = new TextEncoder().encode('---\ntemplate: agenda-semana\n---\n');
const HELD = 'nao sou pasta';

async function blockedPaths(
  destination: string,
  folder?: 'destination',
): Promise<readonly string[]> {
  const opened = await fsDeliveryOutput(destination, {
    name: 'agenda',
    brief: BRIEF,
    ...(folder === undefined ? {} : { folder }),
  });
  if (opened.ok) throw new Error('expected the delivery to be refused');
  expect(opened.error.map((item) => item.code)).toEqual(['E_DELIVERY_FOLDER_BLOCKED']);
  expect(opened.error[0]?.severity).toBe('error');
  return opened.error.map((item) => item.message);
}

describe('fsDeliveryOutput with a file in the way', () => {
  it('names the file holding <destination>/<name> and leaves it as it was', async () => {
    const destination = join(workspace, 'entregas');
    await mkdir(destination);
    await writeFile(join(destination, 'agenda'), HELD);

    const messages = await blockedPaths(destination);

    expect(messages).toEqual([
      `'${join(destination, 'agenda')}' is a file, and the delivery needs a folder with that name. Rename or move the file, or deliver somewhere else.`,
    ]);
    expect(await readFile(join(destination, 'agenda'), 'utf8')).toBe(HELD);
  });

  it('names a file holding editaveis/ inside an existing delivery folder', async () => {
    // Windows answers `mkdir -p` here with EEXIST, and with ENOTDIR one level up: the reason
    // the adapter looks at the entry instead of reading the error code.
    const folder = join(workspace, 'entregas', 'agenda');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'editaveis'), HELD);

    const messages = await blockedPaths(join(workspace, 'entregas'));

    expect(messages[0]).toContain(`'${join(folder, 'editaveis')}' is a file`);
  });

  it('names a file holding editaveis/ in the folder the desktop export box picked', async () => {
    const picked = join(workspace, 'escolhida');
    await mkdir(picked);
    await writeFile(join(picked, 'editaveis'), HELD);

    const messages = await blockedPaths(picked, 'destination');

    expect(messages[0]).toContain(`'${join(picked, 'editaveis')}' is a file`);
    expect(await readdir(picked)).toEqual(['editaveis']);
  });

  it('answers a file holding assets/ with an error, and copies nothing', async () => {
    const briefs = join(workspace, 'briefs');
    await mkdir(briefs);
    await writeFile(join(briefs, 'selo.png'), 'seal bytes');
    const picked = join(workspace, 'escolhida');
    await mkdir(picked);
    await writeFile(join(picked, 'assets'), HELD);
    const opened = await fsDeliveryOutput(picked, {
      name: 'agenda',
      brief: BRIEF,
      folder: 'destination',
    });
    if (!opened.ok) throw new Error('the delivery folder itself is free');

    const answered = await opened.value.deliverAssets([
      { reference: 'selo.png', path: join(briefs, 'selo.png') },
    ]);

    expect(answered.map((item) => [item.code, item.severity])).toEqual([
      ['E_DELIVERY_FOLDER_BLOCKED', 'error'],
    ]);
    expect(answered[0]?.message).toContain(`'${join(picked, 'assets')}' is a file`);
    expect(await readFile(join(picked, 'assets'), 'utf8')).toBe(HELD);
  });
});

describe('makeFolder', () => {
  it('rethrows a refusal when nothing on the path is a file — the exit 2 kind', async () => {
    // A seam, not the operating system: Windows gives an unelevated test no folder it may not
    // write in. The real refusal is the POSIX test below, which runs on the CI's Linux.
    const refused = Object.assign(new Error('EACCES: permission denied, mkdir'), {
      code: 'EACCES',
    });

    await expect(
      makeFolder(join(workspace, 'nova', 'editaveis'), () => Promise.reject(refused)),
    ).rejects.toBe(refused);
  });

  it('rethrows a refusal for a path whose parents do not exist at all', async () => {
    const refused = Object.assign(new Error('ENOSPC: no space left on device, mkdir'), {
      code: 'ENOSPC',
    });

    await expect(
      makeFolder(join(workspace, 'a', 'b', 'c'), () => Promise.reject(refused)),
    ).rejects.toBe(refused);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'lets a read-only parent throw, so the CLI still exits 2 for it',
    async () => {
      const destination = join(workspace, 'somente-leitura');
      await mkdir(destination);
      await chmod(destination, 0o555);
      try {
        await expect(
          fsDeliveryOutput(destination, { name: 'agenda', brief: BRIEF }),
        ).rejects.toMatchObject({ code: 'EACCES' });
      } finally {
        await chmod(destination, 0o755);
      }
    },
  );
});
