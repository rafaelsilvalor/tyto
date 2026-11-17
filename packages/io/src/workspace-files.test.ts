import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import type { Trust } from '@tyto/core';
import {
  PLUGIN_FILE_LIMIT_BYTES,
  PLUGIN_FILE_PART_BYTES,
  PLUGIN_FOLDER_LIST_LIMIT,
} from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workspaceFiles } from './workspace-files.js';

/**
 * A workspace folder and a folder beside it that is not the workspace's, so a link inside the
 * workspace can try to reach out (ADR 0112, ADR 0138). The lexical half — `..`, absolute
 * paths, drives — is `checkedCapabilities`'s and tested in `@tyto/plugin-api`; what is tested
 * here is the adapter's own half, after `realpath`, and its reading of the folder and trust.
 */
let scratch: string;
let workspace: string;
let outside: string;
let open: string | undefined;
let trust: Trust;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-workspace-files-')));
  workspace = join(scratch, 'workspace');
  outside = join(scratch, 'outside');
  await mkdir(join(workspace, '.tyto'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(workspace, '.tyto', 'project.json'), '{}');
  await writeFile(join(outside, 'secret.txt'), 'not the workspace');
  open = workspace;
  trust = 'trusted';
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A directory link that works without elevation on Windows, where it is a junction. */
async function linkDirectory(target: string, link: string): Promise<void> {
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

const files = () => workspaceFiles({ folder: () => open, trust: () => trust });
const text = (value: string) => new TextEncoder().encode(value);

/**
 * `code: problem`, or `resolved`, so a refusal's reason is part of what is compared. The
 * problem is the end of `E_WORKSPACE_FILE`'s message; the restricted refusal has none.
 */
async function refusalOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => 'resolved',
    (cause: unknown) => {
      const { code, message } = cause as { code?: string; message?: string };
      const problem = /could not use workspace file '[^']*': (.*)\.$/u.exec(message ?? '')?.[1];
      return `${code ?? String(cause)}: ${problem ?? ''}`;
    },
  );
}

describe('workspaceFiles', () => {
  it('writes a file into a missing nested folder, and reads it back', async () => {
    const ports = files();
    await ports.workspaceWrite('jira', 'tables/2026/sprint.csv', text('a,b\n'));
    expect(await readFile(join(workspace, 'tables', '2026', 'sprint.csv'), 'utf8')).toBe('a,b\n');
    expect(
      new TextDecoder().decode(await ports.workspaceRead('jira', 'tables/2026/sprint.csv')),
    ).toBe('a,b\n');
    // Written beside its name and renamed: no scratch file is left.
    expect(await readdir(join(workspace, 'tables', '2026'))).toEqual(['sprint.csv']);
  });

  it('replaces a file written twice', async () => {
    const ports = files();
    await ports.workspaceWrite('jira', 'table.csv', text('old'));
    await ports.workspaceWrite('jira', 'table.csv', text('new'));
    expect(await readFile(join(workspace, 'table.csv'), 'utf8')).toBe('new');
  });

  it('reads .tyto/, and refuses a write into it', async () => {
    const ports = files();
    expect(new TextDecoder().decode(await ports.workspaceRead('jira', '.tyto/project.json'))).toBe(
      '{}',
    );
    expect(await refusalOf(ports.workspaceWrite('jira', '.tyto/project.json', text('x')))).toBe(
      'E_WORKSPACE_FILE: it is inside .tyto/, which only Tyto writes',
    );
  });

  it('refuses a write that reaches .tyto/ through a link, after realpath', async () => {
    await linkDirectory(join(workspace, '.tyto'), join(workspace, 'settings'));
    expect(
      await refusalOf(files().workspaceWrite('jira', 'settings/project.json', text('x'))),
    ).toBe('E_WORKSPACE_FILE: it is inside .tyto/, which only Tyto writes');
    expect(await readFile(join(workspace, '.tyto', 'project.json'), 'utf8')).toBe('{}');
  });

  it('refuses a read and a write through a link that leads out of the folder', async () => {
    await linkDirectory(outside, join(workspace, 'escape'));
    const ports = files();
    const through = 'E_WORKSPACE_FILE: the path leads out of the folder through a link';
    expect(await refusalOf(ports.workspaceRead('jira', 'escape/secret.txt'))).toBe(through);
    expect(await refusalOf(ports.workspaceWrite('jira', 'escape/new.txt', text('x')))).toBe(
      through,
    );
    expect(await readdir(outside)).toEqual(['secret.txt']);
  });

  it('refuses a path that leaves the folder as written, if one ever reaches it', async () => {
    expect(await refusalOf(files().workspaceRead('jira', '../outside/secret.txt'))).toBe(
      'E_WORKSPACE_FILE: the path leaves the folder',
    );
  });

  it('answers a restricted folder before looking at the path, on every call', async () => {
    const ports = files();
    trust = 'restricted';
    expect(await refusalOf(ports.workspaceRead('jira', 'escape/../../x'))).toBe(
      'E_WORKSPACE_FILE_RESTRICTED: ',
    );
    expect(await refusalOf(ports.workspaceWrite('jira', 'table.csv', text('x')))).toBe(
      'E_WORKSPACE_FILE_RESTRICTED: ',
    );
    // Trusted while the plugin runs: the next call goes through.
    trust = 'trusted';
    await ports.workspaceWrite('jira', 'table.csv', text('x'));
    expect(await readdir(workspace)).toContain('table.csv');
  });

  it('answers no folder open, and follows the folder that is open now', async () => {
    const ports = files();
    open = undefined;
    expect(await refusalOf(ports.workspaceRead('jira', 'a.txt'))).toBe(
      'E_WORKSPACE_FILE: no workspace folder is open',
    );
    open = outside;
    expect(new TextDecoder().decode(await ports.workspaceRead('jira', 'secret.txt'))).toBe(
      'not the workspace',
    );
  });

  it('refuses a missing file, a folder, and a file over 32 MiB', async () => {
    const ports = files();
    expect(await refusalOf(ports.workspaceRead('jira', 'missing.txt'))).toBe(
      'E_WORKSPACE_FILE: no such file',
    );
    expect(await refusalOf(ports.workspaceRead('jira', '.tyto'))).toBe(
      'E_WORKSPACE_FILE: it names a folder, not a file',
    );
    expect(
      await refusalOf(
        ports.workspaceWrite('jira', 'big.bin', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1)),
      ),
    ).toMatch(/^E_WORKSPACE_FILE: the file is \d+ bytes; the ceiling is \d+$/u);
  });
});

/** The garbage collector, exposed for this process without a flag on the test runner. */
function collector(): () => void {
  setFlagsFromString('--expose-gc');
  return runInNewContext('gc') as () => void;
}

describe('workspaceFiles: parts, stat and list (ADR 0212)', () => {
  const MIB = 1024 * 1024;

  it('reads a 100 MB file in 8 MiB parts with memory bounded by the part', async () => {
    // Generated here, in 1 MiB blocks, and hashed as written: no fixture of this size is kept.
    const blocks = 100;
    const hashWritten = createHash('sha256');
    const handle = await openFile(join(workspace, 'editable.psd'), 'w');
    try {
      const block = new Uint8Array(MIB);
      for (let index = 0; index < blocks; index += 1) {
        block.fill(index % 251);
        block[0] = index;
        hashWritten.update(block);
        await handle.write(block);
      }
    } finally {
      await handle.close();
    }
    const size = blocks * MIB;
    const ports = files();
    expect(await ports.workspaceStat('jira', 'editable.psd')).toMatchObject({
      name: 'editable.psd',
      kind: 'file',
      size,
    });
    // The control: the same file read whole is over the ceiling and refused.
    expect(await refusalOf(ports.workspaceRead('jira', 'editable.psd'))).toBe(
      `E_WORKSPACE_FILE: the file is ${String(size)} bytes; the ceiling is ${String(PLUGIN_FILE_LIMIT_BYTES)}`,
    );

    // Collected before each part, so the peak is what is alive while one part is held: without
    // it the parts already hashed wait for a lazy collector, and the peak measured the
    // collector's mood (64 MiB of dead parts, measured), not the adapter.
    const collect = collector();
    const hashRead = createHash('sha256');
    collect();
    const before = process.memoryUsage().arrayBuffers;
    let peak = before;
    let parts = 0;
    for (let offset = 0; ; offset += PLUGIN_FILE_PART_BYTES) {
      collect();
      const part = await ports.workspaceReadPart(
        'jira',
        'editable.psd',
        offset,
        PLUGIN_FILE_PART_BYTES,
      );
      if (part.byteLength === 0) break;
      parts += 1;
      hashRead.update(part);
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    }
    process.stdout.write(
      `parts=${String(parts)} arrayBuffers before=${String(before)} peak=${String(peak)} rise=${String(peak - before)}\n`,
    );
    expect(parts).toBe(Math.ceil(size / PLUGIN_FILE_PART_BYTES));
    expect(hashRead.digest('hex')).toBe(hashWritten.digest('hex'));
    // One 8 MiB part alive at a time, with room for the reader's own buffers; the whole file
    // read at once would be 100 MiB.
    expect(peak - before).toBeLessThan(3 * PLUGIN_FILE_PART_BYTES);
  });

  it('answers a part short at the end of a file, empty past it, from the offset asked', async () => {
    await writeFile(join(workspace, 'a.txt'), 'abcdefghij');
    const ports = files();
    const read = async (offset: number, length: number) =>
      new TextDecoder().decode(await ports.workspaceReadPart('jira', 'a.txt', offset, length));
    expect(await read(2, 3)).toBe('cde');
    expect(await read(7, 8)).toBe('hij');
    expect(await read(10, 4)).toBe('');
    expect(await read(99, 4)).toBe('');
    expect(await read(0, 0)).toBe('');
  });

  it('refuses a part of a folder and of a missing file', async () => {
    const ports = files();
    expect(await refusalOf(ports.workspaceReadPart('jira', '.tyto', 0, 1))).toBe(
      'E_WORKSPACE_FILE: it names a folder, not a file',
    );
    expect(await refusalOf(ports.workspaceReadPart('jira', 'missing.bin', 0, 1))).toBe(
      'E_WORKSPACE_FILE: no such file or folder',
    );
  });

  it('lists one folder with sizes, a link inside by its target, and leaves out a link out', async () => {
    await writeFile(join(workspace, 'b.txt'), 'four');
    await mkdir(join(workspace, 'delivery', 'nested'), { recursive: true });
    await writeFile(join(workspace, 'delivery', 'cover.png'), 'twelve bytes');
    await linkDirectory(join(workspace, 'delivery'), join(workspace, 'again'));
    await linkDirectory(outside, join(workspace, 'escape'));
    const ports = files();

    const root = await ports.workspaceList('jira', '');
    expect(root.map(({ name, kind, size }) => `${name} ${kind} ${String(size)}`)).toEqual([
      '.tyto folder 0',
      'again folder 0',
      'b.txt file 4',
      'delivery folder 0',
    ]);
    for (const entry of root) {
      expect(new Date(entry.modifiedAt).toISOString()).toBe(entry.modifiedAt);
    }
    const delivery = await ports.workspaceList('jira', 'delivery');
    expect(delivery.map(({ name, size }) => `${name} ${String(size)}`)).toEqual([
      'cover.png 12',
      'nested 0',
    ]);
    expect(await ports.workspaceStat('jira', '')).toMatchObject({ name: '', kind: 'folder' });
    expect(await ports.workspaceStat('jira', 'delivery/cover.png')).toMatchObject({
      name: 'cover.png',
      kind: 'file',
      size: 12,
    });
  });

  it('refuses a part, a stat and a list through a link that leads out of the folder', async () => {
    await linkDirectory(outside, join(workspace, 'escape'));
    const ports = files();
    const through = 'E_WORKSPACE_FILE: the path leads out of the folder through a link';
    expect(await refusalOf(ports.workspaceReadPart('jira', 'escape/secret.txt', 0, 4))).toBe(
      through,
    );
    expect(await refusalOf(ports.workspaceStat('jira', 'escape/secret.txt'))).toBe(through);
    expect(await refusalOf(ports.workspaceStat('jira', 'escape'))).toBe(through);
    expect(await refusalOf(ports.workspaceList('jira', 'escape'))).toBe(through);
  });

  it('refuses a part, a stat and a list of a path that leaves the folder as written', async () => {
    const ports = files();
    const leaves = 'E_WORKSPACE_FILE: the path leaves the folder';
    expect(await refusalOf(ports.workspaceStat('jira', '../outside'))).toBe(leaves);
    expect(await refusalOf(ports.workspaceList('jira', '../outside'))).toBe(leaves);
    expect(await refusalOf(ports.workspaceReadPart('jira', '../outside/secret.txt', 0, 1))).toBe(
      leaves,
    );
  });

  it('answers a restricted folder for a part, a stat and a list', async () => {
    trust = 'restricted';
    const ports = files();
    const restricted = 'E_WORKSPACE_FILE_RESTRICTED: ';
    expect(await refusalOf(ports.workspaceReadPart('jira', 'a.txt', 0, 1))).toBe(restricted);
    expect(await refusalOf(ports.workspaceStat('jira', ''))).toBe(restricted);
    expect(await refusalOf(ports.workspaceList('jira', ''))).toBe(restricted);
  });

  it('refuses a list of a file, and of a folder holding more entries than the ceiling', async () => {
    await writeFile(join(workspace, 'a.txt'), 'a');
    const ports = files();
    expect(await refusalOf(ports.workspaceList('jira', 'a.txt'))).toBe(
      'E_WORKSPACE_FILE: it names a file, not a folder',
    );
    const crowded = join(workspace, 'crowded');
    await mkdir(crowded);
    const names = Array.from(
      { length: PLUGIN_FOLDER_LIST_LIMIT + 1 },
      (_, index) => `${String(index)}.txt`,
    );
    for (let start = 0; start < names.length; start += 500) {
      await Promise.all(
        names.slice(start, start + 500).map((name) => writeFile(join(crowded, name), '')),
      );
    }
    expect(await refusalOf(ports.workspaceList('jira', 'crowded'))).toBe(
      `E_WORKSPACE_FILE: the folder holds ${String(PLUGIN_FOLDER_LIST_LIMIT + 1)} entries or more; the ceiling is ${String(PLUGIN_FOLDER_LIST_LIMIT)}`,
    );
    await rm(join(crowded, '0.txt'));
    expect(await ports.workspaceList('jira', 'crowded')).toHaveLength(PLUGIN_FOLDER_LIST_LIMIT);
  }, 60_000);
});
