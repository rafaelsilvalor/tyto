import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fsArtworkOutput, makeFolder } from './fs-outbox.js';

/**
 * TYTO-129: a file holding a name the output needs as a folder is the caller's to fix, and
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

const HELD = 'nao sou pasta';

async function blockedPaths(destination: string): Promise<readonly string[]> {
  const opened = await fsArtworkOutput(destination);
  if (opened.ok) throw new Error('expected the folder to be refused');
  expect(opened.error.map((item) => item.code)).toEqual(['E_DELIVERY_FOLDER_BLOCKED']);
  expect(opened.error[0]?.severity).toBe('error');
  return opened.error.map((item) => item.message);
}

describe('fsArtworkOutput with a file in the way', () => {
  it('names the file holding the picked folder and leaves it as it was', async () => {
    const picked = join(workspace, 'escolhida');
    await writeFile(picked, HELD);

    const messages = await blockedPaths(picked);

    expect(messages).toEqual([
      `'${picked}' is a file, and Tyto needs a folder with that name. Rename or move the file, or export somewhere else.`,
    ]);
    expect(await readFile(picked, 'utf8')).toBe(HELD);
  });

  it('names a file holding a folder above it, and writes nothing beside it', async () => {
    // Windows answers `mkdir -p` here with ENOTDIR, and with EEXIST one level down: the
    // reason the adapter looks at the entry instead of reading the error code.
    const parent = join(workspace, 'entregas');
    await mkdir(parent);
    await writeFile(join(parent, 'agenda'), HELD);

    const messages = await blockedPaths(join(parent, 'agenda', 'feed'));

    expect(messages[0]).toContain(`'${join(parent, 'agenda')}' is a file`);
    expect(await readdir(parent)).toEqual(['agenda']);
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
        await expect(fsArtworkOutput(join(destination, 'agenda'))).rejects.toMatchObject({
          code: 'EACCES',
        });
      } finally {
        await chmod(destination, 0o755);
      }
    },
  );
});
