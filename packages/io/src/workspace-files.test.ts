import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Trust } from '@tyto/core';
import { PLUGIN_FILE_LIMIT_BYTES } from '@tyto/plugin-api';
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
